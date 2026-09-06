-- Backfill: this migration already exists live (applied via Supabase MCP as
-- version 20260905085923 / "add_admin_read_to_agent_documents_storage",
-- tracked in supabase_migrations.schema_migrations) but was never saved to
-- this folder until now. Statement below is copied verbatim from that
-- table, not reconstructed from schema introspection.
--
-- 08_storage_buckets.sql's "agent-documents: owner reads own" policy only
-- let an agent read their own uploaded files — admins had no storage-level
-- access to review them, only the agent_documents table row (see
-- 39_fix_agent_documents_self_approval_gap.sql's admin update policy). This
-- adds the matching read access for the actual files.
create policy "agent-documents: admin can view any"
  on storage.objects for select
  using (bucket_id = 'agent-documents' and is_admin_user());
