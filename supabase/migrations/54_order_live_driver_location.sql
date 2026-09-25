-- Already applied to the live project via Supabase MCP on 2026-09-25/26; kept here so local files match.
create table if not exists public.order_live_locations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);
alter table public.order_live_locations enable row level security;

create policy "live location: order participants read" on public.order_live_locations for select
using (exists (select 1 from public.orders o where o.id = order_live_locations.order_id and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid())));

create or replace function public.update_driver_location(p_order_id uuid, p_lat double precision, p_lng double precision)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_order orders%rowtype;
begin
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then raise exception 'Invalid coordinates'; end if;
  select * into v_order from orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if v_order.accepted_agent_id is distinct from auth.uid() then raise exception 'Only the assigned agent can share location for this order'; end if;
  if v_order.status not in ('accepted', 'picked_up') then raise exception 'Order is not active'; end if;
  insert into order_live_locations (order_id, agent_id, lat, lng, updated_at) values (p_order_id, auth.uid(), p_lat, p_lng, now())
  on conflict (order_id) do update set agent_id = excluded.agent_id, lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at;
  return true;
end; $$;

revoke all on function public.update_driver_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.update_driver_location(uuid, double precision, double precision) to authenticated;

create or replace function public.clear_live_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.order_live_locations where order_id = new.id;
  return new;
end; $$;

drop trigger if exists trg_clear_live_location on public.orders;
create trigger trg_clear_live_location after update of status, accepted_agent_id on public.orders for each row
when (new.status in ('delivered', 'cancelled', 'open') or new.accepted_agent_id is distinct from old.accepted_agent_id)
execute function public.clear_live_location();

alter publication supabase_realtime add table public.order_live_locations;
