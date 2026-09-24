# Handover: Remove Stale "Ascending Bid" UI Copy

## Context
We just shipped a DB migration (`enforce_minimum_bid` trigger) that removes the old
"each bid must exceed the current highest bid" rule. Bids can now be any amount at
or above the order's `min_bid_paise` floor — no requirement relative to other
agents' bids.

The DB/backend side is done and verified. This task is UI-only: find and fix any
leftover front-end copy that still describes the old (now incorrect) rule.

## What to search for
Please search the mobile app codebase (`mobile/`) for any UI text matching or
close to these phrases (case-insensitive, wording may vary slightly):

- "must exceed"
- "current highest"
- "current bid"
- "higher than the last bid" / "higher than the previous bid"
- "outbid"
- Any bid-form validation error text or helper text describing an ascending-bid
  requirement

Likely locations (confirm actual locations in the codebase, don't assume):
- The Wall screen's bid-entry modal/input (where an agent types their bid amount)
- Any inline validation message shown when a bid is rejected
- `my-orders.tsx` if it displays any bid-rule explanation to the customer
- Any shared constants/copy file if bid-related strings are centralized there

## What the corrected copy should say
Replace any such text with wording consistent with the new rule: a bid just needs
to be at or above the order's minimum — there's no requirement to beat other
agents' bids. Example corrected validation error (adjust to match existing string
style/tone in the codebase):

> "Bid must be at least ₹[min_bid] for this order."

Do NOT reintroduce any wording implying bids must beat each other's amounts.

## Explicitly out of scope for this task
- Do NOT touch the new auction explainer banners feature — that's a separate,
  already-speced task (see `auction-explainer-banners-handover.md`) with its own
  approved copy. If you find overlap where a banner and stale copy are near each
  other on the same screen, only fix the stale copy here; leave banner
  implementation to the other handover doc.
- Do NOT touch the `enforce_minimum_bid` trigger or any other DB/backend logic —
  already done and verified via Supabase MCP.

## Verification checklist
- [ ] Confirm every match found via search, listing file + line before editing
      (so it can be reviewed in diff before commit)
- [ ] No remaining references to "current highest bid" / ascending requirement
      anywhere in `mobile/`
- [ ] Bid-form validation error text (if any exists client-side, in addition to
      the server-side trigger error) matches the new floor-only rule
- [ ] Diff reviewed before commit, per existing workflow rule
- [ ] Confirm on-device before merging `admin-dashboard` → `main`
