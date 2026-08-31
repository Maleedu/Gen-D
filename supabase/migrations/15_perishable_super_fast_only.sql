alter table orders add column is_perishable boolean not null default false;

alter table orders add constraint perishable_requires_super_fast
  check (not is_perishable or delivery_speed = 'super_fast');