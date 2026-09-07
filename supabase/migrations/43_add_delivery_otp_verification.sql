-- Backfill: this migration already exists live (applied via Supabase MCP as
-- version 20260907134740 / "add_delivery_otp_verification", tracked in
-- supabase_migrations.schema_migrations) but was never saved to this folder
-- until now. Statements below are copied verbatim from that table, not
-- reconstructed from schema introspection.
--
-- Adds a second OTP step to the delivery leg, alongside the existing photo
-- proof (31_delivery_photo_proof.sql) — not replacing it. Mirrors
-- pickup_verifications/get_pickup_otp/verify_pickup_otp
-- (27_pickup_otp_verification.sql) with the reveal/verify roles reversed:
-- the agent reveals the code here, the customer submits it.
--
-- CAUTION reconciling this against 28_delivery_seal_verification.sql: the
-- verify_delivery_seal CREATE OR REPLACE below changes the parameter list
-- (adds p_submitted_otp) from the 2-arg version created in 28. In Postgres,
-- CREATE OR REPLACE FUNCTION with a different parameter list creates a new
-- overload rather than replacing the old one — so from this migration until
-- 45_drop_old_verify_delivery_seal_overload.sql, the old 2-arg overload (no
-- OTP check at all) was still live and callable alongside this one. That gap
-- was found and closed by hand the same day; see 45 for the drop.
--
-- Also note (UPDATE: this was exploitable, not just a hygiene gap — see
-- 46_revoke_authenticated_anon_from_delivery_otp_verifications.sql, applied
-- same day): unlike pickup_verifications, which 27 revokes direct table
-- grants from `authenticated` for inline (`anon` closed later by 38), this
-- table's grants were never revoked. The SELECT policy below covers *both*
-- order participants — fine for pickup_verifications, where the
-- customer-only get_pickup_otp lines up with who the policy already lets
-- read the row directly, but wrong here: get_delivery_otp is agent-only,
-- so with grants still open the customer could read otp_code straight off
-- the table and see the delivery code before the agent ever revealed it,
-- bypassing get_delivery_otp's role check entirely. Closed by 46.
CREATE TABLE public.delivery_otp_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  otp_code text NOT NULL,
  otp_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_otp_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery otp: order participants can view row"
  ON public.delivery_otp_verifications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = delivery_otp_verifications.order_id
        AND (o.customer_id = auth.uid() OR o.accepted_agent_id = auth.uid())
    )
  );

-- Generated the moment the agent submits their delivery photo — mirrors
-- generate_pickup_otp, which fires on order acceptance instead.
CREATE OR REPLACE FUNCTION public.generate_delivery_otp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into delivery_otp_verifications (order_id, otp_code)
  values (new.order_id, lpad(floor(random() * 1000000)::text, 6, '0'));
  return new;
end;
$function$;

CREATE TRIGGER trg_generate_delivery_otp
  AFTER INSERT ON public.delivery_photos
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_delivery_otp();

-- Agent-only reveal (reversed from get_pickup_otp, which is customer-only).
CREATE OR REPLACE FUNCTION public.get_delivery_otp(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_agent_id uuid;
  v_code text;
begin
  select accepted_agent_id into v_agent_id from orders where id = p_order_id;
  if v_agent_id is distinct from auth.uid() then
    raise exception 'Not authorized to view this OTP';
  end if;
  select otp_code into v_code from delivery_otp_verifications where order_id = p_order_id;
  return v_code;
end;
$function$;

-- verify_delivery_seal now requires the OTP to match before the seal check
-- (and order-delivered transition) can proceed. Wrong code -> false, no
-- state change, same pattern as verify_pickup_otp. See the CAUTION note
-- above: this CREATE OR REPLACE added a 2nd overload rather than replacing
-- 28_delivery_seal_verification.sql's 2-arg version, until 45 dropped it.
CREATE OR REPLACE FUNCTION public.verify_delivery_seal(p_order_id uuid, p_seal_status text, p_submitted_otp text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_order orders%rowtype;
  v_otp_record delivery_otp_verifications%rowtype;
begin
  select * into v_order from orders where id = p_order_id;

  if v_order.customer_id is distinct from auth.uid() then
    raise exception 'Only the customer can verify delivery for this order';
  end if;

  if v_order.status <> 'picked_up' then
    raise exception 'Order is not awaiting delivery verification';
  end if;

  if p_seal_status not in ('intact', 'broken') then
    raise exception 'Invalid seal status';
  end if;

  if exists (select 1 from delivery_verifications where order_id = p_order_id) then
    raise exception 'Delivery already verified for this order';
  end if;

  if not exists (select 1 from delivery_photos where order_id = p_order_id) then
    raise exception 'Agent must submit a delivery photo before seal can be verified';
  end if;

  select * into v_otp_record from delivery_otp_verifications where order_id = p_order_id;

  if v_otp_record.order_id is null then
    raise exception 'No delivery code has been generated for this order yet';
  end if;

  if v_otp_record.otp_verified_at is not null then
    raise exception 'Delivery code already verified for this order';
  end if;

  if v_otp_record.otp_code <> p_submitted_otp then
    return false;
  end if;

  update delivery_otp_verifications set otp_verified_at = now() where order_id = p_order_id;

  insert into delivery_verifications (order_id, seal_status, verified_by)
  values (p_order_id, p_seal_status, auth.uid());

  if p_seal_status = 'broken' then
    insert into complaints (order_id, raised_by, reason, status)
    values (
      p_order_id,
      auth.uid(),
      'Automatically raised: recipient reported the package seal was broken at delivery.',
      'open'
    );
  end if;

  update orders set status = 'delivered' where id = p_order_id;

  return true;
end;
$function$;
