# Gen-D Admin

Internal, staff-only web dashboard for Gen-D. Separate from `mobile/` — desktop-first, not customer/agent-facing. See `docs/admin-dashboard-handover.md` at the repo root for the full spec this was built from.

## Stack

- Vite + React + TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- `@supabase/supabase-js`, same project as `mobile/`
- React Router

No realtime subscriptions — simple fetch + manual refresh button, matching a single-admin internal tool.

## Setup

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## Auth

Email/password via Supabase Auth. On sign-in, `AuthProvider` (`src/lib/auth.tsx`) checks `profiles.is_admin` for the signed-in user; anything that isn't an admin is immediately signed back out and never sees the dashboard shell. There's no self-service path to become an admin — new admins are added by setting `profiles.is_admin = true` directly in Supabase.

## Screens

- **KYC Queue** (`/kyc`) — agents grouped by their submitted `agent_documents`, filterable by document status. View each document (signed URL against the private `agent-documents` bucket), approve/reject individually, and approve or revoke the agent's overall `is_agent_verified` flag.
- **Complaints Queue** (`/complaints`) — `complaints`, filterable by status, with the linked order's route/description, the delivery photo (signed URL against `delivery-photos`), and seal-check result as supporting evidence. Transition status between `open` / `investigating` / `resolved` / `dismissed`.

## Known limitation

`agent_documents` has no `verified_by` column, so there's no record of which admin approved a document — irrelevant with the one real admin account today (see the handover doc).
