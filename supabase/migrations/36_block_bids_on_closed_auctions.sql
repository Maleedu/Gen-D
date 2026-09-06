-- Backfill: this migration already exists live (applied via Supabase MCP as
-- version 20260906133335 / "block_bids_on_closed_auctions", tracked in
-- supabase_migrations.schema_migrations) but was never saved to this folder
-- until now. Statements below are copied verbatim from that table, not
-- reconstructed from schema introspection.
--
-- Blocks placing or changing a bid once the order it belongs to is no
-- longer 'open' (auction finalised, cancelled, etc.) — previously nothing
-- checked this, so an agent could submit a bid that could never actually
-- be selected.
create or replace function public.enforce_bid_order_open()
returns trigger
language plpgsql
security definer
as $$
declare
  v_status public.order_status;
begin
  select status into v_status from public.orders where id = new.order_id;

  if v_status is null then
    raise exception 'Order not found for this bid';
  end if;

  if v_status <> 'open' then
    raise exception 'This auction has already closed — bids can no longer be placed or changed';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_bid_order_open
before insert or update on public.bids
for each row execute function public.enforce_bid_order_open();
