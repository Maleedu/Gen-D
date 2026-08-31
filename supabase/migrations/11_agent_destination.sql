alter table profiles add column active_destination_address text;
alter table profiles add column active_destination_lat double precision;
alter table profiles add column active_destination_lng double precision;
alter table profiles add column active_destination_set_at timestamptz;