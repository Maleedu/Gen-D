# Phone/OTP Login — Handover to Claude Code

## 1. Overview

Gen-D needs email+password and phone+OTP to work as **parallel** login
options — not one replacing the other. This session we found that
existing accounts have `phone_number` stored only in the `profiles` table,
never as an actual Supabase Auth identity (`auth.users.phone` is `null`
for every existing account). Phone-based login (`signInWithOtp({ phone })`)
matches against `auth.users.phone`, so without linking the phone as a
verified identity, phone login can never find these accounts.

**The fix:** verify and link the phone number as part of Signup, right
after the account is created. This means every new account has phone
login working from day one. (Retroactively linking phone for the 7
existing test accounts is out of scope for this handover — not needed
for testing new signups end-to-end.)

**Country code:** Gen-D is India-only right now. Hardcode `+91` — do not
build country-code selection. Both Signup's phone field and Login's new
Phone tab should show `+91` as a fixed, non-editable prefix next to the
input; the user only types the 10-digit number. Prepend `+91` to that
before calling any Supabase Auth method.

**Test credential in use right now (already configured in Supabase
Dashboard → Authentication → Providers → Phone → Test Phone Numbers and
OTPs):** `919700434372=8340` (registered without a `+`, per Supabase's
own requirement for that specific field — this is unrelated to the `+91`
prefix used everywhere in actual API calls, which does need the `+`).
Twilio fields are currently filled with harmless placeholder strings
(`placeholder_sid`, etc.) just to satisfy Supabase's dashboard form
validation — no real SMS provider is wired up yet, and none is needed for
this handover. Wiring a real SMS provider is a deliberate future task,
not part of this work.

---

## 2. Fix `mobile/app/signup.tsx`

### 2a. Pre-existing bug, fix while you're in this file
`submitting` state is declared and used to disable the button
(`disabled={submitting}`) and change its label ("Creating account…"), but
`setSubmitting(true)` is never actually called anywhere in
`handleSignup`. Only `setSubmitting(false)` exists, in the wrong place.
Fix so `setSubmitting(true)` is called at the very start of
`handleSignup`, before the `supabase.auth.signUp(...)` call, so rapid
double-tapping the button is actually prevented.

### 2b. New phone verification step

After `supabase.auth.signUp(...)` succeeds (no `error`):

1. Immediately call:
   ```js
   const { error: phoneError } = await supabase.auth.updateUser({
     phone: `+91${form.phone}`,
   });
   ```
2. If `phoneError` — don't block the flow. The account already exists and
   works via email+password regardless of whether phone linking
   succeeds. Show an alert with the error message and two options:
   "Skip for now" (proceeds straight to the existing "Welcome to Gen-D"
   alert + `router.replace('/login')`) and "Try again" (re-attempts the
   `updateUser` call).
3. If no error — the OTP has been sent (or, for the registered test
   number, is ready to be entered). Show a new inline UI state on this
   same screen (do not navigate to a new route) with:
   - A message: `We sent a code to +91${form.phone}. Enter it below to
     verify your number.`
   - A 6-digit numeric text input
   - A "Verify" button, calling:
     ```js
     const { error: verifyError } = await supabase.auth.verifyOtp({
       phone: `+91${form.phone}`,
       token: enteredCode,
       type: 'phone_change',
     });
     ```
     - On success: show the existing "Welcome to Gen-D" alert and
       `router.replace('/login')`, same as today.
     - On error: show an alert with the error message, let them retry
       the code entry (don't clear the whole flow).
   - A "Resend code" link/button that just re-calls the `updateUser`
     step from 2b.1 again.
   - A "Skip for now" option here too, same behavior as 2b.2's skip.

This is all one continuous screen — swap the visible content
conditionally (form → phone-verification step) rather than navigating
away, same pattern used in `my-orders.tsx`'s bid-review view from the
customer-driver mode handover doc.

---

## 3. Add a Phone tab to `mobile/app/login.tsx`

### 3a. Tab toggle
Add a simple two-option toggle at the top of the screen, above the
existing email/password form: **Email** / **Phone**. Reuse the visual
pattern already established by `ModePill`/mode-row styling in
`mobile/app/(tabs)/index.tsx` if practical, for consistency — a small
pill-style segmented control, not a full redesign.

- **Email tab (default/active on load):** exactly the existing
  email+password form, unchanged.
- **Phone tab:** new UI, described below.

### 3b. Phone tab UI and flow

**Step 1 — request code:**
- A `+91` fixed prefix label next to a 10-digit phone number input
  (`keyboardType="phone-pad"`)
- A "Send code" button, calling:
  ```js
  const { error } = await supabase.auth.signInWithOtp({
    phone: `+91${phoneNumber}`,
    options: { shouldCreateUser: false },
  });
  ```
- If `error` — show it in an alert. If the error indicates no matching
  user (Supabase returns an error here specifically because
  `shouldCreateUser: false` prevents silent account creation), phrase the
  alert clearly: "No account found with this number. Sign up first." with
  a link/button to `/signup`.
- If no error, move to Step 2 (same screen, swap the visible content, same
  pattern as the Signup phone step above).

**Step 2 — verify code:**
- 6-digit numeric input
- "Verify" button, calling:
  ```js
  const { error } = await supabase.auth.verifyOtp({
    phone: `+91${phoneNumber}`,
    token: enteredCode,
    type: 'sms',
  });
  ```
- On success: `router.replace('/')`, same as the existing email login's
  success path.
- On error: alert with the message, let them retry the code.
- Include a "Resend code" option that re-runs Step 1's `signInWithOtp`
  call, and a way to go back and edit the phone number (back to Step 1)
  in case of a typo.

---

## 4. Explicitly out of scope for this handover

- Retroactively linking phone numbers for the 7 existing test accounts —
  not needed to test new signups end-to-end. If manual testing later
  needs an existing account with phone linked, that can be done directly
  via Supabase Auth admin APIs at that time, not as part of this build.
- Wiring a real SMS provider (Twilio or otherwise) — deliberately
  deferred until before real users onboard.
- Country code selection — hardcoded `+91` only.
- WhatsApp OTP channel (Twilio-specific, not relevant here).

---

## 5. Testing checklist (manual, after build)

- [ ] Sign up a brand-new test account with a real 10-digit number typed
      into the phone field
- [ ] Confirm the phone-verification step appears immediately after
      account creation, before the "Welcome to Gen-D" alert
- [ ] Enter the registered test OTP (`8340` for `+919700434372` — adjust
      the phone number used in this specific test to match what's
      registered in the Supabase dashboard) and confirm it verifies
      successfully and proceeds to Login
- [ ] Verify via direct SQL query that `auth.users.phone` is now
      populated for that account:
      `select id, phone, phone_confirmed_at from auth.users where id = '<id>';`
- [ ] Test "Skip for now" — confirm account creation still completes and
      routes to Login even if phone verification is skipped or fails
- [ ] Test "Resend code" on both Signup and Login phone flows
- [ ] On Login, switch to the Phone tab, enter the now-linked test
      number, confirm "Send code" succeeds and the OTP verifies,
      logging in successfully
- [ ] On Login's Phone tab, try a phone number that has never been
      linked to any account — confirm a clear "No account found" message
      appears rather than silently creating a new account (verify via
      SQL that no new row appeared in `auth.users` after this attempt)
- [ ] Confirm the existing Email tab/login flow is completely unaffected
