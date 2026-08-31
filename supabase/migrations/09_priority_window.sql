create or replace function enforce_priority_window()
returns trigger as $$
declare
  agent_rating numeric;
  agent_deliveries integer;
begin
  if new.status = 'accepted' and old.status = 'open'
     and (now() - old.created_at) < interval '5 minutes' then

    select avg_rating_as_agent, completed_deliveries_count
    into agent_rating, agent_deliveries
    from profiles where id = new.accepted_agent_id;

    if agent_deliveries < 5 or agent_rating is null or agent_rating < 4.5 then
      raise exception 'This order is in its first 5 minutes, reserved for top-rated agents. Try again shortly.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_enforce_priority_window
  before update on orders
  for each row execute function enforce_priority_window();