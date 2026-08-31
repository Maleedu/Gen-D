create type rater_role as enum ('customer', 'agent');
create type complaint_status as enum ('open', 'investigating', 'resolved', 'dismissed');

create table ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  rater_id uuid not null references profiles(id),
  ratee_id uuid not null references profiles(id),
  rater_role rater_role not null,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique(order_id, rater_id)
);

create table complaints (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  raised_by uuid not null references profiles(id),
  reason text not null,
  status complaint_status not null default 'open',
  created_at timestamptz not null default now()
);

alter table ratings enable row level security;
alter table complaints enable row level security;

create policy "ratings: public read"
  on ratings for select using (true);

create policy "ratings: rater inserts own for their completed order"
  on ratings for insert
  with check (
    auth.uid() = rater_id
    and exists (select 1 from orders o where o.id = ratings.order_id
      and o.status = 'delivered'
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );

create policy "complaints: order participants"
  on complaints for all
  using (
    exists (select 1 from orders o where o.id = complaints.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );