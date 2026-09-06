# My Orders Screen — Agent Empty State & Back Button

Context: Follow-on to `docs/profile-agent-deliveries-back-button-handover.md`.
Profile's "View My Deliveries" button (Agent mode) and "View My Orders"
button (Customer mode) both navigate to the same screen —
`mobile/app/(tabs)/my-orders.tsx`. Testing revealed two more issues on that
screen, scoped only to this file.

---

## Change 1 — Empty state text must be mode-aware

**Problem:** When there are no orders/deliveries, this screen always shows
"You haven't posted any parcels yet." — correct for Customer mode, wrong
for Agent mode (an Agent delivers parcels, doesn't post them).

**Fix:** Find wherever this empty-state text is rendered, and make it
conditional on the current mode, following the same pattern already used
in `mobile/app/(tabs)/index.tsx` and `mobile/app/(tabs)/profile.tsx`
(`useViewMode()` hook, checking `mode === 'driver'` as the internal value —
do not rename that internal value, only the displayed text):

```tsx
<Text>
  {mode === 'driver'
    ? "You haven't delivered any parcels yet."
    : "You haven't posted any parcels yet."}
</Text>
```

(Import/use `useViewMode()` the same way `profile.tsx` does, if this file
doesn't already have access to `mode`.)

---

## Change 2 — Add a back button to this screen

**Problem:** This screen also has no back button.

**Fix:** Add the same `‹ Back` button used on `login.tsx` and
`profile.tsx` — same style, same `router.replace('/')` behavior. Since this
is now the third screen using this exact pattern, consider whether it's
worth extracting a small shared `BackButton` component (e.g. in
`mobile/components/`) that all three screens import, rather than
duplicating the same function three times — use your judgement on whether
this refactor is low-risk enough to do now, or whether to just duplicate
the pattern a third time and flag the extraction as a future cleanup. Given
Navajyoth prefers spoon-fed, low-risk changes, default to duplicating for
now unless the extraction is trivial and clearly safe.

```tsx
function BackButton() {
  return (
    <View style={styles.backRow}>
      <Pressable onPress={() => router.replace('/')} hitSlop={8}>
        <Text style={[styles.backText, { color: BLUE }]}>‹ Back</Text>
      </Pressable>
    </View>
  );
}
```

Add matching `backRow`/`backText` styles (copy the same values used in
`profile.tsx`: `backRow: { flexDirection: 'row', alignItems: 'center',
paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }`, `backText:
{ fontSize: 15, fontWeight: '700' }`). Render `<BackButton />` at the top
of every return branch in this file (loading, error/empty, and main list
states), the same way `profile.tsx` renders it in all three of its return
branches — don't miss any of them.

---

## Testing checklist after these changes

- [ ] In Agent mode, with no deliveries, screen shows "You haven't
      delivered any parcels yet."
- [ ] In Customer mode, with no orders, screen still shows "You haven't
      posted any parcels yet." (unchanged).
- [ ] A `‹ Back` button is visible at the top of this screen in both modes
      and in all states (empty, loading, and with orders/deliveries
      present), and returns to Home when tapped.
- [ ] No internal mode values or other logic were touched — only the
      displayed empty-state text and the new back button were added.
