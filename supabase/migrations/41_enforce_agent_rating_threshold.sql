-- Backfill: this migration already exists live (applied via Supabase MCP as
-- version 20260905150100 / "enforce_agent_rating_threshold", tracked in
-- supabase_migrations.schema_migrations) but was never saved to this folder
-- until now. Statements below are copied verbatim from that table, not
-- reconstructed from schema introspection.
--
-- Nothing previously stopped a brand-new agent from rating a customer —
-- this requires an agent to have completed at least 10 deliveries first,
-- so ratings from that side carry some track record behind them.
create or replace function public.enforce_agent_rating_threshold()
returns trigger
language plpgsql
security definer
as $function$
declare
  v_completed integer;
begin
  if new.rater_role = 'agent' then
    select completed_deliveries_count into v_completed from profiles where id = new.rater_id;
    if v_completed is null or v_completed < 10 then
      raise exception 'Agents must complete at least 10 deliveries before they can rate customers';
    end if;
  end if;
  return new;
end;
$function$;

create trigger trg_enforce_agent_rating_threshold
  before insert on ratings
  for each row
  execute function enforce_agent_rating_threshold();
