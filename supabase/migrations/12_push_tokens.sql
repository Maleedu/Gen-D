create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  expo_push_token text not null,
  platform text check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  unique(profile_id, expo_push_token)
);

alter table push_tokens enable row level security;

create policy "push_tokens: owner manages own"
  on push_tokens for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);