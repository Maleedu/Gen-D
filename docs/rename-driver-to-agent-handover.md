# Rename "Driver" to "Agent" in UI Text

Context: Gen-D's backend and schema already use "agent" everywhere
(`agent_documents`, `is_agent_verified`, `agent-documents` storage bucket,
`agent_location_pings`, `get_agent_gamification_profile`, etc.). The mobile
app's UI, however, currently shows the word "Driver" to users in a few
places (e.g. the Home screen's Customer/Driver mode toggle). This doc asks
for a full sweep of the mobile app to rename all **user-visible** text from
"Driver" to "Agent", while leaving all **internal code values** exactly as
they are.

---

## The rule: visible text vs internal value

This is the most important distinction in this task — get this rule right
before making any change:

- **Visible text (RENAME to "Agent"):** Anything a user actually reads on
  screen — button labels, headings, alert messages, placeholder text,
  screen titles, tab labels. Example already found:

  ```tsx
  // mobile/app/(tabs)/index.tsx, around line 99
  <ModePill
    label="Driver"
    active={mode === 'driver'}
    color={AMBER}
    onPress={() => onChange('driver')}
    c={c}
  />
  ```

  Here, `label="Driver"` is visible text — rename this to `label="Agent"`.

- **Internal value (DO NOT rename):** String literals used purely in code
  logic — state values, comparisons, route params, object keys — that a
  user never sees directly. In the same example above, `mode === 'driver'`
  and `onChange('driver')` are internal values — **leave these exactly as
  `'driver'`**. Do not rename these to `'agent'` anywhere in the codebase.

  This also applies to code comments referencing "driver" for internal
  clarity (e.g. `// Wall is Driver-mode-only content` in
  `mobile/app/post-item.tsx`) — comments describing internal logic can stay
  as-is; only rename comments if you judge them to be describing
  user-facing copy specifically.

**Rationale:** Renaming the internal `'driver'` string value would require
touching every file that checks `mode === 'driver'` (multiple `_layout.tsx`
files, `post-item.tsx`, and likely others), and risks missing one and
silently breaking mode-based routing or conditional rendering. That is a
much larger, riskier change than what's being asked for here — this task
is a display-text-only rename.

---

## What to do

1. Search the entire `mobile/` app (not `supabase/`, not `admin/`) for the
   word "Driver" or "driver" in **JSX text content, string literal props
   used for display (like `label=`, `placeholder=`, alert titles/messages,
   button/heading text), and screen titles** — case-insensitively, since
   capitalization may vary by context (e.g. "driver" inside a sentence vs
   "Driver" as a proper label).
2. For each match, judge it against the rule above:
   - If it's something a user reads on screen → rename "Driver"/"driver" to
     "Agent"/"agent" (matching the original capitalization pattern — i.e.
     if it's capitalized "Driver" in a label, use "Agent"; if it's
     lowercase inside a sentence, use lowercase "agent").
   - If it's an internal state value, comparison, or route/param key → do
     not touch it.
3. Known confirmed rename (from the search already done this session):
   - `mobile/app/(tabs)/index.tsx` line 99: `label="Driver"` →
     `label="Agent"` (leave `mode === 'driver'` and `onChange('driver')` on
     the same block untouched).
4. Check for any other visible strings elsewhere in the app referencing
   "driver" — for example (not confirmed, please verify): screen headers,
   alert dialogs about KYC/verification ("agent profile isn't verified"
   already uses "agent" per earlier screenshots — confirm this pattern is
   consistent everywhere), onboarding copy, or any tooltip/help text.
5. Do NOT touch:
   - `supabase/` (any SQL, migrations, RLS policies)
   - `admin/` (the separate admin dashboard codebase) — unless explicitly
     asked to do so later, this is out of scope for this pass
   - Internal variable names, state values, function names, comments about
     internal logic (per the rule above)

---

## After making changes

- Run `tsc --noEmit` and `eslint` on every file touched, confirm both pass
  clean.
- Provide a summary list of every file changed and, for each, a one-line
  description of what visible text was renamed (e.g. "index.tsx: Home
  screen mode toggle label 'Driver' → 'Agent'").
- Do not commit — this will be reviewed via `git diff` before committing.

## Testing checklist after these changes

- [ ] Home screen's mode toggle shows "Agent" instead of "Driver".
- [ ] Switching to Agent mode still works correctly (internal routing/mode
      logic unaffected — `mode === 'driver'` should still be true
      internally when Agent mode is selected).
- [ ] Any other screen/alert previously showing "Driver" now shows "Agent".
- [ ] No internal state values, comparisons, or route params were renamed
      — app behavior is unchanged, only display text differs.
