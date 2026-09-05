-- avg_rating_as_agent, completed_deliveries_count, and last_delivered_at are
-- never meant to be written by a direct client update — only by the
-- security-definer triggers that maintain them. 33_fix_profile_protection_overreach.sql
-- stopped the trigger from pinning them (since that also blocked those same
-- triggers), so enforce it properly at the grant level instead: a
-- security-definer function's writes aren't subject to the calling role's
-- column privileges, but a plain PostgREST client update is.
--
-- A column-level REVOKE alone doesn't override the blanket table-level
-- UPDATE grant Postgres already has in place, so the fix has to drop that
-- grant entirely and re-grant UPDATE per-column on everything that should
-- stay directly user-editable.
revoke update on profiles from authenticated;

grant update (
  first_name, last_name, date_of_birth, phone_number, address, landmark, occupation,
  is_admin, is_agent_verified, is_business, company_name, business_registration_number,
  default_pickup_address, default_pickup_lat, default_pickup_lng, avatar_url,
  active_destination_address, active_destination_lat, active_destination_lng, active_destination_set_at
) on profiles to authenticated;
