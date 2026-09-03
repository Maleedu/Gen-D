-- 20_protect_privileged_profile_columns.sql's trigger only lets an update
-- through when is_admin_user() is true, which reads auth.uid(). But
-- auth.uid() is NULL for any connection that isn't going through PostgREST
-- with a user JWT — the Dashboard SQL Editor (runs as the Postgres owner
-- role) and service-role connections both hit this. That made the trigger
-- silently revert is_agent_verified/etc. even for trusted admin scripts
-- (e.g. supabase/seed.sql), not just for the self-update case it was meant
-- to block.
--
-- Fix: also let the write through when auth.uid() is null. This can't be
-- used to bypass the original hole from an authenticated anon client,
-- because the row itself is only reachable via the
-- "profiles: user updates their own" policy, which requires
-- auth.uid() = id — a null auth.uid() never matches a row's id, so RLS
-- blocks those requests before this trigger ever runs.
create or replace function protect_privileged_profile_columns()
returns trigger as $$
begin
  if is_admin_user() or auth.uid() is null then
    return new;
  end if;

  new.is_agent_verified := old.is_agent_verified;
  new.is_admin := old.is_admin;
  new.avg_rating_as_agent := old.avg_rating_as_agent;
  new.completed_deliveries_count := old.completed_deliveries_count;
  new.last_delivered_at := old.last_delivered_at;

  return new;
end;
$$ language plpgsql security definer;
