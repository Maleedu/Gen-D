# Ratings — Handover to Claude Code

This extends `mobile/app/order/[id].tsx`'s existing `delivered` status block (which already has a placeholder note pointing toward a rating screen — this doc replaces that placeholder, it's not a new route). Backend is fully built and tested — `ratings` table, RLS, uniqueness, and both triggers below. Nothing here needs new schema; it's a frontend task.

---

## Scope (locked, don't re-litigate)

Both directions are built:
- **Customer rates agent** — always available once the order is `delivered`. This is the one that actually feeds `profiles.avg_rating_as_agent`, which gates `super_fast` orders and priority-window access elsewhere in the app.
- **Agent rates customer** — only available once that agent has `completed_deliveries_count >= 10`. Below 10, no error is shown mid-submit — the form simply shouldn't render; show an informational "unlock at 10 deliveries" state instead. This rating is stored but does not feed any existing gate — it's informational only for now.

`10` was your explicit number — worth knowing it happens to coincide with the existing "Perfect Ten" gamification badge threshold, though the two aren't functionally linked. Fine coincidence, not something to wire together.

---

## Schema reference

**`ratings`** — `id`, `order_id`, `rater_id`, `ratee_id`, `rater_role` (enum: `customer` / `agent`), `stars` (smallint, DB-enforced 1–5 via check constraint), `comment` (nullable text), `created_at`.

**Enforced already, at the database level — the client doesn't need to re-validate these, just handle the resulting errors gracefully:**
- `UNIQUE (order_id, rater_id)` — a rater can only rate a given order once. A duplicate attempt fails with a real Postgres unique-violation error (code `23505`), not a silent no-op.
- `stars` must be 1–5, or the insert fails outright.
- RLS `INSERT` policy requires: `rater_id = auth.uid()` (can't fake attribution), the order's `status = 'delivered'`, and the rater is a genuine participant on that order (`customer_id` or `accepted_agent_id`).
- **New this session:** a `BEFORE INSERT` trigger blocks any `rater_role = 'agent'` insert where that agent's `completed_deliveries_count < 10`, raising: `"Agents must complete at least 10 deliveries before they can rate customers"`.
- `ratings: public read` — anyone can `SELECT` ratings (no restriction needed client-side for reads).
- No `UPDATE`/`DELETE` policy exists at all — ratings are permanently immutable once submitted. Don't build an edit/delete UI; there's nothing server-side to support it.

**Aggregation** — `avg_rating_as_agent` is automatically recomputed by a trigger on every `customer`-role rating insert (already correctly excludes `agent`-role ratings from this average). You don't call anything to update it; it just happens.

---

## What to build, in the `delivered` block

**For the customer viewing their own delivered order:**
1. Check if they've already rated: `select id, stars, comment from ratings where order_id = orderId and rater_id = customerId` (or just attempt render and catch the empty case).
2. If a row exists → show it read-only ("You rated this delivery ★★★★★" + their comment if present).
3. If no row → show a 1–5 tappable star input + optional comment field + submit button.
4. On submit:
   ```js
   const { error } = await supabase.from('ratings').insert({
     order_id: orderId,
     rater_id: customerId,
     ratee_id: order.accepted_agent_id,
     rater_role: 'customer',
     stars,
     comment: comment || null,
   });
   ```
   Handle `error` — surface it as a real user-facing message, don't swallow it.

**For the agent viewing their own delivered order:**
1. Fetch their own `completed_deliveries_count`: `select completed_deliveries_count from profiles where id = agentId`. (Don't reuse the gamification level RPC for this check — its breakpoints are 5/20/50/100/250, not 10; this needs the raw count directly.)
2. Check if they've already rated this order (same pattern as above, `rater_id = agentId`).
3. Branch:
   - Already rated → show it read-only, same as customer side.
   - Not yet rated, `count >= 10` → show the same star+comment form; on submit, `rater_role: 'agent'`, `ratee_id: order.customer_id`.
   - Not yet rated, `count < 10` → show an informational message, e.g. "Rate customers once you've completed 10 deliveries — {10 - count} to go." No form, no submit button.

**Star input UX:** match the visual style already used elsewhere in the app for displaying ratings (the ⭐ + number pattern on agent cards) so it feels consistent, not like a different component library.

**Error handling reminder:** the unique-constraint and threshold-trigger errors are real safety nets, not just UI conveniences — always handle the error path from the insert call even though the UI should normally prevent reaching it.
