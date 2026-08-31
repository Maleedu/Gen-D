create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  phone_number text,
  address text,
  landmark text,
  occupation text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: anyone can read"
  on profiles for select
  using (true);

create policy "profiles: user inserts their own"
  on profiles for insert
  with check (auth.uid() = id);

create policy "profiles: user updates their own"
  on profiles for update
  using (auth.uid() = id);