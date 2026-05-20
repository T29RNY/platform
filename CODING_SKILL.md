# In or Out — Coding Skill
## How to plan and execute code changes in this codebase

---

## THE METHODOLOGY

Every change follows this sequence without exception:

AUDIT → REVIEW → EXECUTE → VERIFY → COMMIT

- Never edit during an audit prompt
- Never skip the verify step
- Never commit without a passing build
- When the audit reveals ambiguity, ask one clarifying
  question before writing any execute prompt

---

## STEP 1 — AUDIT

Read every file relevant to the change. Report:

- Current state of the code
- Full function signatures and all call sites
- Props received, state variables, imports
- What the DB schema expects (columns, types, constraints)
- RLS exposure — see RLS CHECKLIST below
- RPC coverage — see RPC CHECKLIST below
- Any mismatch between client code, RPC signature, and DB schema
- Integration points and risk flags

No edits during audit. Developer reviews output before proceeding.

Cross-reference supabase.js function signatures against the
actual RPC SQL when columns or return shapes are in question.
Cross-reference CONTEXT.md schema section when table columns
are touched.

---

## STEP 2 — EXECUTE

Make only the changes agreed after audit review.
One file or one logical unit per prompt.
Split large changes into named parts (e.g. Part A, Part B).
Describe WHAT and WHY — not exact code.

**CRITICAL — prompt length:**
Keep execute prompts short. Long prompts truncate silently
in Claude Code and cause partial or wrong implementations.
If a change needs a long explanation, split it into two prompts.

Build command after every execute prompt:
  cd apps/inorout && npm run build

(Monorepo root build: cd ../.. && npm install && cd apps/inorout && npm run build)

---

## STEP 3 — VERIFY

After every execute prompt, run checks:

- grep for removed terms — confirm deletion
- grep for new terms — confirm presence at all expected locations
- Check all call sites match the new signature
- Confirm build passes clean (no errors, no warnings)
- If DB columns or tables were touched, cross-reference
  CONTEXT.md schema and confirm column names match exactly
- If an RPC was added or changed, confirm the raw RPC name
  (snake_case) appears in exactly one supabase.rpc() call
  in supabase.js and nowhere else

Developer reviews verify output before moving to commit.

---

## STEP 4 — COMMIT

Only after verify passes:

  git add -A
  git commit -m "type(scope): description"
  git push

Confirm working tree is clean. Report the commit hash.
Update CONTEXT.md if the change affects schema, known bugs,
or completed features.

---

## RLS CHECKLIST

RLS is enabled on all 19 tables. All direct client writes
are blocked. Assume nothing works until proven otherwise.

Before any Supabase read or write, answer these:

**1. Who is the caller?**
- anon — player token routes (/p/TOKEN), unauthenticated join flow
- authenticated — post-auth join flow, /create, My Squads
- admin token — all AdminView writes

**2. Direct table access or RPC?**
- Direct writes: blocked for all roles — always use SECURITY DEFINER RPCs
- Direct reads: blocked for anon on most tables post-session-24
- Authenticated reads: limited — check policies before assuming they work
- When in doubt, use an RPC

**3. Does an RPC already exist for this?**
Check CONTEXT.md → RPC functions section for the current list.
Groups to check:
- Player token RPCs (migration 011)
- Admin token RPCs (migration 012–018)
- Auth RPCs (migration 022)
- Onboarding RPCs (migration 015)
- Self-join RPC (session 27): player_join_team

**4. Does the RPC need team context?**
- Admin RPCs derive team_id from p_admin_token server-side — never pass team_id as a trust signal from the client
- Player RPCs derive context from auth.uid() or p_token
- Authenticated RPCs use auth.uid() — no parameters needed for identity

**5. Demo environment caveat:**
Do not trust demo test results for RLS or auth flows.
team_demo has seeded created_at dates and no team_admins row.
Always verify auth-dependent behaviour against a real team
(team_finbars or a freshly created team).

---

## RPC CHECKLIST

When an existing RPC does not cover the required write:

1. Write the SQL first — apply in Supabase SQL editor before
   touching any JS file
2. Use SECURITY DEFINER
3. REVOKE ALL from anon if authenticated-only
4. GRANT EXECUTE to the correct role (anon or authenticated)
5. Authenticate via auth.uid() — never trust a passed user_id
6. Return jsonb
7. Add wrapper function in packages/core/storage/supabase.js
8. Export from packages/core/index.js barrel
9. Import at the call site
10. Verify: grep confirms RPC name appears in exactly one
    supabase.rpc() call in supabase.js, nowhere else in the codebase

When modifying an existing RPC:
- Check every migration file that references the function
- Check every supabase.js wrapper that calls it
- Check every component that imports the wrapper
- SQL change first, then wrapper, then call site

---

## SCHEMA CHANGE CHECKLIST

When any column is moved, renamed, or dropped:

1. Grep ALL migration files immediately:
   grep -r "column_name" rls_migrations/
   Report every file and line it appears in.

2. For each match assess:
   - Is it reading from the old table? → fix
   - Is it writing to the old table? → fix
   - Is it the migration itself? → correct
   - Is it a comment or parameter? → safe

3. Fix all stale references in the same
   commit as the schema change — never
   leave them for later

4. Run a build after fixes to confirm
   no JS references are broken

5. Test the affected RPCs against a real
   team (not demo) before closing the issue

Example: moving is_vice_captain from players
to team_players in session 26 broke 6 RPCs
silently — add_guest_player, admin_add_player,
admin_confirm_payment, admin_reset_payment,
admin_clear_debt, admin_waive_debt all threw
internal_error until session 27 cleanup.

## RPC PARAMETER TYPE CHANGES

When changing a parameter type on an existing
RPC (e.g. int → numeric):

- CREATE OR REPLACE does NOT replace the old
  version — PostgreSQL treats different
  parameter types as different overloads
- Always DROP the old signature explicitly
  before or after CREATE OR REPLACE:
  DROP FUNCTION IF EXISTS fn_name(old, types);
- Failure to do this causes:
  "could not choose best candidate function"
  error at runtime
- Add the DROP to the migration file alongside
  the CREATE OR REPLACE

---

## CONVENTIONS

**Code:**
- All async functions: try/catch, console.error on error — never console.log
- Optimistic UI with revert on error for all Supabase-calling handlers
- Double-fire guard: isSavingRef = useRef(false) for save buttons

**Styling:**
- CSS variables from tokens.css only
- Only two hardcoded hex colours allowed: #60A0FF (Team A), #FF6060 (Team B)
- CSS vars cannot be used in SVG fill/stroke — use hex literals or style={{}} inside SVG
- Phosphor icons weight="thin" throughout
- Bebas Neue for headings and numbers, DM Sans 400 for body

**Data:**
- Display text: POTM (not MOTM), Results (not History) — DB columns and filenames unchanged
- player_match is the source of truth for all stats — players flat columns are write-only convenience fields
- Reliability is always all-time — never period-filtered
- player_match.match_id is text not uuid

**Naming:**
- supabase.js wrapper functions: camelCase matching the JS convention
- RPC SQL functions: snake_case
- Raw RPC names never appear outside supabase.rpc() in supabase.js

---

## PROMPT PATTERNS

**Audit:**
```
Read [file] in full and report findings only. No changes.
Report: [specific list].
No edits. Audit only.
```

**Execute:**
```
In [file], [one specific change].
No other changes.
Then run: cd apps/inorout && npm run build
Report build result.
```

**Verify:**
```
Grep the codebase for [term].
Report every file it appears in and why.
No edits.
```

**Commit:**
```
git add -A
git commit -m "[type(scope): description]"
git push
Report the commit hash.
```

**SQL (Supabase SQL editor — not Claude Code):**
Paste raw SQL only. No surrounding explanation text.
Apply SQL before writing any JS wrapper.
