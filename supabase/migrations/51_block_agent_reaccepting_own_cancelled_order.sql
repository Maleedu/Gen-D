-- After agent_cancel_order (migration 49) reopens an order, nothing
-- stopped the SAME agent from immediately re-accepting the order they
-- just backed out of — the order was meant to be "reopened for another
-- agent" (see the push-notification copy in handleAgentCancelOrder), not
-- handed straight back to the one who couldn't complete it.
--
-- Fix: tighten the accept policy's WITH CHECK so an agent can't set
-- themselves as accepted_agent_id on an order they already have a row
-- against in agent_cancellations. Enforced at the RLS level, so it holds
-- regardless of what the client does.
--
-- Paired with a client-side fix in mobile/app/(tabs)/wall.tsx: fetchOrders
-- now also excludes these orders from that agent's own Wall listing, so
-- they don't see an Accept button that would silently fail RLS.

alter policy "orders: agent accepts an open order"
  on public.orders
  with check (
    accepted_agent_id = auth.uid()
    and not exists (
      select 1 from public.agent_cancellations ac
      where ac.order_id = orders.id and ac.agent_id = auth.uid()
    )
  );
