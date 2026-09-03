-- The Wall's bid input (mobile/app/(tabs)/wall.tsx) only showed the order's
-- min_bid_paise as a placeholder hint — nothing actually checked a submitted
-- offer against it, client-side or here. An agent could bid (or update a
-- bid down to) any positive amount regardless of the order's stated
-- minimum. Client-side validation was added alongside this migration, but
-- that alone is bypassable by anyone calling the API directly, so this is
-- the actual enforcement.
--
-- A plain check constraint can't express this: the minimum lives on
-- orders.min_bid_paise, a different table from bids.offer_paise. Same
-- shape of problem as 09_priority_window.sql's cross-table check, so this
-- follows that trigger pattern rather than 15_perishable_super_fast_only.sql's
-- single-table check.
create or replace function enforce_minimum_bid()
returns trigger as $$
declare
  min_paise integer;
begin
  select min_bid_paise into min_paise from orders where id = new.order_id;

  -- Fixed-price orders (or any order with no minimum set) have nothing to
  -- enforce against.
  if min_paise is not null and new.offer_paise < min_paise then
    raise exception 'Bid of ₹% is below this order''s minimum of ₹%',
      to_char(new.offer_paise / 100.0, 'FM999999990.00'),
      to_char(min_paise / 100.0, 'FM999999990.00');
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger trg_enforce_minimum_bid
  before insert or update on bids
  for each row execute function enforce_minimum_bid();
