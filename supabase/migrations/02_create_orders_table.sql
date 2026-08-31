create type delivery_speed as enum ('standard', 'express', 'super_fast');
create type order_status as enum ('open', 'accepted', 'picked_up', 'delivered', 'cancelled');

create table orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id),
  status order_status not null default 'open',

  item_description text not null,
  item_category text not null,
  photo_url text,

  point_a_address text not null,
  point_b_address text not null,

  delivery_speed delivery_speed not null default 'standard',
  price_paise integer not null,

  accepted_agent_id uuid references profiles(id),

  created_at timestamptz not null default now()
);

alter table orders enable row level security;

create policy "orders: anyone can see open orders"
  on orders for select
  using (status = 'open' or customer_id = auth.uid() or accepted_agent_id = auth.uid());

create policy "orders: customer creates own"
  on orders for insert
  with check (auth.uid() = customer_id);

create policy "orders: customer or accepted agent can update"
  on orders for update
  using (auth.uid() = customer_id or auth.uid() = accepted_agent_id);