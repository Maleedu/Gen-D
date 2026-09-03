-- Test data for The Wall (mobile/app/(tabs)/wall.tsx).
-- Paste into the Dashboard SQL Editor and run — it runs as the Postgres
-- owner role there, so it bypasses RLS (needed anyway: is_agent_verified,
-- avg_rating_as_agent, etc. are locked down from client writes by
-- 20_protect_privileged_profile_columns.sql).
--
-- Idempotent: deletes its own previously-seeded rows (tagged 'SEED:') before
-- re-inserting, so it's safe to run again after editing.
--
-- Requires the account below to already exist (sign up through the app
-- first) — profiles.id is a foreign key into auth.users, so a profile can't
-- be created by this script alone.

do $$
declare
  agent_id uuid;
begin
  select id into agent_id from auth.users where email = 'm.navajyoth6@gmail.com';

  if agent_id is null then
    raise exception 'No auth.users row for that email — sign up through the app first, then re-run this.';
  end if;

  -- Verified agent, and qualified for the super_fast rating gate and the
  -- 5-minute priority window (both require 4.5+ rating, 5+ deliveries,
  -- activity in the last 7 days — see 07_ratings_stats_and_gating.sql /
  -- 09_priority_window.sql / 10_inactivity_penalty.sql). To test the
  -- *rejection* message on either gate instead, temporarily run:
  --   update profiles set completed_deliveries_count = 0 where id = '<agent_id>';
  -- then flip it back afterwards.
  update profiles
  set is_agent_verified = true,
      avg_rating_as_agent = 4.8,
      completed_deliveries_count = 12,
      last_delivered_at = now()
  where id = agent_id;

  delete from orders where customer_id = agent_id and item_description like 'SEED:%';

  -- Coordinates are scattered around central Bengaluru. They're only
  -- meaningful relative to wherever your test device's actual (or
  -- simulator-overridden) GPS position is — if that's nowhere near here,
  -- the Wall will still sort correctly, distances will just read large.
  insert into orders (
    customer_id, status, item_description, item_category, photo_urls,
    point_a_address, point_b_address, point_a_lat, point_a_lng,
    delivery_speed, pricing_mode, price_paise, min_bid_paise,
    weight_kg, parcel_size,
    legal_attestation_confirmed, created_at
  ) values
    -- Outside the 5-minute priority window — should accept cleanly for a qualified agent.
    (agent_id, 'open', 'SEED: Sealed envelope of signed contracts', 'Documents',
      array['https://picsum.photos/seed/genD1/800/600'],
      'Indiranagar 100 Feet Road, Bengaluru', 'Koramangala 5th Block, Bengaluru',
      12.9750, 77.6410, 'super_fast', 'fixed', 24900, null,
      0.2, 'small', true, now() - interval '10 minutes'),

    -- Inside the 5-minute priority window — still accepts for a qualified agent;
    -- drop the agent's stats (see comment above) to see the rejection message instead.
    (agent_id, 'open', 'SEED: Insulated box of frozen desserts', 'Food',
      array[]::text[],
      'MG Road Metro Station, Bengaluru', 'HSR Layout Sector 2, Bengaluru',
      12.9760, 77.6050, 'super_fast', 'fixed', 29900, null,
      3.5, 'medium', true, now()),

    (agent_id, 'open', 'SEED: Framed painting, handle with care', 'Fragile',
      array['https://picsum.photos/seed/genD3/800/600'],
      'Jayanagar 4th Block, Bengaluru', 'BTM Layout 2nd Stage, Bengaluru',
      12.9300, 77.5830, 'express', 'fixed', 18900, null,
      6.0, 'large', true, now() - interval '15 minutes'),

    -- Auction order — exercises the bid input instead of Accept.
    (agent_id, 'open', 'SEED: Box of 20 wedding invitation cards', 'Documents',
      array[]::text[],
      'Whitefield Main Road, Bengaluru', 'Marathahalli Bridge, Bengaluru',
      12.9698, 77.7500, 'express', 'auction', null, 15000,
      1.8, 'small', true, now() - interval '20 minutes'),

    (agent_id, 'open', 'SEED: Spare laptop charger', 'Electronics',
      array['https://picsum.photos/seed/genD5/800/600'],
      'Electronic City Phase 1, Bengaluru', 'Silk Board Junction, Bengaluru',
      12.8450, 77.6600, 'standard', 'fixed', 9900, null,
      0.4, 'small', true, now() - interval '1 hour'),

    -- No coordinates — exercises the "distance unknown, sorts last" fallback.
    (agent_id, 'open', 'SEED: Second-hand books, 3 boxes', 'Other',
      array['https://picsum.photos/seed/genD6/800/600'],
      'Yelahanka New Town, Bengaluru', 'Hebbal Flyover, Bengaluru',
      null, null, 'standard', 'auction', null, 8000,
      9.2, 'large', true, now() - interval '2 hours');

  raise notice 'Seeded 6 test orders for agent %', agent_id;
end $$;
