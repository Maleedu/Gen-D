alter table profiles add column is_business boolean not null default false;
alter table profiles add column company_name text;
alter table profiles add column business_registration_number text;

alter table profiles add column default_pickup_address text;
alter table profiles add column default_pickup_lat double precision;
alter table profiles add column default_pickup_lng double precision;