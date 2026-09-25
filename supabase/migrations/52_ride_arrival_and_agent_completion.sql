-- Already applied to the live project via Supabase MCP on 2026-09-25/26; kept here so local files match.
alter table public.orders add column if not exists arrived_at timestamptz;

create or replace function public.arrive_at_dropoff(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_order orders%rowtype;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if v_order.order_type <> 'ride' then raise exception 'This function is only for ride orders'; end if;
  if v_order.accepted_agent_id is distinct from auth.uid() then raise exception 'Only the assigned agent can mark arrival'; end if;
  if v_order.status <> 'picked_up' then raise exception 'Ride is not in progress'; end if;
  if v_order.arrived_at is null then update orders set arrived_at = now() where id = p_order_id; end if;
  return true;
end; $$;

create or replace function public.agent_complete_ride(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_order orders%rowtype;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if v_order.order_type <> 'ride' then raise exception 'This function is only for ride orders'; end if;
  if v_order.accepted_agent_id is distinct from auth.uid() then raise exception 'Only the assigned agent can complete this ride'; end if;
  if v_order.status <> 'picked_up' then raise exception 'Ride is not in progress'; end if;
  if v_order.arrived_at is null then raise exception 'Mark arrival at the drop-off before completing the ride'; end if;
  update orders set status = 'delivered' where id = p_order_id;
  return true;
end; $$;

revoke all on function public.arrive_at_dropoff(uuid) from public, anon;
revoke all on function public.agent_complete_ride(uuid) from public, anon;
grant execute on function public.arrive_at_dropoff(uuid) to authenticated;
grant execute on function public.agent_complete_ride(uuid) to authenticated;
