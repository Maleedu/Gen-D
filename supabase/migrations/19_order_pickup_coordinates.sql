-- Pickup-point coordinates for an order, so the Wall can sort open orders by
-- distance from an agent's current location. Nullable: existing rows and the
-- current order-creation flow don't collect these yet, so an order without
-- coordinates simply sorts to the end of the distance ordering client-side.
alter table orders add column point_a_lat double precision;
alter table orders add column point_a_lng double precision;
