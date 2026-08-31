alter table orders add column purchased_insurance boolean not null default false;
alter table orders add column declared_value_paise integer;