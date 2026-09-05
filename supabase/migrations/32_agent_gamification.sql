-- Reconstructed from live schema introspection during a `supabase db pull`
-- (see 26_handle_new_user_on_signup.sql's note on why this is hand-authored).
--
-- Badges/levels/streaks for agents. Not referenced by the order-tracking
-- handover doc or screen — this is a separate feature that landed the same
-- session, surfaced here purely by reading back what's live.
create table agent_badges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  badge_code text not null,
  earned_at timestamptz not null default now(),
  unique (profile_id, badge_code)
);

alter table agent_badges enable row level security;

create policy "agent badges: anyone can view"
  on agent_badges for select using (true);

-- No insert/update policy on purpose — only the trigger below (security
-- definer) writes to this table.
revoke insert, update, delete on agent_badges from authenticated;

-- Fires whenever a profile is updated; only actually awards anything on the
-- delivery-count/rating thresholds below (checked against the new row, so
-- most profile updates are no-ops here).
create or replace function award_agent_badges()
returns trigger as $$
begin
  if new.completed_deliveries_count >= 1 then
    insert into agent_badges (profile_id, badge_code) values (new.id, 'first_delivery') on conflict do nothing;
  end if;
  if new.completed_deliveries_count >= 10 then
    insert into agent_badges (profile_id, badge_code) values (new.id, 'ten_deliveries') on conflict do nothing;
  end if;
  if new.completed_deliveries_count >= 50 then
    insert into agent_badges (profile_id, badge_code) values (new.id, 'fifty_deliveries') on conflict do nothing;
  end if;
  if new.completed_deliveries_count >= 100 then
    insert into agent_badges (profile_id, badge_code) values (new.id, 'century') on conflict do nothing;
  end if;
  if new.avg_rating_as_agent >= 4.9 and new.completed_deliveries_count >= 10 then
    insert into agent_badges (profile_id, badge_code) values (new.id, 'five_star_hero') on conflict do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_award_agent_badges
  after update on profiles
  for each row execute function award_agent_badges();

-- Level thresholds as a lookup table would drift from this function over
-- time; kept as one inline case/case pair instead so the label and the
-- delivery-count boundary that earns it can never disagree.
create or replace function get_agent_level(p_completed_deliveries integer)
returns table(level_number integer, level_label text, deliveries_into_level integer, deliveries_to_next_level integer)
as $$
  select
    case when p_completed_deliveries >= 250 then 6 when p_completed_deliveries >= 100 then 5
         when p_completed_deliveries >= 50 then 4 when p_completed_deliveries >= 20 then 3
         when p_completed_deliveries >= 5 then 2 else 1 end,
    case when p_completed_deliveries >= 250 then 'Legend' when p_completed_deliveries >= 100 then 'Elite'
         when p_completed_deliveries >= 50 then 'Pro' when p_completed_deliveries >= 20 then 'Courier'
         when p_completed_deliveries >= 5 then 'Runner' else 'Rookie' end,
    case when p_completed_deliveries >= 250 then p_completed_deliveries - 250
         when p_completed_deliveries >= 100 then p_completed_deliveries - 100
         when p_completed_deliveries >= 50 then p_completed_deliveries - 50
         when p_completed_deliveries >= 20 then p_completed_deliveries - 20
         when p_completed_deliveries >= 5 then p_completed_deliveries - 5
         else p_completed_deliveries end,
    case when p_completed_deliveries >= 250 then null
         when p_completed_deliveries >= 100 then 250 - p_completed_deliveries
         when p_completed_deliveries >= 50 then 100 - p_completed_deliveries
         when p_completed_deliveries >= 20 then 50 - p_completed_deliveries
         when p_completed_deliveries >= 5 then 20 - p_completed_deliveries
         else 5 - p_completed_deliveries end;
$$ language sql stable;

-- Consecutive calendar days (through yesterday or today) with at least one
-- verified delivery for this agent. Groups distinct delivery dates into runs
-- via the classic "date minus row_number" trick, then keeps only the run
-- that's still current.
create or replace function get_agent_streak(p_agent_id uuid)
returns integer as $$
  with delivery_dates as (
    select distinct date(dv.verified_at) as delivery_date
    from delivery_verifications dv
    join orders o on o.id = dv.order_id
    where o.accepted_agent_id = p_agent_id
  ),
  grouped as (
    select delivery_date,
           delivery_date - (row_number() over (order by delivery_date))::int as grp
    from delivery_dates
  ),
  streaks as (
    select count(*) as streak_length, max(delivery_date) as streak_end
    from grouped group by grp
  )
  select coalesce(
    (select streak_length from streaks where streak_end >= current_date - interval '1 day'
     order by streak_end desc limit 1), 0);
$$ language sql stable;

-- Convenience RPC bundling level + streak + badges into one call.
create or replace function get_agent_gamification_profile(p_agent_id uuid)
returns json as $$
declare
  v_completed integer;
  v_level record;
  v_streak integer;
  v_badges json;
begin
  select completed_deliveries_count into v_completed from profiles where id = p_agent_id;
  select * into v_level from get_agent_level(v_completed);
  select get_agent_streak(p_agent_id) into v_streak;
  select coalesce(json_agg(json_build_object('badge_code', badge_code, 'earned_at', earned_at)), '[]'::json)
    into v_badges from agent_badges where profile_id = p_agent_id;

  return json_build_object(
    'level_number', v_level.level_number, 'level_label', v_level.level_label,
    'deliveries_into_level', v_level.deliveries_into_level,
    'deliveries_to_next_level', v_level.deliveries_to_next_level,
    'current_streak', v_streak, 'badges', v_badges
  );
end;
$$ language plpgsql stable;

grant execute on function get_agent_gamification_profile(uuid) to authenticated;
