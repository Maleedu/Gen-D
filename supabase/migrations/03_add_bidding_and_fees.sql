create type pricing_mode as enum ('fixed', 'auction');
create type fee_status as enum ('pending', 'paid', 'failed');

alter table orders add column pricing_mode pricing_mode not null default 'fixed';
alter table orders add column min_bid_paise integer;
alter table orders alter column price_paise drop not null;

alter table orders add column photo_urls text[] not null default '{}';
alter table orders drop column if exists photo_url;

create table bids (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  agent_id uuid not null references profiles(id),
  offer_paise integer not null,
  created_at timestamptz not null default now(),
  unique(order_id, agent_id)
);

create table platform_fee_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  agent_id uuid not null references profiles(id),
  amount_paise integer not null default 1000,
  status fee_status not null default 'pending',
  created_at timestamptz not null default now()
);

alter table bids enable row level security;
alter table platform_fee_transactions enable row level security;

create policy "bids: agent manages own bid"
  on bids for all using (auth.uid() = agent_id) with check (auth.uid() = agent_id);
create policy "bids: customer views bids on their order"
  on bids for select using (
    exists (select 1 from orders o where o.id = bids.order_id and o.customer_id = auth.uid())
  );

create policy "fees: agent sees their own"
  on platform_fee_transactions for select using (auth.uid() = agent_id);