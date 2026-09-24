# Handover: Auction Feature Explainer Banners

## Context
The auction/bidding feature (min-price setting, bid selection, agent bidding) has no
explanation of how it works in the UI. This adds a **static, dismissible banner** at
three trigger points — one for the customer, two for the agent/customer bid flow —
that explains the *mechanics* of the feature only. No pricing advice, no dynamic AI
calls at runtime. Copy was authored once (AI-assisted) and is baked into the app as
plain text/JSX.

## Scope (3 trigger points)

1. Customer — setting min price on Post Item screen (auction pricing mode selected)
2. Customer — bid-selection screen (viewing bids on their own open auction order)
3. Agent — placing a bid on an order (Wall or order detail screen)

Each trigger point is independent — dismissing one does NOT dismiss the others.

## UI pattern (same for all three)

- **First time** the user reaches that screen/state: show a banner above the
  relevant input/list.
- Banner has a **dismiss (×)** control. Tapping it:
  - Hides the banner
  - Sets the corresponding AsyncStorage flag to `'true'`
  - From then on, show a small **ⓘ icon** instead, in the same position the
    banner occupied (near the price input label / near the bids list header /
    near the bid button) — tapping the ⓘ re-opens the same banner content in a
    dismissible popover/modal (does NOT re-set the flag to unseen; ⓘ stays
    available permanently).
- On app load / screen mount, check the relevant AsyncStorage flag to decide
  banner vs. ⓘ icon. Default (flag absent/null) = show banner.

## AsyncStorage keys (new)

| Key | Set by trigger point |
|---|---|
| `gend_seen_banner_auction_pricing` | Customer setting min price |
| `gend_seen_banner_bid_selection` | Customer bid-selection screen |
| `gend_seen_banner_agent_bidding` | Agent placing a bid |

All values are the string `'true'` when dismissed; absent/null = not yet seen.
Use the same `AsyncStorage.getItem` / `setItem` pattern already used for
`gend_view_mode` — no new storage abstraction needed.

## Copy (final, approved — do not alter wording without confirmation)

### 1. Customer — setting min price (auction pricing mode)
**Where it mounts:** Post Item screen, directly above/below the min-price input,
only when the customer has selected auction/bidding pricing mode (not fixed price).

> **How bidding works**
> Set a starting price — agents can then bid at or above it. You'll see every bid
> and pick whichever one you want to accept: cheapest, fastest, most trusted, your
> choice.

### 2. Customer — bid-selection screen
**Where it mounts:** Top of the bids list on `my-orders.tsx` (or wherever the
customer views bids on their own open auction order), first time that screen is
reached with 1+ bids present.

> **Choosing a bid**
> These are all the offers agents have made on your order. Tap any bid to accept
> it — the agent is notified immediately and your order moves to pickup.

### 3. Agent — placing a bid
**Where it mounts:** Order detail / bid-entry screen, above the bid-amount input,
first time an agent opens the bid entry for any order (not per-order — global
"first time bidding at all" flag).

> **Placing your bid**
> Bid any amount at or above the order's minimum. The customer sees every bid and
> picks who they want — there's no rule forcing you to outbid anyone else.

## Explicitly out of scope for this task
- No pricing guidance, suggested ranges, or "realistic price" commentary anywhere
  in this copy — that's a separate, deferred (Phase 2) feature and must not be
  conflated with this one.
- No runtime AI/API calls — this is 100% static content shipped in the app bundle.
- No server-side/DB tracking of "seen" state — AsyncStorage only, consistent with
  `gend_view_mode`.

## Verification checklist (before merging to main)
- [ ] Banner shows on first visit to each of the 3 trigger points independently
- [ ] Dismissing banner #1 does not affect banners #2 or #3, and vice versa
- [ ] After dismissal, ⓘ icon appears in place of the banner and reopens the same
      copy in a popover/modal on tap
- [ ] Reinstalling the app (Expo Go) resets all three flags as expected (this is
      intentional given AsyncStorage is client-side — confirm this is acceptable
      behavior during testing, not a bug)
- [ ] Confirm on-device before merging `admin-dashboard` → `main`, per existing rule
