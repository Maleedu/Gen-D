-- Reconstructed from live schema introspection during a `supabase db pull`
-- (see 26_handle_new_user_on_signup.sql's note on why this is hand-authored).
--
-- Delivery verification is photo proof, not a second OTP: agent submits a
-- photo, then (once it exists) the customer can check the seal and the
-- order completes. That ordering is enforced server-side in
-- verify_delivery_seal (28_delivery_seal_verification.sql), not just in the UI.
create table delivery_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  photo_url text not null,
  uploaded_by uuid not null references profiles(id),
  uploaded_at timestamptz not null default now()
);

alter table delivery_photos enable row level security;

create policy "delivery photos: order participants can view"
  on delivery_photos for select
  using (
    (exists (select 1 from orders o where o.id = delivery_photos.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid())))
    or is_admin_user()
  );

-- Agent-only. One photo per order — a second call fails with "already submitted".
create or replace function submit_delivery_photo(p_order_id uuid, p_photo_url text)
returns boolean as $$
declare
  v_order orders%rowtype;
begin
  select * into v_order from orders where id = p_order_id;

  if v_order.accepted_agent_id is distinct from auth.uid() then
    raise exception 'Only the assigned agent can submit a delivery photo for this order';
  end if;

  if v_order.status <> 'picked_up' then
    raise exception 'Order is not awaiting delivery';
  end if;

  if exists (select 1 from delivery_photos where order_id = p_order_id) then
    raise exception 'Delivery photo already submitted for this order';
  end if;

  insert into delivery_photos (order_id, photo_url, uploaded_by)
  values (p_order_id, p_photo_url, auth.uid());

  return true;
end;
$$ language plpgsql security definer;

grant execute on function submit_delivery_photo(uuid, text) to authenticated;

-- No insert/update policy on purpose — submit_delivery_photo is the only
-- path in, same pattern as delivery_verifications above.
revoke insert, update, delete on delivery_photos from authenticated;

insert into storage.buckets (id, name, public)
values ('delivery-photos', 'delivery-photos', false)
on conflict (id) do nothing;

create policy "delivery-photos: agent uploads while picked_up"
  on storage.objects for insert
  with check (
    bucket_id = 'delivery-photos'
    and exists (select 1 from orders o
      where o.id::text = (storage.foldername(objects.name))[1]
      and o.accepted_agent_id = auth.uid()
      and o.status = 'picked_up')
  );

create policy "delivery-photos: order participants and admin can view"
  on storage.objects for select
  using (
    bucket_id = 'delivery-photos'
    and (
      exists (select 1 from orders o
        where o.id::text = (storage.foldername(objects.name))[1]
        and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
      or is_admin_user()
    )
  );
