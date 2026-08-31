alter table profiles add column is_admin boolean not null default false;

create or replace function is_admin_user()
returns boolean as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$ language sql stable security definer;

create policy "admin: read all agent_documents"
  on agent_documents for select using (is_admin_user());
create policy "admin: update agent_documents (approve/reject)"
  on agent_documents for update using (is_admin_user());

create policy "admin: update any profile (verification flags)"
  on profiles for update using (is_admin_user());

create policy "admin: read all orders"
  on orders for select using (is_admin_user());
create policy "admin: update any order"
  on orders for update using (is_admin_user());

create policy "admin: read all complaints"
  on complaints for select using (is_admin_user());
create policy "admin: update complaints"
  on complaints for update using (is_admin_user());