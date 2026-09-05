-- Reconstructed from live schema introspection during a `supabase db pull`
-- (see 26_handle_new_user_on_signup.sql's note on why this is hand-authored).
--
-- 20_protect_privileged_profile_columns.sql's trigger pinned
-- avg_rating_as_agent, completed_deliveries_count, and last_delivered_at
-- back to their old value on any non-admin update — but those columns are
-- legitimately written by update_agent_rating and count_completed_delivery
-- (07_ratings_stats_and_gating.sql), which run as the customer or agent's
-- own request (e.g. verify_delivery_seal flipping an order to delivered).
-- Neither of those callers is an admin, so the trigger was silently
-- reverting its own gamification/rating pipeline, not just blocking the
-- self-promotion case it was meant for. Narrows protection down to just
-- is_agent_verified and is_admin — 34_fix_profile_column_grants_properly.sql
-- covers the other three with a real column-level grant instead.
create or replace function protect_privileged_profile_columns()
returns trigger as $$
begin
  if is_admin_user() then
    return new;
  end if;

  new.is_agent_verified := old.is_agent_verified;
  new.is_admin := old.is_admin;

  return new;
end;
$$ language plpgsql security definer;
