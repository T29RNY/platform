# CLAUDE.md — In or Out

This file is auto-loaded by Claude Code on every session.
It encodes the methodology, conventions, and hard rules
for this codebase. Do not violate without explicit instruction.

For schema see `SCHEMA.md`, RPCs see `RPCS.md`, bugs see `BUGS.md`,
go-live pre-flight see `GO_LIVE_ISSUES.md`,
decisions see `DECISIONS.md`, features see `FEATURES.md`,
IO spec see `IO_INTELLIGENCE.md`, Ask the Gaffer / AI agent layer see
`GAFFER.md`, session history see `CONTEXT.md`.
For methodology rationale see `CODING_SKILL.md`.
This file is the operating contract.

---

## OPERATOR PROFILE

The developer is non-technical on tooling. They understand
the product, the architecture, the methodology, and the
business deeply. They do NOT know terminal commands, git
syntax, grep flags, or npm internals.

Implications for how you work:

- Run terminal commands yourself. Do not give the developer
  commands to copy-paste. They asked you to do something,
  so do it.
- After running a command, explain the result in plain
  English. "Build passed clean" not a dump of webpack output.
  "Three files still reference the old function name —
  here they are" not a raw grep output.
- When the developer says "check it worked" or "verify"
  or "did it build" — interpret this as a request for YOU
  to run the relevant checks (grep, build, git status etc)
  and report back in plain English.
- When the developer says "commit this" — run git add,
  commit with a sensible message in the type(scope): format,
  push, then report the commit hash. Do not ask them to
  run the commands.
- If a command fails, explain what went wrong and what you
  propose to try next. Don't dump the error and wait.
- Never assume the developer can read raw stderr, stack
  traces, or SQL error codes. Translate.

The developer is responsible for: product decisions,
methodology adherence, reviewing diffs, approving execute
prompts. You are responsible for: executing the commands,
reading the output, and summarising in plain English.

---

## METHODOLOGY — FOLLOW WITHOUT EXCEPTION

Every change follows this sequence:

  AUDIT → EXECUTE → VERIFY → COMMIT → POST-DEPLOY

Detailed skill files exist for every step. Read them at the
start of each step — do not rely on memory of the sequence.
The skill files are the authoritative source for each step.

  skills/cycle.md       — conductor: owns the full sequence
  skills/audit.md       — step 1: scope the change, no edits
  skills/execute.md     — step 2: make the agreed changes
  skills/verify.md      — step 3: prove correctness before commit
  skills/commit.md      — step 4: lock into version control
  skills/post-deploy.md — step 5: confirm live site is correct

Deterministic checks run automatically during verify.
Call the scripts directly — do not re-implement them inline:

  bash skills/scripts/check-build.sh
  bash skills/scripts/check-hygiene.sh               ← 7 checks incl. state-wrapper-guard
  bash skills/scripts/check-references.sh "term" [--removed|--rpc]
  bash skills/scripts/check-rpc-security.sh rpc_name ← security + search_path + overloads
  bash skills/scripts/check-db-schema.sh table_name
  bash skills/scripts/check-schema-column.sh table column ← pre-column-change impact map
  bash skills/scripts/check-rpc-columns.sh rpc_name  ← stale column refs in RPC bodies

Situation-specific skills — invoke these automatically when the
situation matches, without waiting for the developer to ask:

  skills/session-start.md     — run at the start of EVERY session before
                                 any task begins. Produces a session brief.
  skills/feature-plan.md      — run before audit.md when starting a new
                                 feature from FEATURES.md backlog.
  skills/schema-sync.md       — run before ANY column rename, move, or drop.
                                 Mandatory. Do not skip.
  skills/rpc-security-sweep.md — run before commit when ANY RPC was added
                                  or modified. Gate between verify and commit.
  skills/post-incident.md     — run after every bug fix is committed.
                                 Proposes BUGS.md, DECISIONS.md, CONTEXT.md updates.

- Never edit during audit
- Never skip verify
- Never commit without a passing build
- Never rename or drop a column without running schema-sync.md first
- Never commit an RPC change without running rpc-security-sweep.md first
- When audit reveals ambiguity, ask ONE clarifying question
  before execute starts
- One file or one logical unit per execute part

---

## STEP 1 — AUDIT (plan mode)

Read every file relevant to the change. Report:

- Current state of the code
- Full function signatures and all call sites
- Props received, state variables, imports
- DB schema expectations (columns, types, constraints)
- RLS exposure (see RLS CHECKLIST below)
- RPC coverage (see RPC CHECKLIST below)
- Any mismatch between client code, RPC signature, and DB schema
- Integration points and risk flags

No edits during audit. Wait for review before execute.

Cross-reference `supabase.js` function signatures against
the actual RPC SQL when columns or return shapes are in
question. Cross-reference CONTEXT.md schema section when
table columns are touched.

---

## STEP 2 — EXECUTE

Make only the changes agreed after audit review.
Describe WHAT and WHY — not exact code.

Build command after every execute prompt:
  cd apps/inorout && npm run build

Monorepo root build (if dependencies changed):
  cd ../.. && npm install && cd apps/inorout && npm run build

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
  (snake_case) appears in exactly ONE supabase.rpc() call
  in supabase.js and nowhere else

---

## STEP 4 — COMMIT

Only after verify passes:

  git add -A
  git commit -m "type(scope): description"
  git push

Confirm working tree clean. Report commit hash.
Update CONTEXT.md if the change affects schema, known bugs,
or completed features.

---

## RLS CHECKLIST

RLS is enabled on all 19 tables. All direct client writes
are blocked. Assume nothing works until proven otherwise.

Before any Supabase read or write, answer:

**1. Who is the caller?**
- anon — player token routes (/p/TOKEN), unauth join flow
- authenticated — post-auth join flow, /create, My Squads
- admin token — all AdminView writes

**2. Direct table access or RPC?**
- Direct writes: blocked for all roles — always use SECURITY DEFINER RPCs
- Direct reads: blocked for anon on most tables post-session-24
- Authenticated reads: limited — check policies before assuming they work
- When in doubt, use an RPC

**3. Does an RPC already exist for this?**
Check CONTEXT.md → RPC functions section.

**4. Does the RPC need team context?**
- Admin RPCs: derive team_id from p_admin_token server-side.
  Never pass team_id as a trust signal from the client.
- Player RPCs: derive context from auth.uid() or p_token
- Authenticated RPCs: use auth.uid() — no identity params needed

**5. Demo environment caveat:**
Do not trust demo test results for RLS or auth flows.
team_demo has seeded created_at dates and no team_admins
row. Always verify auth-dependent behaviour against a real
team (team_finbars or a freshly created team).

---

## RPC CHECKLIST

When an existing RPC does not cover the required write:

1. Write the SQL first — apply in Supabase SQL editor BEFORE
   touching any JS file
2. Use SECURITY DEFINER
3. REVOKE ALL from anon if authenticated-only
4. GRANT EXECUTE to the correct role (anon or authenticated)
5. Authenticate via auth.uid() — never trust a passed user_id
6. Return jsonb
7. Add wrapper function in packages/core/storage/supabase.js
8. Export from packages/core/index.js barrel
9. Import at the call site
10. Verify: grep confirms RPC name appears in exactly ONE
    supabase.rpc() call in supabase.js, nowhere else

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
   Report every file and line.

2. For each match assess:
   - Reading from old table? → fix
   - Writing to old table? → fix
   - Migration itself? → correct
   - Comment or parameter? → safe

3. Fix all stale references in the same commit as the
   schema change. Never leave for later.

4. Build after fixes to confirm no JS references are broken.

5. Test the affected RPCs against a real team (NOT demo)
   before closing the issue.

---

## RPC PARAMETER TYPE CHANGES

When changing a parameter type on an existing RPC (e.g. int → numeric):

- CREATE OR REPLACE does NOT replace the old version —
  PostgreSQL treats different parameter types as different
  overloads
- Always DROP the old signature explicitly:
  DROP FUNCTION IF EXISTS fn_name(old, types);
- Failure causes runtime error:
  "could not choose best candidate function"
- Add the DROP to the migration file alongside CREATE OR REPLACE

---

## RPC CALL SITE CHECKLIST

After any RPC signature change or rewrite:

1. Grep every call site immediately:
   grep -r "functionName" apps/ packages/
   Report every file, line, exact arguments passed.

2. Check argument ORDER at every call site — not just the
   ones changed. Inverted arguments cause silent failures
   (JS compiles clean, RPC receives wrong values).

3. Check App-level state wrappers separately. setSchedule,
   setSettings, setBibHistory etc in App.jsx may contain
   duplicate DB calls with stale argument order from pre-RLS
   rewrites. These wrappers MUST be pure state setters only —
   child screens own their own persistence via explicit RPC calls.

4. Never assume the UI reflects the DB. When something
   appears not to save, query the DB directly first.

---

## SUPABASE SCHEMA CACHE

PostgREST caches function signatures. After any RPC change,
the cache may serve a stale version causing 404 Not Found.

Symptoms:
- 404 on a function that exists in pg_proc
- Error hint shows wrong parameter order
- Function works after waiting 5 minutes

Fixes in order of preference:
1. SELECT pg_notify('pgrst', 'reload schema');
2. CREATE OR REPLACE on the affected function — forces
   cache invalidation
3. Wait — Supabase auto-refreshes every 5 minutes on free tier
4. Restart PostgREST — paid plans only

---

## STATE WRAPPER PATTERN

App.jsx state wrappers (setSchedule, setSettings etc) MUST
be pure React state setters only. Never add DB persistence
inside them.

Wrong:
```js
const setSchedule = async (updater) => {
  const next = ...updater...;
  setScheduleRaw(next);
  await upsertSchedule(token, next); // BANNED
};
```

Correct:
```js
const setSchedule = (updater) => {
  const next = ...updater...;
  setScheduleRaw(next); // state only
};
```

Child screens call upsertSchedule explicitly with adminToken
before calling setSchedule for UI sync. Established pattern
in ScheduleScreen, AdminView openNextWeek, RemindersScreen.

---

## CONVENTIONS

**Code:**
- All async functions: try/catch, console.error on error.
  Never console.log
- Optimistic UI with revert on error for all Supabase-calling
  handlers
- Double-fire guard: isSavingRef = useRef(false) for save buttons

**Styling:**
- CSS variables from tokens.css only
- Only two hardcoded hex colours allowed: #60A0FF (Team A),
  #FF6060 (Team B)
- CSS vars cannot be used in SVG fill/stroke — use hex
  literals or style={{}} inside SVG
- Phosphor icons weight="thin" throughout
- Bebas Neue for headings and numbers, DM Sans 400 for body

**Data:**
- Display text: POTM (not MOTM), Results (not History).
  DB columns and filenames unchanged
- player_match is the source of truth for all stats.
  players flat columns are write-only convenience fields
- Reliability is always all-time — never period-filtered
- player_match.match_id is text not uuid

**Naming:**
- supabase.js wrapper functions: camelCase
- RPC SQL functions: snake_case
- Raw RPC names never appear outside supabase.rpc() in supabase.js

---

## PROMPT PATTERNS

**Audit (use plan mode — Shift+Tab twice):**
```
Read [file] in full and report findings only.
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

**SQL (Supabase SQL editor — NOT Claude Code):**
Paste raw SQL only. No surrounding explanation.
Apply SQL before writing any JS wrapper.

---

## CONTEXT FILES — READ THESE AS NEEDED

**Every session — read first:**
- `BUGS.md` — open bugs, priority ordered. Always read before touching code.

**Any Supabase work:**
- `SCHEMA.md` — full DB schema, constraints, type conventions
- `RPCS.md` — full RPC inventory, JS wrapper names, grant/revoke

**Building new features:**
- `DECISIONS.md` — settled architectural and product decisions
- `FEATURES.md` — phase tracker; what's built, what's next, IO unlock grid

**IO Intelligence work only:**
- `IO_INTELLIGENCE.md` — full IO spec, hook structure, edge cases, H2H detail

**Ask the Gaffer / AI agent layer work only:**
- `GAFFER.md` — positioning, architecture, provider (Vercel AI Gateway → Anthropic Sonnet 4.6),
  data-access pattern (`gaffer_get_context_*` RPCs + `ai_briefings` audit table),
  four-phase rollout, surface specs, shared system prompt

**Historical reference (session archive):**
- `CONTEXT.md` — infrastructure, key tokens, demo env, session notes 1–28

---

## KEY FILES

- `BUGS.md` — active bugs and tech debt. Read at session start.
- `GO_LIVE_ISSUES.md` — operator-facing pre-onboarding pre-flight log.
  Every production issue ever hit, with a device-level check per item.
  Read (and extend) before opening the app to a new squad. Any new
  production bug must be appended here in the same commit as the fix.
- `SCHEMA.md` — database schema. Read before any Supabase work.
- `RPCS.md` — RPC inventory. Read before any write path work.
- `DECISIONS.md` — key decisions log.
- `FEATURES.md` — phase tracker and IO unlock grid.
- `IO_INTELLIGENCE.md` — IO spec. Read only for IO work.
- `GAFFER.md` — AI agent layer spec. Read only for Gaffer work.
- `CONTEXT.md` — infrastructure, tokens, session history.
- `CODING_SKILL.md` — full methodology rationale and examples
- `packages/core/storage/supabase.js` — every Supabase call.
  Wrapper functions only. Raw RPC names live here exclusively
- `packages/core/index.js` — barrel export. Every new wrapper
  must be re-exported here
- `rls_migrations/` — SQL source of truth for RPCs.
  Numbered chronologically
- `apps/inorout/src/App.jsx` — routing, data loading, realtime,
  auth. State wrappers must stay pure

**Skills directory:**
- `skills/cycle.md` — full cycle conductor. Read when resuming an abandoned cycle.
- `skills/session-start.md` — session opener. Run at the start of every session.
- `skills/audit.md` — step 1. Scope and report. No edits.
- `skills/execute.md` — step 2. Make agreed changes only.
- `skills/verify.md` — step 3. Prove correctness.
- `skills/commit.md` — step 4. Lock into version control.
- `skills/post-deploy.md` — step 5. Confirm live site.
- `skills/feature-plan.md` — pre-audit research for new features.
- `skills/schema-sync.md` — mandatory before any column change.
- `skills/rpc-security-sweep.md` — mandatory gate before RPC commits.
- `skills/post-incident.md` — documentation after every bug fix.

---

## HARD RULES

1. SQL changes happen in Supabase SQL editor first.
   Never via Claude Code.
2. No direct table writes from the client. Ever.
3. No console.log. Use console.error.
4. No hardcoded colours except #60A0FF and #FF6060.
5. App.jsx state wrappers are pure setters. No DB calls inside.
6. Demo team is not a valid test target for auth or RLS flows.
   Real teams created by a freshly-signed-in user are the only valid
   test bed for any auth.uid()-dependent path.
7. After any RPC signature change, grep every call site before
   declaring done. Extends to RPC return-shape changes: when adding
   or removing fields from a returned JSON object, grep every consumer
   of that field in JS and SQL.
8. BUGS.md, FEATURES.md, and DECISIONS.md must be updated when
   bugs are resolved, features ship, or architecture decisions are made.
9. Every fire-and-forget RPC MUST INSERT into audit_events on the
   server side. Silent client-side failures must leave a server-side
   trace. Pattern established in migration 060
   (set_player_status, set_player_paid) and extended in 063
   (set_player_injured, add_guest_player, remove_guest_player,
   register_push_subscription, unregister_push_subscription,
   submit_potm_vote, link_player_to_user). Any new player-self
   write RPC must follow this pattern.
10. Server-side realtime publishers MUST have matching client
    subscribers. When a new RPC calls notify_team_change or
    realtime.send, verify the corresponding supabase.channel()
    subscriber in App.jsx matches: topic, event name, and private
    flag. Verified in this commit by migrations 062 + App.jsx
    broadcast subscriber.
11. Migration source files MUST land in the same commit as the live
    DB apply. Don't let live DB and source code drift. If applied
    via mcp__supabase__apply_migration, write the .sql file (and
    matching _down.sql) before moving on to the next change.
12. RPC return-shape additions require a same-commit mapper update.
    When a new field is added to a SECURITY DEFINER RPC's return
    shape and any JS consumer reads it, the corresponding mapper in
    `packages/core/storage/supabase.js` (`dbToPlayer`, `dbToTeam`,
    inline shapes in `getTeamStateBy*`) must add the field in the
    same commit. Grep the new field name to confirm it appears in
    BOTH the RPC body AND the mapper. Established session 43 after
    the migration-070 `is_self` latent bug — the flag was added to
    the RPC but `dbToPlayer` never picked it up, so App.jsx's
    `squad.find(p => p.is_self)` always returned undefined and the
    admin-resolver fell through to `squad[0]`. Admins on /admin/
    routes were rendered AS the first squad member for ~12 days
    before anyone noticed.
13. PWA-affecting changes MUST be tested on a real iPhone home-
    screen install before commit. Files in scope: App.jsx
    (routing/auth/realtime/manifest), PlayerView, MySquads,
    AuthGateModal, useRequireAuth, supabase.js client config,
    api/manifest.js, index.html inline script. The build hook,
    type-check, and grep cannot see "tap does nothing"-class bugs.
    Use a Vercel preview branch → install via Safari → Add to Home
    Screen → force-quit Safari → open from icon. Established
    session 43 after three behaviour-only bugs surfaced only via
    real-device test (wrong-row gate logic, OTP code length cap,
    and the latent mig-070 bug above).

---

## HOOKS — DETERMINISTIC ENFORCEMENT

Three Claude Code hooks live in `.claude/` and fire automatically
on every Claude session in this workspace. They turn the rules
above from advisory (~80% adherence) into deterministic (100%).

Open VS Code with `/Users/tarny/platform` as the workspace root
(not the home directory) — hooks only load from the workspace's
own `.claude/settings.json`.

**1. SessionStart primer — `.claude/hooks/session-start.sh`**
At the start of every new chat, injects branch name, working tree
state, last 5 commits, and the BUGS.md head into the assistant's
context. Replaces the soft "read CONTEXT.md first" expectation
with deterministic injection. No way to skip it.

**2. PostToolUse hygiene — `.claude/hooks/post-edit-hygiene.sh`**
After every Edit/Write/MultiEdit on `.js`/`.jsx`/`.ts`/`.tsx`
files under `apps/inorout/src/` or `packages/core/`, runs
`skills/scripts/check-hygiene.sh <file>` and blocks (exit 2)
on any of its 7 failures: console.log, hardcoded hex outside
#60A0FF/#FF6060, non-thin Phosphor weight, MOTM/Man-of-the-Match
display text, direct supabase.from() outside supabase.js, raw
supabase.rpc() outside supabase.js, async state setters in App.jsx.

Out-of-scope files (root MDs, configs, migrations) exit 0 silently.

**3. PreToolUse build gate — `.claude/hooks/pre-commit-build.sh`**
Before any Bash command matching `git ... commit ...` (any flags
between, e.g. `git -C /path commit -m`), runs
`skills/scripts/check-build.sh` and blocks the commit if the build
fails. Adds ~4s to incremental commits, ~20s to cold ones. This
is the cost of "never commit without a passing build" being
literal rather than aspirational.

**Override discipline**
Hooks block; they don't ask. If a hook is wrong (false positive,
intentional exception not yet codified), fix the hook script in a
dedicated commit — don't disable hooks to push through a change.
Per-user overrides live in `.claude/settings.local.json` (gitignored).

**When hooks evolve**
- Adding a new check to `skills/scripts/check-hygiene.sh` makes
  it fire automatically — no hook change needed.
- New event types (e.g. blocking PR merge, schema-sync gate) go
  in `.claude/hooks/` with a matching entry in `settings.json`.
- Smoke-test new hooks against realistic command shapes before
  committing (see commit `c65b61c` for what a regex miss costs).
