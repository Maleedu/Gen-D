-- "profiles: user updates their own" (01_create_profiles_table.sql) has no
-- WITH CHECK restricting columns, so a user can currently UPDATE any column
-- on their own row via a plain client call — including is_agent_verified,
-- is_admin, avg_rating_as_agent, completed_deliveries_count, and
-- last_delivered_at. That would let an agent self-verify or self-promote to
-- admin, and defeats the super_fast/priority-window rating gates.
--
-- RLS is row-level, not column-level, so the fix is a trigger: for any
-- non-admin update, silently pin these trust/gating columns back to their
-- existing value before the write lands. Admin updates (already gated by
-- "admin: update any profile (verification flags)" via is_admin_user()) are
-- left untouched — that's the intended way to flip these fields.
create or replace function protect_privileged_profile_columns()
returns trigger as $$
begin
  if is_admin_user() then
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

create trigger trg_protect_privileged_profile_columns
  before update on profiles
  for each row execute function protect_privileged_profile_columns();
