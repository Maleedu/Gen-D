-- Track when an agent last completed a delivery
alter table profiles add column last_delivered_at timestamptz;

-- Update the delivery-counting trigger to also stamp last_delivered_at
create or replace function count_completed_delivery()
returns trigger as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.accepted_agent_id is not null then
    update profiles
    set completed_deliveries_count = completed_deliveries_count + 1,
        last_delivered_at = now()
    where id = new.accepted_agent_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Update the super_fast gate to also require recent activity
create or replace function enforce_super_fast_gate()
returns trigger as $$
declare
  agent_rating numeric;
  agent_deliveries integer;
  agent_last_delivered timestamptz;
begin
  if new.status = 'accepted' and old.status = 'open' and new.delivery_speed = 'super_fast' then
    select avg_rating_as_agent, completed_deliveries_count, last_delivered_at
    into agent_rating, agent_deliveries, agent_last_delivered
    from profiles where id = new.accepted_agent_id;

    if agent_deliveries < 5 or agent_rating is null or agent_rating < 4.5
       or agent_last_delivered is null or agent_last_delivered < now() - interval '7 days' then
      raise exception 'This agent does not currently qualify for super fast orders (needs 4.5+ rating, 5+ deliveries, and activity in the last 7 days)';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Update the priority-window gate the same way
create or replace function enforce_priority_window()
returns trigger as $$
declare
  agent_rating numeric;
  agent_deliveries integer;
  agent_last_delivered timestamptz;
begin
  if new.status = 'accepted' and old.status = 'open'
     and (now() - old.created_at) < interval '5 minutes' then

    select avg_rating_as_agent, completed_deliveries_count, last_delivered_at
    into agent_rating, agent_deliveries, agent_last_delivered
    from profiles where id = new.accepted_agent_id;

    if agent_deliveries < 5 or agent_rating is null or agent_rating < 4.5
       or agent_last_delivered is null or agent_last_delivered < now() - interval '7 days' then
      raise exception 'This order is in its first 5 minutes, reserved for active top-rated agents. Try again shortly.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;