-- Backfill: this migration already exists live (applied via Supabase MCP as
-- version 20260907091838 / "scope_priority_window_to_super_fast_only_3min",
-- tracked in supabase_migrations.schema_migrations) but was never saved to
-- this folder until now. Statement below is copied verbatim from that table,
-- not reconstructed from schema introspection.
--
-- Fixes two bugs in enforce_priority_window() (09_priority_window.sql,
-- updated by 10_inactivity_penalty.sql): the trigger had no
-- delivery_speed = 'super_fast' condition, so it was blocking
-- under-qualified agents from accepting ANY order (standard/express
-- included) in its first 5 minutes, not just Priority orders. Also shortens
-- the window from 5 minutes to 3.
create or replace function public.enforce_priority_window()
returns trigger
language plpgsql
security definer
as $function$
declare
  agent_rating numeric;
  agent_deliveries integer;
  agent_last_delivered timestamptz;
begin
  -- Priority window only applies to super_fast (displayed as "Priority" in the
  -- app) orders. Standard and express are open to every agent immediately,
  -- with no rating/delivery-count head-start period at all.
  if new.status = 'accepted' and old.status = 'open'
     and old.delivery_speed = 'super_fast'
     and (now() - old.created_at) < interval '3 minutes' then

    select avg_rating_as_agent, completed_deliveries_count, last_delivered_at
    into agent_rating, agent_deliveries, agent_last_delivered
    from profiles where id = new.accepted_agent_id;

    if agent_deliveries < 5 or agent_rating is null or agent_rating < 4.5
       or agent_last_delivered is null or agent_last_delivered < now() - interval '7 days' then
      raise exception 'This priority order is in its first 3 minutes, reserved for active top-rated agents. Try again shortly.';
    end if;
  end if;
  return new;
end;
$function$;
