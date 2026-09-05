# Admin Dashboard — Handover to Claude Code

This is a **brand new codebase** — a separate React web app, not part of the `mobile` Expo project. Per your project notes: desktop-first, not Expo web, admin-only (never customer/agent-facing).

Backend for this is fully built, tested, and — importantly — **two real security bugs were found and fixed while scoping this**, both before any dashboard code existed. Details below; you don't need to re-verify them, just know why the numbers might look different from what a naive read of the schema would suggest.

---

## Suggested setup (assumption — correct me if you have a different preference)

New top-level folder `admin/` alongside `mobile/` and `supabase/` in the same repo. Stack:
- Vite + React + TypeScript (no need for Next.js/SSR complexity for an internal tool with one user)
- Tailwind CSS (matches the app's existing design language — Facebook-blue `#1877F2` primary, black/white theme)
- `@supabase/supabase-js` client, same pattern as the mobile app
- React Router for the ~3 screens below
- No realtime subscriptions needed for v1 — simple fetch + manual refresh button is enough for an internal tool used by one admin right now

---

## Auth

Supabase Auth, email/password (not phone OTP — this is for trusted staff, not the general public).

1. Login screen: `supabase.auth.signInWithPassword({ email, password })`.
2. On success, immediately check admin status:
   ```js
   const { data } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
   if (!data?.is_admin) {
     await supabase.auth.signOut();
     // show "not authorized" — do not render the dashboard shell
   }
   ```
3. There is currently exactly **one** real admin account (`Nav M`, permanently flagged this session). No self-service "become an admin" path exists or should exist — new admins get added by directly setting `profiles.is_admin = true` in Supabase, by design.

---

## Screen 1: KYC Queue

**Data:** `agent_documents` joined to `profiles`.

```js
const { data } = await supabase
  .from('agent_documents')
  .select('id, profile_id, doc_type, storage_path, verification_status, verified_at, created_at, profiles(first_name, last_name, phone_number)')
  .order('created_at', { ascending: true });
```

Group by `profile_id` — one card/row per agent, expandable to show all their submitted documents (`doc_type` is one of `aadhaar` / `driving_licence` / `vehicle_rc` / `other`). Default view: filter to agents with at least one `pending` document; add a filter/tab to see `verified`/`rejected` too.

**Viewing the actual document image** (bucket is private, not public):
```js
const { data } = await supabase.storage.from('agent-documents').createSignedUrl(storage_path, 300);
// data.signedUrl — use as <img src>
```
This works because the admin's session now has read access via a policy fix this session (see below) — don't skip it or images will silently fail to load.

**Actions:**
- Approve/reject an individual document:
  ```js
  await supabase.from('agent_documents')
    .update({ verification_status: 'verified', verified_at: new Date().toISOString() }) // or 'rejected'
    .eq('id', docId);
  ```
- Approve the agent overall (separate, explicit action — not automatic):
  ```js
  await supabase.from('profiles').update({ is_agent_verified: true }).eq('id', profileId);
  ```
  This is deliberately **not gated** by "all documents must be verified first" — the admin has final judgment, matching the existing "manual KYC" design. A reasonable UI suggestion: visually flag when `aadhaar` + `driving_licence` are both `verified` (and `vehicle_rc` too, if `agent_vehicles.vehicle_type != 'none'` for that agent) so the admin has a clear signal, but don't hard-block the approve button on it.

**Known limitation, not fixed, not blocking:** `agent_documents` has `verified_at` but no `verified_by` column — you can't currently tell *which* admin approved something. Irrelevant with one admin; worth adding later if you ever have more than one.

---

## Screen 2: Complaints Queue

**Data:**
```js
const { data } = await supabase
  .from('complaints')
  .select('id, order_id, raised_by, reason, status, created_at')
  .order('created_at', { ascending: false });
```
Default view: filter to `status = 'open'`; tabs for `investigating` / `resolved` / `dismissed`.

**Show supporting evidence** — many complaints are auto-raised from a broken seal report, so pull the linked delivery photo and seal result:
```js
const { data: photo } = await supabase.from('delivery_photos').select('photo_url').eq('order_id', orderId).maybeSingle();
const { data: seal } = await supabase.from('delivery_verifications').select('seal_status, verified_at').eq('order_id', orderId).maybeSingle();
```
`delivery_photos.photo_url` is a path in the private `delivery-photos` bucket — same `createSignedUrl` pattern as above. This bucket's admin-read policy already existed correctly before this session (unlike `agent-documents`, which needed a fix) — no extra work needed there.

**Action — transition status:**
```js
await supabase.from('complaints').update({ status: newStatus }).eq('id', complaintId);
// newStatus: 'investigating' | 'resolved' | 'dismissed'
```

---

## Two real bugs fixed this session (context, not action items)

1. **Any agent could self-approve their own KYC documents.** The original RLS policy on `agent_documents` only checked row ownership (`auth.uid() = profile_id`), not which columns or values were being set — meaning an agent could directly `UPDATE ... SET verification_status = 'verified'` on their own row, fully bypassing admin review. Fixed by splitting into narrow SELECT/INSERT-only policies for the owner (INSERT now requires `verification_status = 'pending'`), leaving UPDATE exclusively to `is_admin_user()`. Tested: self-approval blocked, legitimate upload still works, admin approval still works.
2. **The `agent-documents` storage bucket had no admin-read policy at all** — even after fixing #1, an admin could see that a document existed but never actually view the image, making review impossible. Added a matching `is_admin_user()` SELECT policy (same pattern `delivery-photos` already had correctly). Tested working.

Both are already applied to the live database — nothing for you to run, just don't be surprised the RLS is stricter than a first read of an older schema dump might suggest.
