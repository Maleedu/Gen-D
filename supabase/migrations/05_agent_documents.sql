create type doc_type as enum ('aadhaar', 'driving_licence', 'vehicle_rc', 'other');
create type verification_status as enum ('pending', 'verified', 'rejected');
create type vehicle_type as enum ('bike', 'car', 'bus', 'other', 'none');

create table agent_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  doc_type doc_type not null,
  storage_path text not null,
  verification_status verification_status not null default 'pending',
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table agent_vehicles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  vehicle_type vehicle_type not null default 'none',
  registration_number text,
  created_at timestamptz not null default now()
);

alter table agent_documents enable row level security;
alter table agent_vehicles enable row level security;

create policy "agent_documents: owner manages own"
  on agent_documents for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "agent_vehicles: owner manages own"
  on agent_vehicles for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);