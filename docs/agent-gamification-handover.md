# Agent Gamification — Handover to Claude Code

Backend is fully built and tested in Supabase (project `ovwhuvkwxxlmhsldgrwo`), documented locally as migrations `32_agent_gamification.sql`, `33_fix_profile_protection_overreach.sql`, `34_fix_profile_column_grants_properly.sql`. This doc covers everything needed to build the UI.

---

## Scope decision (locked, don't re-litigate)

This is a **gamification layer for delivery agents only** — not a visual reskin of the app. Customer-facing screens, checkout, KYC, complaints, etc. all stay in the existing professional look. This feature adds: agent levels, delivery streaks, and milestone badges, shown on agent-facing screens (and optionally as small accents on the customer's agent card — see "Where this shows" below).

---

## One RPC gets you everything

```js
const { data } = await supabase.rpc('get_agent_gamification_profile', { p_agent_id: agentId });
```

Returns a single JSON object:
```json
{
  "level_number": 2,
  "level_label": "Runner",
  "deliveries_into_level": 3,
  "deliveries_to_next_level": 15,
  "current_streak": 4,
  "badges": [
    { "badge_code": "first_delivery", "earned_at": "2026-09-05T04:01:24Z" },
    { "badge_code": "ten_deliveries", "earned_at": "2026-09-06T18:22:10Z" }
  ]
}
```

This is read-only and safe to call for any agent (not just the logged-in user) — level/streak/badges are meant to be publicly visible, same as `avg_rating_as_agent` already is.

---

## Levels (derived from `completed_deliveries_count`, no separate XP system)

| Deliveries | Level | Label |
|---|---|---|
| 0–4 | 1 | Rookie |
| 5–19 | 2 | Runner |
| 20–49 | 3 | Courier |
| 50–99 | 4 | Pro |
| 100–249 | 5 | Elite |
| 250+ | 6 | Legend |

`deliveries_into_level` / `deliveries_to_next_level` are provided so you can render a progress bar (e.g. "3/15 to Courier"). At max level (Legend), `deliveries_to_next_level` is `null` — handle that case (no progress bar, just show the level).

## Streak

`current_streak` = consecutive calendar days (ending today or yesterday) with at least one completed delivery. Duolingo-style: a streak isn't broken just because today hasn't happened yet, only by an actual gap day. Zero means no active streak.

## Badges — display metadata (not stored in the DB, define these client-side)

The `agent_badges` table only stores a `badge_code` string + `earned_at` timestamp. You'll need a local lookup for display name/description/icon, since that's presentation-layer, not data:

| `badge_code` | Suggested display name | Description |
|---|---|---|
| `first_delivery` | First Delivery | Completed their very first delivery |
| `ten_deliveries` | Perfect Ten | Completed 10 deliveries |
| `fifty_deliveries` | Halfway Hero | Completed 50 deliveries |
| `century` | Century Club | Completed 100 deliveries |
| `five_star_hero` | Five-Star Hero | Maintained a 4.9+ rating over at least 10 deliveries |

Badges are **permanent once earned** — e.g. `five_star_hero` stays even if the agent's rating later drops below 4.9. Don't build any "badge revocation" logic; there isn't any server-side, and there shouldn't be.

---

## Where this shows (open question — your call, or ask the person)

No existing screen was specified for this in advance. Reasonable options:
1. **A dedicated agent profile/stats screen** (if one doesn't exist yet, this is a natural place to add it).
2. **Small accents on the customer-facing agent card** already built on the Order Tracking screen (`accepted`/`picked_up` states) — e.g. a small level badge or streak flame icon next to the agent's name, alongside the existing rating/delivery-count display. This is optional, not required.

Pick whichever fits the app's existing navigation structure — I don't have visibility into what screens already exist beyond what's in this doc and the tracking-screen doc.

---

## Important context: a real bug was found and fixed while building this

While testing, I discovered `protect_privileged_profile_columns` (your original `is_agent_verified`/`is_admin` self-elevation fix) was scoped too broadly — it was also silently reverting `avg_rating_as_agent`, `completed_deliveries_count`, and `last_delivered_at` any time a real, non-admin user's identity was in the update context, which is exactly the situation every genuine delivery completion and rating submission runs under. **This means these three counters could never actually update from real customer/agent actions until this session's fix.**

Fixed by:
1. Narrowing that trigger to only protect `is_agent_verified`/`is_admin`.
2. Properly locking down the three counters via column-level `REVOKE`/`GRANT` (not the trigger) — discovered along the way that a column-specific `REVOKE` doesn't override a pre-existing blanket table-level grant in Postgres; had to revoke the whole table-level `UPDATE` grant and re-grant only the legitimately user-editable columns.

Both fixes are tested and confirmed working (self-elevation still blocked, counters now update correctly from real RPC calls, direct tampering attempts now fail with a real permission error instead of silently no-op'ing). This also means **super_fast gating, priority-window gating, and ratings** — which all depend on these same columns — are now working correctly for the first time, not just this gamification feature. Nothing further needed here, just worth knowing why these numbers may look different from what you'd expect based on earlier testing.

---

## Known test-data note

Agent `65a841aa-df90-45c9-a2b6-a7c1a787b24e` (Sai Nadh) has `completed_deliveries_count = 3` and one legitimate `first_delivery` badge from real test deliveries this session. Fine to leave as real test data.
