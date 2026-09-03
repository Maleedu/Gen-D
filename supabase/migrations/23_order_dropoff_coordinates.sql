-- Dropoff-point coordinates for an order, mirroring point_a_lat/point_a_lng
-- from 19_order_pickup_coordinates.sql. Nullable for the same reason: existing
-- rows have no dropoff coordinates, and geocoding failures on the Post Item
-- screen should block the post with an error rather than silently store a
-- null/wrong pair, so there's no backfill story to worry about here.
alter table orders add column if not exists point_b_lat double precision;
alter table orders add column if not exists point_b_lng double precision;
