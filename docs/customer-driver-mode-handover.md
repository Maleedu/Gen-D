# Customer/Driver Mode — Handover to Claude Code

## 1. Overview

Gen-D has **one account type** — there is no `role` column anywhere in the
schema. Any account can post parcels (acting as customer) and also browse
the Wall / accept or bid on deliveries (acting as agent), from the same
login. "Role" only ever exists transiently, per-order, based on whether
`auth.uid()` matches that order's `customer_id` or `accepted_agent_id`.

This session we found three problems caused by there being no persistent,
app-wide concept of "which hat am I wearing right now":

1. **`mobile/app/(tabs)/wall.tsx`** has an all-or-nothing early-return: if
   `is_agent_verified === false`, the entire Wall screen is replaced with a
   "Complete KYC" message. This blocks *browsing*, when it should only
   block the *Accept* and *bid* actions.
2. There is no **My Orders** screen for customers. After posting a parcel,
   there's a structural gap — bidding orders can never reach the handoff
   stage because nobody can review/select a winning bid.
3. The existing **Progress** tab (`mobile/app/(tabs)/progress.tsx` or
   similar — verify actual filename) mixes profile info (name, avatar) with
   agent-only gamification stats (level, streak, badges). This is shown to
   every account regardless of whether they've ever delivered anything,
   which is confusing for customer-only use.

**The fix is a Customer/Driver mode toggle** — not a new `role` column, not
separate accounts. Same login, same credentials. The toggle just decides
which tabs and Home screen content are visible, and is purely a
client-side navigation concern. It does **not** gate any permission —
KYC/RLS checks remain exactly where they already are (or are fixed to be,
per section 5 below).

---

## 2. Schema reference (already confirmed this session — do not re-verify)

### `orders` table
```
id                        uuid
customer_id                uuid
status                      order_status enum: open | accepted | picked_up | delivered | cancelled
item_description            text
item_category                text
point_a_address / point_b_address   text
point_a_lat/lng, point_b_lat/lng    double precision
delivery_speed               enum
price_paise                   integer (nullable — null when pricing_mode = 'bidding')
pricing_mode                  enum (fixed | bidding — verify exact enum labels before use)
min_bid_paise                  integer (nullable)
accepted_agent_id              uuid (nullable)
created_at                     timestamptz
photo_urls                     text[]
purchased_insurance            boolean
declared_value_paise            integer (nullable)
is_perishable                    boolean
legal_attestation_confirmed       boolean
weight_kg                          numeric
parcel_size                          text
```

### `bids` table
```
id           uuid
order_id     uuid
agent_id     uuid
offer_paise  integer
created_at   timestamptz
```

### Relevant RLS policies (already confirmed working, no changes needed)
- `bids: customer views bids on their order` — customer can SELECT bids
  where they own the order via `orders.customer_id = auth.uid()`.
- `profiles: anyone can read` — agent profile info (name, rating, delivery
  count) is world-readable, no policy change needed for the bid-review UI.
- `orders: customer or accepted agent can update` — customer can UPDATE
  their own order (needed for bid selection: setting `accepted_agent_id`
  and `status = 'accepted'`). Confirm no other trigger blocks this before
  assuming it "just works" — test against the real `authenticated` role,
  not the superuser connection.
- `orders: agent accepts an open order` — already working for direct
  fixed-price accept, not in scope for this handover.

### `profiles` table — relevant columns
```
is_agent_verified   boolean   -- the single KYC flag, persistent, no re-asking once true
completed_deliveries_count   integer
avg_rating_as_agent            numeric
avatar_url                      text
first_name / last_name            text
phone_number                       text
```
Note: `auth.users.email` — email lives in Supabase's `auth.users` table,
NOT on `profiles`. Join if email needs to be displayed anywhere.

---

## 3. Toggle component

- Add a Customer/Driver segmented toggle at the **top of the Home screen**.
- Persist the selected mode locally (AsyncStorage), so it's remembered
  across app restarts. Suggested key: `gend_view_mode`, values `'customer'`
  or `'driver'`. Default to `'customer'` on first-ever launch (no stored
  value yet).
- The toggle drives which tabs are visible in the tab bar:
  - **Customer mode:** Home, My Orders, Profile
  - **Driver mode:** Home, Wall, Progress, Profile
- Use Expo Router's `href: null` pattern on `Tabs.Screen` to hide a tab
  without unmounting/removing its route, so state isn't lost when
  switching modes back and forth.
- Switching modes does **not** require KYC verification of any kind —
  anyone can switch into Driver mode and browse the Wall freely. KYC only
  gates the Accept and Bid actions specifically (see section 5).

---

## 4. Home screen CTA

The Home screen's main call-to-action button changes based on the active
mode:
- **Customer mode:** "Post a Parcel" → navigates to the existing Post Item
  screen.
- **Driver mode:** "Deliver a Parcel" (or similar wording, use judgement
  for what reads naturally next to existing copy) → navigates to the Wall.

---

## 5. Wall screen fix (`mobile/app/(tabs)/wall.tsx`)

**Remove** the current early-return block (around line 526):
```javascript
if (verified === false) {
  return ( /* full-screen "Complete KYC" message */ );
}
```

**Replace with:**
- The Wall renders normally regardless of `is_agent_verified`.
- If `is_agent_verified === false`, show a **passive banner** at the top of
  the Wall (non-blocking, doesn't prevent scrolling/browsing) — reuse the
  existing message copy: "Complete KYC to accept orders. Your agent
  profile isn't verified yet. Once your documents are approved, you'll be
  able to accept and bid on deliveries."
- The **Accept button** and **bid submission** specifically must check
  `is_agent_verified` at the moment of action (not at screen-load time) and
  block with an alert/message if false, rather than the whole screen being
  gated.
- This is a one-time persistent flag, not a per-session check — once
  `is_agent_verified` flips to `true` in the database, no further KYC
  prompts should ever appear for that account.

---

## 6. My Orders screen (new)

New screen, customer-facing, showing orders where `customer_id =
auth.uid()`.

### List view
- Query `orders` where `customer_id = auth.uid()`, most recent
  (`created_at desc`) first.
- Each card shows: `item_description`, a status badge (map enum values to
  friendly labels — e.g. `open` → "Waiting for a driver" or "Bids open" if
  `pricing_mode = 'bidding'`, `accepted` → "Driver on the way to pickup",
  `picked_up` → "In transit", `delivered` → "Delivered", `cancelled` →
  "Cancelled"), and either the fixed price or "X bids" count if still open
  and bidding.

### Tap behavior
- If `status = 'open'` **and** `pricing_mode = 'bidding'` → open the
  **bid-review view** (see below).
- Otherwise → navigate to the existing Order Tracking screen
  (`mobile/app/order/[id].tsx`), which already handles `accepted`,
  `picked_up`, `delivered` states including the ratings work from earlier
  this session.

### Bid-review view (for `open` + `bidding` orders)
- List all rows from `bids` where `order_id` matches, joined with
  `profiles` for each `agent_id` to show:
  - Agent name, avatar (`avatar_url`, with fallback like the existing
    `AgentCard` component in Order Tracking — reuse that component or its
    pattern if practical rather than duplicating).
  - `avg_rating_as_agent`
  - `completed_deliveries_count`
  - `offer_paise` (the bid amount)
- Each bid has a **"Select this bid"** action. On tap:
  - Confirm with the customer before submitting (irreversible action).
  - `UPDATE orders SET accepted_agent_id = <agent_id>, status =
    'accepted' WHERE id = <order_id>`.
  - No auto-resolve exists and none should be added — selection is always
    manual, per existing settled decision.
  - After success, navigate to the Order Tracking screen for this order.

---

## 7. Customer Profile screen (new)

Separate from the existing agent-facing Progress screen (which stays
completely unchanged — no modifications to gamification/Progress logic in
this handover).

Shows only:
- Name + avatar (reuse existing display pattern)
- Phone number and/or email (email requires a join to `auth.users`, see
  section 2 note)
- **Logout button** — there is currently no logout anywhere in the app.
  Use Supabase's `auth.signOut()`. After logout, navigate back to the
  login screen and clear any locally cached mode/session state.
- A link/button back to My Orders (convenience, optional placement).

**Explicitly not included:** saved/multiple addresses. That's parked as a
separate future handover — would need a new `saved_addresses` table (id,
user_id, label, address, lat, lng) plus wiring into Post Item. Do not
build this now.

---

## 8. Post-item routing fix

After a parcel is successfully posted (the current "Your parcel is live on
the Wall" confirmation), navigate to **My Orders**, not the Wall. This was
previously routing to the Wall regardless of the poster's role, which
doesn't make sense now that Wall is Driver-mode-only content.

---

## 9. Explicitly out of scope for this handover

- No new `role` column on `profiles` or `orders` — the toggle is a
  client-side-only concept, not a schema change.
- No changes to the Progress/gamification screen or its underlying
  triggers/RPCs.
- No address-masking on the Wall (a separate, deliberate privacy decision
  parked for later).
- No multiple saved addresses (separate future handover, see section 7).

---

## 10. Testing checklist (manual, after build — same rigor as every other
feature this session, verify via real device + direct DB queries, never
trust a "success" message alone)

- [ ] Fresh app launch with no stored mode → defaults to Customer mode
- [ ] Toggle switches tabs correctly (Customer: Home/My Orders/Profile;
      Driver: Home/Wall/Progress/Profile)
- [ ] Mode persists after force-closing and reopening the app
- [ ] Home screen CTA text/destination changes correctly per mode
- [ ] Unverified account can switch to Driver mode and browse Wall freely,
      sees the passive banner, tapping Accept/bid is blocked with a
      message
- [ ] Verified account (`is_agent_verified = true`) sees no banner, Accept
      and bid work normally
- [ ] Post a fixed-price parcel as customer → lands on My Orders, not Wall
- [ ] Post a bidding parcel, have a second (agent) account submit 2+ bids
      → My Orders shows bid count, tapping opens bid-review view with
      correct agent info and offer amounts
- [ ] Selecting a bid updates `accepted_agent_id` and `status` correctly
      (verify via direct SQL query, not just UI) and opens Order Tracking
- [ ] Non-bidding orders in My Orders open Order Tracking directly
- [ ] Customer Profile shows correct name/contact, Logout actually signs
      out and returns to login screen
- [ ] Progress screen unchanged, still only meaningful in Driver mode
      (still visible/functional exactly as before)
