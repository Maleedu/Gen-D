# My Orders — Bid Selection (Accept a Winning Bid)

Context: This is the fix for the structural gap where auction orders could
never reach handoff — customers had no way to actually select a winning
bid. The backend piece is done and verified (via Supabase MCP, not this
handover): a new RPC `accept_bid(p_order_id uuid, p_bid_id uuid)` exists in
the database. It:

- Verifies the caller is the order's customer
- Verifies the order is still `status = 'open'`
- Looks up the bid's `agent_id` and `offer_paise` (must belong to this
  order)
- Updates the order: `accepted_agent_id`, `status = 'accepted'`,
  `price_paise` (locked to the winning bid amount)
- This update triggers existing DB logic automatically — pickup OTP
  generation, the priority-window gate, and the super-fast-speed gate all
  fire the same way they already do for the direct agent-accept flow. If
  the winning bidder no longer qualifies (e.g. rating dropped, inactive
  agent), the RPC raises a clear error and rejects the update — nothing
  extra to build for this case, just surface `error.message`.

This handover is scoped only to `mobile/app/(tabs)/my-orders.tsx` — wiring
the existing bid-review UI (the `reviewingOrderId` / `BidRow` pattern
already in this file) up to actually call this RPC.

---

## What to build

In the bid-review branch of this screen (where `reviewingOrderId` is set
and bids for that order are listed via `BidRow`), each bid row currently
displays the bid but doesn't let the customer act on it. Add:

1. **Tap handling on each `BidRow`** — tapping a row shows a confirmation
   alert before doing anything irreversible:

   ```tsx
   function handleSelectBid(bid: { id: string; offer_paise: number }) {
     Alert.alert(
       'Accept this bid?',
       `Accept ₹${(bid.offer_paise / 100).toFixed(2)} for this delivery? This can't be undone.`,
       [
         { text: 'Cancel', style: 'cancel' },
         { text: 'Accept', onPress: () => confirmSelectBid(bid.id) },
       ],
     );
   }
   ```

2. **The actual RPC call**, triggered by the confirm button above:

   ```tsx
   async function confirmSelectBid(bidId: string) {
     if (!reviewingOrderId) return;
     setSubmittingBidId(bidId); // new local state, see below — disables the row while in flight
     const { error } = await supabase.rpc('accept_bid', {
       p_order_id: reviewingOrderId,
       p_bid_id: bidId,
     });
     setSubmittingBidId(null);
     if (error) {
       Alert.alert('Could not accept this bid', error.message);
       return;
     }
     setReviewingOrderId(null); // back to the order list
     // Trigger whatever refresh mechanism this screen already uses
     // (e.g. onRefresh / refetch) so the list reflects the now-accepted
     // order instead of still showing it as open with bids pending.
   }
   ```

3. **New local state** for tracking an in-flight selection, so the tapped
   row can show a loading indicator and all rows can be disabled while a
   selection is being submitted (prevents double-taps / double-submits):

   ```tsx
   const [submittingBidId, setSubmittingBidId] = useState<string | null>(null);
   ```

   Pass a `disabled` or `submitting` prop into `BidRow` based on whether
   `submittingBidId` is set (disable ALL bid rows while any one submission
   is in flight, not just the tapped one — prevents a race where two bids
   get accepted-in-flight at once).

4. **After a successful accept**, make sure the screen actually reflects
   the change — check how this file currently reloads/refetches orders
   (there should be an existing `onRefresh` or equivalent used elsewhere
   in this file) and call that after `setReviewingOrderId(null)`, so the
   customer doesn't see stale "open" data for an order that's now
   `accepted`.

---

## Error message handling

No special-casing needed for the eligibility-gate errors — the RPC's
`error.message` already contains a clear, complete sentence for every
failure case (e.g. `"This agent does not currently qualify for super fast
orders (needs 4.5+ rating, 5+ deliveries, and activity in the last 7
days)"` or `"This order is no longer open for bid selection"`). Just show
whatever `error.message` is directly in the `Alert.alert` call, the same
way `signup.tsx` and `login.tsx` already do for their Supabase error
handling.

---

## Testing checklist after this change

- [ ] Tapping a bid row shows a confirmation alert with the correct bid
      amount before anything happens.
- [ ] Cancelling the alert does nothing — no RPC call, order stays open.
- [ ] Confirming a valid bid moves the order to `accepted`, and the
      screen reflects this (no longer shown as awaiting bids).
- [ ] Confirming a bid from an agent who no longer qualifies (e.g. test
      with a low-rated/new test agent on a super-fast order) shows a clear
      error alert with the exact message from the database, and the order
      stays `open` — the customer can then try a different bid.
- [ ] While one bid selection is submitting, other bid rows are disabled
      (can't double-select).
- [ ] Confirm on the Agent side (device or Supabase directly) that
      accepting a bid actually generates a pickup OTP — this is proof the
      full trigger chain fired correctly, not just the order status
      change.
