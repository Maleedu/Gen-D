-- Add fields to track an agent's track record
alter table profiles add column avg_rating_as_agent numeric(3,2);
alter table profiles add column completed_deliveries_count integer not null default 0;

-- Bug fix: this policy was missing — lets any agent accept an order that's still open
create policy "orders: agent accepts an open order"
  on orders for update
  using (status = 'open')
  with check (accepted_agent_id = auth.uid());

-- Whenever a new rating comes in, recalculate that agent's average
create or replace function update_agent_rating()
returns trigger as $$
begin
  update profiles
  set avg_rating_as_agent = (
    select avg(stars) from ratings
    where ratee_id = new.ratee_id and rater_role = 'customer'
  )
  where id = new.ratee_id;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_update_agent_rating
  after insert on ratings
  for each row execute function update_agent_rating();

-- Whenever an order becomes 'delivered', count it for that agent
create or replace function count_completed_delivery()
returns trigger as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.accepted_agent_id is not null then
    update profiles
    set completed_deliveries_count = completed_deliveries_count + 1
    where id = new.accepted_agent_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_count_completed_delivery
  after update on orders
  for each row execute function count_completed_delivery();

-- The actual gate: block an agent from accepting a super_fast order if they don't qualify
create or replace function enforce_super_fast_gate()
returns trigger as $$
declare
  agent_rating numeric;
  agent_deliveries integer;
begin
  if new.status = 'accepted' and old.status = 'open' and new.delivery_speed = 'super_fast' then
    select avg_rating_as_agent, completed_deliveries_count
    into agent_rating, agent_deliveries
    from profiles where id = new.accepted_agent_id;

    if agent_deliveries < 5 or agent_rating is null or agent_rating < 4.5 then
      raise exception 'This agent does not yet qualify for super fast orders (needs 4.5+ rating and 5+ completed deliveries)';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_enforce_super_fast_gate
  before update on orders
  for each row execute function enforce_super_fast_gate();