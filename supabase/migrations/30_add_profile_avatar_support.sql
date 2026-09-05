-- Reconstructed from live schema introspection during a `supabase db pull`
-- (see 26_handle_new_user_on_signup.sql's note on why this is hand-authored).
--
-- Avatar built now (column + bucket), not deferred to a placeholder.
alter table profiles add column avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars: anyone can view"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: owner uploads to their own folder"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: owner replaces their own"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
