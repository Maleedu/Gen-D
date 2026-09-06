-- Backfill: this migration already exists live (applied via Supabase MCP as
-- version 20260906151752 / "simplify_enforce_minimum_bid_remove_ascending_rule",
-- tracked in supabase_migrations.schema_migrations) but was never saved to
-- this folder until now. Statement below is copied verbatim from that table,
-- not reconstructed from schema introspection.
--
-- Supersedes 25_enforce_ascending_bid.sql's version of this same function
-- (create-or-replace, same trigger — trg_enforce_minimum_bid already calls
-- it by name). That migration required a bid to strictly exceed the current
-- highest standing offer; this reverts to a plain floor check against the
-- order's min_bid_paise, dropping the ascending-auction requirement
-- entirely. This is the version actually live today — see
-- docs/remove-ascending-bid-copy-handover.md for the mobile-side cleanup
-- that assumed this rule.
CREATE OR REPLACE FUNCTION public.enforce_minimum_bid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  min_paise integer;
begin
  select min_bid_paise into min_paise from orders where id = new.order_id;

  -- Fixed-price orders (or any order with no minimum set) have nothing to
  -- enforce against — same carve-out as before.
  if min_paise is null then
    return new;
  end if;

  -- Any agent can bid any amount at or above the order's floor, independent
  -- of what other agents have bid. No "must exceed current highest" rule —
  -- that was backwards (it made bidding more competitive = more expensive).
  if new.offer_paise < min_paise then
    raise exception 'Bid of ₹% must be at least the minimum of ₹% for this order',
      to_char(new.offer_paise / 100.0, 'FM999999990.00'),
      to_char(min_paise / 100.0, 'FM999999990.00');
  end if;

  return new;
end;
$function$
