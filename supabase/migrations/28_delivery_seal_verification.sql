-- Reconstructed from live schema introspection during a `supabase db pull`
-- (Docker wasn't available for the CLI's own shadow-db diff — see
-- 26_handle_new_user_on_signup.sql's note). Unlike 26/27, this one and the
-- rest through 34_fix_profile_column_grants_properly.sql map to real
-- entries this session left in supabase_migrations.schema_migrations
-- (applied via the Supabase MCP tool's apply_migration, not the dashboard),
-- just never saved as files here — the names/order below match that history
-- exactly, the SQL is reconstructed from the live objects it left behind.
create table delivery_verifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  seal_status text not null check (seal_status in ('intact', 'broken')),
  verified_by uuid not null references profiles(id),
  verified_at timestamptz not null default now()
);

alter table delivery_verifications enable row level security;

create policy "delivery: order participants can view"
  on delivery_verifications for select
  using (
    exists (select 1 from orders o where o.id = delivery_verifications.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );

-- Customer-only. Requires a delivery_photos row to already exist (see
-- 31_delivery_photo_proof.sql) — photo proof comes before seal verification,
-- not the other way round, even though this migration predates that table
-- (plpgsql bodies aren't checked against referenced tables until they run,
-- so the create-order was never actually a problem live).
create or replace function verify_delivery_seal(p_order_id uuid, p_seal_status text)
returns boolean as $$
declare
  v_order orders%rowtype;
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

  insert into delivery_verifications (order_id, seal_status, verified_by)
  values (p_order_id, p_seal_status, auth.uid());

  -- Broken seal still completes the order (payment already happened outside
  -- the app) but auto-raises a complaint for admin review instead of
  -- blocking it.
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
$$ language plpgsql security definer;

grant execute on function verify_delivery_seal(uuid, text) to authenticated;

-- No insert/update policy on purpose — verify_delivery_seal (security
-- definer, owned by the table owner) is the only path in, same pattern as
-- pickup_verifications in 27_pickup_otp_verification.sql.
revoke insert, update, delete on delivery_verifications from authenticated;
