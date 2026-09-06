# Profile Screen — Agent Button Text & Back Button

Context: Follow-on to `docs/rename-driver-to-agent-handover.md`. While
testing that rename, we found the Agent's Profile screen still shows
"View My Orders" — customer language, since an Agent delivers parcels
rather than posting them. This doc covers two small changes to the Profile
screen (likely `mobile/app/(tabs)/profile.tsx` — confirm exact path/file
first, since this wasn't in the earlier search results).

---

## Change 1 — "View My Orders" → "View My Deliveries" in Agent mode

**Problem:** The Profile screen's button currently reads "View My Orders"
regardless of whether the person is in Customer or Agent mode. For an
Agent, this should read "View My Deliveries" instead, matching the
"Deliver a parcel" language already used on the Home screen's Agent mode.

**Fix:** Find wherever this button's label is set in the Profile screen
file. This screen is likely shared between Customer and Agent modes (the
same pattern as `mobile/app/(tabs)/index.tsx`, which distinguishes modes
via `mode === 'driver'` as an internal value — do not rename that internal
value, see the earlier rename handover doc's rule on visible text vs
internal values). Make the button label conditional on the current mode:

```tsx
<Text>{mode === 'driver' ? 'View My Deliveries' : 'View My Orders'}</Text>
```

(Adjust variable names/access pattern to match however this screen
actually reads the current mode — check how `index.tsx` determines mode
and whether Profile already has access to that same state/context, or
needs to read it from wherever mode is stored, e.g. route params, a
shared context, or Supabase profile data.)

Leave the underlying navigation/route this button points to unchanged for
now — same screen, just different label text depending on mode. If the
destination screen itself needs Agent-specific content (e.g. showing
accepted/completed deliveries rather than posted parcels), that's a
separate, larger task — flag it back to me rather than assuming scope here.

---

## Change 2 — Add a back button to the Profile screen

**Problem:** The Profile screen has no back button, similar to the gap we
fixed earlier on the Login screen.

**Fix:** Add a `‹ Back` button at the top of the Profile screen, styled
consistently with the one already added to `mobile/app/login.tsx` (same
`‹ Back` text, same blue color, same position pattern — a header row above
the main content). Reuse the same approach:

```tsx
<View style={styles.header}>
  <Pressable onPress={() => router.replace('/')} hitSlop={8}>
    <Text style={[styles.backText, { color: BLUE }]}>‹ Back</Text>
  </Pressable>
</View>
```

Use `router.replace('/')` to go to Home, matching the reasoning already
established for Login's back button (avoids `router.back()`'s no-history
risk). Add matching `header`/`backText` styles if this file doesn't
already have them (check first — if Profile already shares a style file or
pattern with other tab screens, follow that instead of duplicating).

**Note:** Profile is a bottom-tab screen, and the bottom nav already has a
"Home" tab that navigates there. Adding a back button is still fine per the
request — just confirm it doesn't visually conflict with the existing tab
bar or duplicate awkwardly; if it looks redundant on-device, flag it back
rather than silently leaving it out.

---

## Testing checklist after these changes

- [ ] In Agent mode, Profile screen shows "View My Deliveries".
- [ ] In Customer mode, Profile screen still shows "View My Orders"
      (unchanged).
- [ ] Tapping the button still navigates correctly in both modes.
- [ ] A `‹ Back` button is visible at the top of the Profile screen and
      returns to Home when tapped.
- [ ] No internal mode values or other logic were touched — only the
      button's displayed text and the new back button were added.
