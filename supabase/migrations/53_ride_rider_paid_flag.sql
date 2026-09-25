-- Already applied to the live project via Supabase MCP on 2026-09-25/26; kept here so local files match.
alter table public.orders add column if not exists rider_paid_at timestamptz;

create or replace function public.rider_mark_paid(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_order orders%rowtype;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if v_order.order_type <> 'ride' then raise exception 'This function is only for ride orders'; end if;
  if v_order.customer_id is distinct from auth.uid() then raise exception 'Only the rider can mark this ride as paid'; end if;
  if v_order.status <> 'picked_up' then raise exception 'Ride is not in progress'; end if;
  if v_order.arrived_at is null then raise exception 'The driver has not arrived at the drop-off yet'; end if;
  if v_order.rider_paid_at is null then update orders set rider_paid_at = now() where id = p_order_id; end if;
  return true;
end; $$;

revoke all on function public.rider_mark_paid(uuid) from public, anon;
grant execute on function public.rider_mark_paid(uuid) to authenticated;
