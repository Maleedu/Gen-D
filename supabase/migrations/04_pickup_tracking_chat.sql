create table pickup_verifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  otp_code text not null,
  otp_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table agent_location_pings (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id) on delete cascade,
  agent_id uuid not null references profiles(id),
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now()
);

create table order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table pickup_verifications enable row level security;
alter table agent_location_pings enable row level security;
alter table order_messages enable row level security;

-- Helper pattern used below: "is this person the customer or the accepted agent on this order?"

create policy "pickup: order participants"
  on pickup_verifications for all
  using (
    exists (select 1 from orders o where o.id = pickup_verifications.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );

create policy "pings: agent inserts own"
  on agent_location_pings for insert
  with check (auth.uid() = agent_id);

create policy "pings: order participants read"
  on agent_location_pings for select
  using (
    exists (select 1 from orders o where o.id = agent_location_pings.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );

create policy "messages: order participants read"
  on order_messages for select
  using (
    exists (select 1 from orders o where o.id = order_messages.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );

create policy "messages: order participants send"
  on order_messages for insert
  with check (
    auth.uid() = sender_id
    and exists (select 1 from orders o where o.id = order_messages.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );