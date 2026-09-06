# Phone/OTP Login Review — Fixes Handover

Context: This follows `docs/phone-otp-login-handover.md`, which added phone
verification to signup and an Email/Phone tab toggle to login. Both files
(`mobile/app/signup.tsx` and `mobile/app/login.tsx`) were reviewed line by
line and tested on-device. Five issues were found. This doc lists all five
so they can be fixed in one pass.

---

## Fix 1 — `signup.tsx`: `submitting` never reset on signup error

**File:** `mobile/app/signup.tsx`
**Function:** `handleSignup`

**Problem:** `setSubmitting(true)` was added right before the
`supabase.auth.signUp(...)` call, but the existing error branch below it
only does:

```ts
Alert.alert('Signup failed', error.message);
return;
```

There is no `setSubmitting(false)` in this branch, so if signup fails (e.g.
"email already registered"), `submitting` stays `true` for the rest of that
screen's lifetime. Any UI bound to `submitting` (disabled button, loading
text) gets stuck.

**Fix:** Add `setSubmitting(false);` immediately before the
`Alert.alert('Signup failed', error.message);` line in that error branch.

---

## Fix 2 — `login.tsx`: no validation on phone number length before sending code

**File:** `mobile/app/login.tsx`
**Function:** `handleSendCode`

**Problem:** Tapping "Send code" fires the `supabase.auth.signInWithOtp(...)`
request even if `phoneNumber` is empty or has fewer than 10 digits. There's
no client-side check before hitting the network.

**Fix:** At the top of `handleSendCode`, before calling
`supabase.auth.signInWithOtp`, add a guard:

```ts
if (phoneNumber.length !== 10) {
  Alert.alert('Enter a valid phone number', 'Phone number must be 10 digits.');
  return;
}
```

---

## Fix 3 — `login.tsx`: `phoneStep` doesn't reset when leaving and returning to Phone tab

**File:** `mobile/app/login.tsx`

**Problem:** If a user is on the Phone tab's `'verify'` step (OTP entry),
then switches to the Email tab and back to Phone, they land back on the
`'verify'` step with stale `phoneNumber`/`phoneOtp` state instead of
starting fresh at `'request'`.

**Fix:** When the user taps the "Email" pill in `ModePill`/tab switcher,
reset the phone flow state alongside `setTab('email')`. Concretely, update
the `onPress` for the Email tab (and ideally the Phone tab too, for
consistency) to also reset:

```ts
onPress={() => {
  setTab('email');
  setPhoneStep('request');
  setPhoneOtp('');
}}
```

Do this in the two `ModePill` invocations in the JSX (or centralize it in a
small `switchTab(nextTab: LoginTab)` helper function that both `ModePill`
presses call). Leave `phoneNumber` itself intact — a user shouldn't have to
retype their number after tab-switching, just the OTP/step state.

---

## Fix 4 — `login.tsx`: keyboard covers input fields

**File:** `mobile/app/login.tsx`

**Problem:** On the Login screen, when the keyboard opens (any tab — Email
or Phone), the input field(s) currently being edited are covered by the
keyboard rather than shifting up. The screen already uses
`KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' :
'height'}`, but it's not resolving the issue here.

**Fix:** Investigate and resolve so the active input is always visible above
the keyboard. Things to check/try:
- Confirm `KeyboardAvoidingView` wraps the *entire* scrollable content area,
  not just part of it.
- Consider wrapping the form content in a `ScrollView` inside the
  `KeyboardAvoidingView` (this is the pattern already used in the phone
  verification view added to `signup.tsx` — `ScrollView` inside
  `KeyboardAvoidingView`), since Login currently does not use a
  `ScrollView` at all.
- If `padding` behavior alone isn't enough on iOS, test adding a
  `keyboardVerticalOffset` prop tuned to the header height.
- Verify this on both the Email tab and the Phone tab (both steps), since
  both have text inputs.

---

## Fix 5 — Login screen: no way to navigate back to Home

**File:** `mobile/app/login.tsx`

**Problem:** There is no way to leave the Login screen and return to Home
if a user opens it without meaning to (no back arrow, no cancel).

**Fix:** Add a back button/arrow at the top of the Login screen (consistent
with the back-button style already used elsewhere in the app, e.g. the
signup screen's back-to-login navigation) that calls:

```ts
router.replace('/');
```

Use `router.replace` rather than `router.back()` — Login may be the first
screen in the navigation stack in some flows (e.g. direct entry or after a
redirect), and `router.back()` can fail or no-op in that case with no
history to pop. `router.replace('/')` always resolves predictably to Home.

---

## Testing checklist after fixes

- [ ] Trigger a signup failure (e.g. duplicate email) and confirm the
      "Sign up" button re-enables (no longer stuck showing "Creating…" or
      staying disabled).
- [ ] On Login's Phone tab, tap "Send code" with the field empty and with
      fewer than 10 digits — confirm the new validation alert appears and
      no network request fires.
- [ ] On Login's Phone tab, advance to the OTP "verify" step, switch to
      Email tab, switch back to Phone tab — confirm it resets to the
      "request" step (not verify) with the OTP field cleared.
- [ ] On both Login tabs, tap into each input field and confirm the field
      stays visible above the keyboard (not covered).
- [ ] Confirm a back button/arrow is visible on the Login screen and tapping
      it returns to Home.
