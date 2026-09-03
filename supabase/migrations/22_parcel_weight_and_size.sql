-- Weight and size bucket, so an agent on the Wall can judge at a glance
-- whether they can carry a parcel. Both required going forward.
--
-- Columns start nullable, get backfilled, then are locked down to
-- not-null + checked — doing it in that order (rather than a NOT NULL
-- DEFAULT 0) avoids the previous version's bug: DEFAULT 0 satisfied the
-- NOT NULL fill-in but then failed weight_kg_positive's `> 0` check
-- against those same backfilled rows. 1 kg / 'medium' are just
-- placeholders for whatever pre-existing rows have no real weight
-- recorded — same idea as legal_attestation_confirmed's backfill in
-- 17_legal_attestation.sql, just done explicitly instead of via DEFAULT.
--
-- `if not exists` / `drop ... if exists` throughout so this is safe to
-- re-run — including re-running it as a retry of a prior attempt that
-- may have partially applied before failing.
alter table orders add column if not exists weight_kg numeric;
alter table orders add column if not exists parcel_size text;

update orders set weight_kg = 1 where weight_kg is null;
update orders set parcel_size = 'medium' where parcel_size is null;

alter table orders alter column weight_kg set not null;
alter table orders alter column parcel_size set not null;

alter table orders drop constraint if exists weight_kg_positive;
alter table orders add constraint weight_kg_positive
  check (weight_kg > 0);

alter table orders drop constraint if exists parcel_size_valid;
alter table orders add constraint parcel_size_valid
  check (parcel_size in ('small', 'medium', 'large'));
