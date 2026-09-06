-- Backfill: this migration already exists live (applied via Supabase MCP as
-- version 20260905085815 / "fix_agent_documents_self_approval_gap", tracked
-- in supabase_migrations.schema_migrations) but was never saved to this
-- folder until now. Statements below are copied verbatim from that table,
-- not reconstructed from schema introspection.
--
-- 05_agent_documents.sql's original "agent_documents: owner manages own"
-- policy was FOR ALL, ownership-only — which let an agent UPDATE their own
-- document row, including verification_status, effectively letting them
-- self-approve their own KYC. Same shape of gap as 20_protect_privileged_profile_columns.sql
-- fixed on profiles, applied here to agent_documents instead.

-- Anon should never touch this at all
revoke all on agent_documents from anon;

-- No one should ever delete a submitted KYC document — permanent audit trail
revoke delete on agent_documents from authenticated;

-- Replace the blanket "ALL, ownership-only" policy with narrow, correct ones
drop policy if exists "agent_documents: owner manages own" on agent_documents;

create policy "agent_documents: owner can view own"
  on agent_documents for select
  using (auth.uid() = profile_id);

create policy "agent_documents: owner can upload own"
  on agent_documents for insert
  with check (
    auth.uid() = profile_id
    and verification_status = 'pending'
    and verified_at is null
  );

-- No owner UPDATE policy is created — only "admin: update agent_documents"
-- (is_admin_user()) can transition verification_status going forward.
