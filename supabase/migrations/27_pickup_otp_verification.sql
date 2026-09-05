-- Reconstructed from live schema introspection during a `supabase db pull`
-- (see 26_handle_new_user_on_signup.sql's note on why this is hand-authored
-- rather than pulled). Like that one, this whole OTP subsystem already
-- existed live — built and tested in an earlier session, applied by hand
-- against the dashboard, and never saved locally until now.
--
-- Auto-generates a 6-digit pickup OTP the moment an order flips open -> accepted.
create or replace function generate_pickup_otp()
returns trigger as $$
begin
  if new.status = 'accepted' and old.status = 'open' then
    insert into pickup_verifications (order_id, otp_code)
    values (new.id, lpad(floor(random() * 1000000)::text, 6, '0'));
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_generate_pickup_otp
  after update on orders
  for each row execute function generate_pickup_otp();

-- Customer-only: reveal the raw code so they can read it aloud to the agent
-- at handoff.
create or replace function get_pickup_otp(p_order_id uuid)
returns text as $$
declare
  v_customer_id uuid;
  v_code text;
begin
  select customer_id into v_customer_id from orders where id = p_order_id;
  if v_customer_id is distinct from auth.uid() then
    raise exception 'Not authorized to view this OTP';
  end if;
  select otp_code into v_code from pickup_verifications where order_id = p_order_id;
  return v_code;
end;
$$ language plpgsql security definer;

grant execute on function get_pickup_otp(uuid) to authenticated;

-- Agent-only: submit the code the customer read out. Flips accepted -> picked_up.
create or replace function verify_pickup_otp(p_order_id uuid, p_submitted_otp text)
returns boolean as $$
declare
  v_order orders%rowtype;
  v_record pickup_verifications%rowtype;
begin
  select * into v_order from orders where id = p_order_id;

  if v_order.accepted_agent_id is distinct from auth.uid() then
    raise exception 'Only the assigned agent can verify pickup for this order';
  end if;

  if v_order.status <> 'accepted' then
    raise exception 'Order is not awaiting pickup';
  end if;

  select * into v_record from pickup_verifications where order_id = p_order_id;

  if v_record.otp_verified_at is not null then
    raise exception 'Pickup already verified for this order';
  end if;

  if v_record.otp_code <> p_submitted_otp then
    return false;
  end if;

  update pickup_verifications set otp_verified_at = now() where order_id = p_order_id;
  update orders set status = 'picked_up' where id = p_order_id;
  return true;
end;
$$ language plpgsql security definer;

grant execute on function verify_pickup_otp(uuid, text) to authenticated;

-- 04_pickup_tracking_chat.sql's original "pickup: order participants" policy
-- was FOR ALL, which (combined with default table grants) would have let a
-- participant read/write otp_code and otp_verified_at directly, bypassing
-- the above RPCs entirely. Narrow it to read-only, and revoke direct table
-- access for authenticated altogether — the two functions above are meant
-- to be the only way in or out of this table now.
drop policy "pickup: order participants" on pickup_verifications;

create policy "pickup: order participants can view row"
  on pickup_verifications for select
  using (
    exists (select 1 from orders o where o.id = pickup_verifications.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );

revoke select, insert, update, delete on pickup_verifications from authenticated;
