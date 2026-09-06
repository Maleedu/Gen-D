# Login Screen — Signup Link & Positioning Handover

Context: Follow-on to `docs/phone-otp-login-fixes-handover.md` (already
implemented and verified on-device). This is a new visual/UX request, not a
bug fix, scoped only to `mobile/app/login.tsx`.

---

## Change 1 — "New to Gen-D? Sign up" in big letters, on BOTH tabs

**Problem:** The "New to Gen-D? Sign up" link currently only appears on the
Email tab, using the small `styles.link` size. It needs to (a) also appear
on the Phone tab, and (b) be visually bigger/bolder on both tabs — this is
a shared change across both, not Phone-only.

**Fix:**

On the **Email tab**, upgrade the existing link's style from `styles.link`
to the new bigger style (see below) — same `Pressable`/`onPress`, just a
different `Text` style:

```tsx
<Pressable onPress={() => router.push('/signup')}>
  <Text style={[styles.signupLinkBig, { color: BLUE }]}>New to Gen-D? Sign up</Text>
</Pressable>
```

On the **Phone tab**, add the same link below the "Send code" button, on
the `'request'` step only (not the `'verify'` step — a user already
mid-OTP-flow doesn't need it):

```tsx
<Pressable
  style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
  onPress={handleSendCode}
  disabled={submitting}
>
  <Text style={styles.buttonText}>{submitting ? 'Sending…' : 'Send code'}</Text>
</Pressable>

<Pressable onPress={() => router.push('/signup')}>
  <Text style={[styles.signupLinkBig, { color: BLUE }]}>New to Gen-D? Sign up</Text>
</Pressable>
```

Add a new style for this (don't reuse `styles.link` — that one must stay
small, since it's still used for Resend code / Edit phone number on the
Phone tab's `'verify'` step):

```ts
signupLinkBig: {
  textAlign: 'center',
  marginTop: 20,
  fontSize: 20,
  fontWeight: '800',
},
```

(Font size/weight here can be tuned, but it should be clearly larger than
the existing 14px `styles.link` — think closer to the 26px `logo` style's
weight, but readable as a single line, not oversized to the point of
wrapping awkwardly.)

---

## Change 2 — Move screen content higher so the keyboard doesn't cover it

**Problem:** Even with the earlier keyboard-avoidance fix (ScrollView
inside KeyboardAvoidingView), the form still sits vertically centered via
`justifyContent: 'center'` in `styles.container`. On smaller screens or
when the keyboard takes up a large portion of the screen, centered content
can still end up partially covered, especially the bottom-most button/link
in each tab. Shifting the whole screen's resting position higher (so
there's more headroom before the keyboard appears) reduces this risk.

**Fix:** Change `styles.container`'s vertical alignment from centered to
top-anchored with a fixed top offset, rather than `justifyContent:
'center'`, so content naturally sits higher up the screen at rest:

```ts
container: { flexGrow: 1, padding: 24, paddingTop: 40 },
```

(Remove `justifyContent: 'center'` — replace with the `paddingTop: 40`
above so content starts near the top instead of being vertically centered.
Adjust the `40` value on-device if it looks too high/low once tested.)

Also double check the existing `KeyboardAvoidingView`
`keyboardVerticalOffset` — if the header (`‹ Back` row) height is causing
extra offset needed on iOS, add a `keyboardVerticalOffset` prop tuned to
that header's height so the padding behavior accounts for it correctly:

```tsx
<KeyboardAvoidingView
  style={styles.keyboardAvoider}
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
>
```

(Tune `60` based on the actual header height on-device — this is a
starting estimate.)

---

## Testing checklist after these changes

- [ ] Email tab shows "New to Gen-D? Sign up" in the new bigger/bolder
      style (upgraded from the old small size).
- [ ] Phone tab, `'request'` step, shows the same big "New to Gen-D? Sign
      up" link below "Send code".
- [ ] Both links look visually identical to each other (same size/weight),
      and tapping either navigates to `/signup`.
- [ ] Phone tab `'verify'` step does NOT show the signup link (only
      "Resend code" / "Edit phone number", still at the small size, as
      before).
- [ ] On both tabs, with the keyboard open, no input field or button is
      hidden behind the keyboard — content sits higher at rest than
      before, giving more visible room once the keyboard appears.
- [ ] All previously-fixed behavior (back button, 10-digit validation,
      tab-switch reset) still works — this change should not regress any
      of it.
