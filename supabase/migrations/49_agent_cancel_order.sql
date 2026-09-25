-- Agent-initiated order cancellation (before or after pickup).
-- Backfilled from the migration already applied live via Supabase MCP.

create type public.agent_cancellation_stage as enum ('before_pickup', 'after_pickup');

create table public.agent_cancellations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  agent_id uuid not null references public.profiles(id),
  stage public.agent_cancellation_stage not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index agent_cancellations_agent_id_idx on public.agent_cancellations(agent_id);

alter table public.agent_cancellations enable row level security;
create policy "agent_cancellations: agent can view own"
  on public.agent_cancellations for select using (auth.uid() = agent_id);

create or replace function public.agent_cancel_order(p_order_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_stage text;
  v_trimmed_reason text := trim(p_reason);
begin
  if v_trimmed_reason = '' then
    raise exception 'A cancellation reason is required.';
  end if;

  select id, status, accepted_agent_id, customer_id into v_order
  from public.orders
  where id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order not found.';
  end if;
  if v_order.accepted_agent_id is distinct from auth.uid() then
    raise exception 'Only the assigned agent can cancel this delivery.';
  end if;
  if v_order.status not in ('accepted', 'picked_up') then
    raise exception 'This order can no longer be cancelled by the agent.';
  end if;

  v_stage := case v_order.status when 'accepted' then 'before_pickup' else 'after_pickup' end;

  update public.orders
  set status = 'open', accepted_agent_id = null
  where id = p_order_id;

  insert into public.agent_cancellations (order_id, agent_id, stage, reason)
  values (p_order_id, auth.uid(), v_stage::agent_cancellation_stage, v_trimmed_reason);

  if v_stage = 'after_pickup' then
    insert into public.complaints (order_id, raised_by, reason, status)
    values (p_order_id, auth.uid(), v_trimmed_reason, 'open');
  end if;

  return v_stage;
end;
$$;

grant execute on function public.agent_cancel_order(uuid, text) to authenticated;

-- Default PUBLIC/anon execute grants are revoked separately so the
-- security-definer function cannot be invoked by unauthenticated callers.
revoke execute on function public.agent_cancel_order(uuid, text) from public, anon;
