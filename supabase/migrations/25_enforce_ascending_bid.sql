-- 24_enforce_minimum_bid.sql only checked a submitted offer against the
-- order's static min_bid_paise. That's not a real ascending auction: once
-- someone's bid clears the minimum, a second bidder could still undercut
-- them (as long as they clear the minimum too), and the leader could lower
-- their own bid right back down to the minimum. Replaces that function with
-- the real rule: every bid — insert or update — must strictly exceed the
-- higher of (a) the order's minimum and (b) the current highest offer_paise
-- standing on that order, across every agent. Same trigger as before
-- (trg_enforce_minimum_bid already calls this function by name), same
-- create-or-replace pattern 21_fix_privileged_trigger_for_service_role.sql
-- used to patch an earlier trigger in place.
create or replace function enforce_minimum_bid()
returns trigger as $$
declare
  min_paise integer;
  highest_paise integer;
  floor_paise integer;
begin
  select min_bid_paise into min_paise from orders where id = new.order_id;

  -- Fixed-price orders (or any order with no minimum set) have nothing to
  -- enforce against — same carve-out as before.
  if min_paise is null then
    return new;
  end if;

  -- Highest offer currently standing on this order, across every agent.
  -- This is a BEFORE trigger, so on an UPDATE the table still holds this
  -- row's pre-update value when this SELECT runs — that's exactly what
  -- makes a leading bidder's own current bid count as part of "the
  -- highest": they can't lower it, only raise it, until someone else
  -- actually clears it.
  select coalesce(max(offer_paise), 0) into highest_paise
  from bids where order_id = new.order_id;

  floor_paise := greatest(min_paise, highest_paise);

  if new.offer_paise <= floor_paise then
    raise exception 'Bid of ₹% must exceed the current floor of ₹% for this order (the higher of its minimum and the current highest bid)',
      to_char(new.offer_paise / 100.0, 'FM999999990.00'),
      to_char(floor_paise / 100.0, 'FM999999990.00');
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- RLS on bids ("bids: agent manages own bid") deliberately only lets an
-- agent see their own bid rows — not competing agents' amounts or
-- identities. The Wall now needs the current highest offer per order to
-- validate and display against, so this exposes only that one aggregate
-- number per order, computed with elevated privilege, rather than loosening
-- the SELECT policy and leaking individual competing bids.
create or replace function highest_bids_for_orders(p_order_ids uuid[])
returns table(order_id uuid, highest_offer_paise integer) as $$
  select bids.order_id, max(bids.offer_paise) as highest_offer_paise
  from bids
  where bids.order_id = any(p_order_ids)
  group by bids.order_id;
$$ language sql security definer stable;

grant execute on function highest_bids_for_orders(uuid[]) to authenticated;
