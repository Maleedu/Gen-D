-- Reconstructed from live schema introspection during a `supabase db pull`
-- (see 26_handle_new_user_on_signup.sql's note on why this is hand-authored).
--
-- 06_ratings_and_complaints.sql's "complaints: order participants" policy
-- was FOR ALL with only a USING clause (no WITH CHECK), which Postgres
-- reuses for inserts too — meaning a participant could raise a complaint
-- attributed to anyone, in any status, and could update or resolve their
-- own complaint despite that being meant as an admin-only action (see
-- "admin: update complaints" in 13_admin_access.sql). Splits it into
-- granular policies matching the intended rule: participants can view and
-- raise (self-attributed, starting `open`) but never edit; only
-- is_admin_user() can transition status.
drop policy "complaints: order participants" on complaints;

create policy "complaints: order participants can view"
  on complaints for select
  using (
    exists (select 1 from orders o where o.id = complaints.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );

create policy "complaints: order participants can raise"
  on complaints for insert
  with check (
    raised_by = auth.uid()
    and status = 'open'
    and exists (select 1 from orders o where o.id = complaints.order_id
      and (o.customer_id = auth.uid() or o.accepted_agent_id = auth.uid()))
  );
