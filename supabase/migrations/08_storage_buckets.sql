insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('agent-documents', 'agent-documents', false)
on conflict (id) do nothing;

create policy "item-photos: anyone can view"
  on storage.objects for select
  using (bucket_id = 'item-photos');

create policy "item-photos: owner uploads to their own folder"
  on storage.objects for insert
  with check (bucket_id = 'item-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "agent-documents: owner reads own"
  on storage.objects for select
  using (bucket_id = 'agent-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "agent-documents: owner uploads own"
  on storage.objects for insert
  with check (bucket_id = 'agent-documents' and (storage.foldername(name))[1] = auth.uid()::text);