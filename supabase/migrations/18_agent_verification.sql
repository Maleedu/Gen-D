-- Aggregate "may this agent accept orders" switch, set by an admin once their
-- documents (agent_documents.verification_status) have been reviewed.
-- Distinct from agent_documents.verification_status, which is per-document.
alter table profiles add column is_agent_verified boolean not null default false;

-- Covered by the existing "admin: update any profile (verification flags)"
-- policy from 13_admin_access.sql — no new policy needed here.
