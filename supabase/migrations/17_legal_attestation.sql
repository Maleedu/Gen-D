alter table orders add column legal_attestation_confirmed boolean not null default false;

alter table orders add constraint legal_attestation_required
  check (legal_attestation_confirmed = true);