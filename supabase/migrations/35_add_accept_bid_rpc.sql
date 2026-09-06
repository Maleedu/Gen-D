-- Backfill: this migration already exists live (applied via Supabase MCP as
-- version 20260906131705 / "add_accept_bid_rpc", tracked in
-- supabase_migrations.schema_migrations) but was never saved to this folder
-- until now. Statements below are copied verbatim from that table, not
-- reconstructed from schema introspection. See docs/bid-selection-accept-bid-handover.md
-- for the mobile-side work this backs.
--
-- Lets a customer select a winning bid on their own open auction order.
-- Mirrors the exact column changes the existing "agent accepts an open
-- order" flow makes (accepted_agent_id, status -> 'accepted'), so the
-- same AFTER/BEFORE triggers already in place (pickup OTP generation,
-- priority-window gate, super-fast gate) apply identically here — no
-- duplicate business logic, and an ineligible winning bidder is rejected
-- with the same clear error message those triggers already raise.
create or replace function public.accept_bid(p_order_id uuid, p_bid_id uuid)
returns public.orders
language plpgsql
security definer
as $$
declare
  v_order public.orders;
  v_bid_agent_id uuid;
  v_bid_offer_paise integer;
begin
  select * into v_order from public.orders where id = p_order_id;

  if v_order.id is null then
    raise exception 'Order not found';
  end if;

  if v_order.customer_id <> auth.uid() then
    raise exception 'Only the customer who posted this order can select a bid';
  end if;

  if v_order.status <> 'open' then
    raise exception 'This order is no longer open for bid selection';
  end if;

  select agent_id, offer_paise into v_bid_agent_id, v_bid_offer_paise
  from public.bids
  where id = p_bid_id and order_id = p_order_id;

  if v_bid_agent_id is null then
    raise exception 'That bid could not be found for this order';
  end if;

  update public.orders
  set accepted_agent_id = v_bid_agent_id,
      status = 'accepted',
      price_paise = v_bid_offer_paise
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.accept_bid(uuid, uuid) from public;
grant execute on function public.accept_bid(uuid, uuid) to authenticated;
