-- Reconstructed from live schema introspection during a `supabase db pull`
-- (Docker wasn't available for the CLI's own shadow-db diff, so this was
-- authored by hand from pg_get_functiondef/pg_get_triggerdef output rather
-- than pulled automatically). This trigger already existed live and backs
-- the signup flow from the "Working signup and login flow with auto profile
-- creation" commit — it was applied by hand against the dashboard and never
-- saved as a migration file until now.
--
-- Auto-creates a profiles row the moment a new auth.users row lands, reading
-- the extra fields (first_name, address, is_business, ...) out of the
-- metadata the client passes at signup. This is what lets 01_create_profiles_table's
-- "profiles: user inserts their own" policy go mostly unused in practice —
-- the client doesn't have to insert its own profile row, this trigger beats
-- it to it.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (
    id, first_name, last_name, date_of_birth, phone_number,
    address, landmark, occupation, is_business, company_name
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    nullif(new.raw_user_meta_data->>'date_of_birth', '')::date,
    new.raw_user_meta_data->>'phone_number',
    new.raw_user_meta_data->>'address',
    new.raw_user_meta_data->>'landmark',
    new.raw_user_meta_data->>'occupation',
    coalesce((new.raw_user_meta_data->>'is_business')::boolean, false),
    new.raw_user_meta_data->>'company_name'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
