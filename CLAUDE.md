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

## MONOREPO STRUCTURE

**Apps** (8 Vite + React applications, all depend on `@platform/core` and `@platform/ui`):
- `apps/inorout` — player availability, squad management, POTM, casual match flow (main consumer app)
- `apps/venue` — venue operator dashboard, staff, bookings, leagues
- `apps/display` — reception display, rotating ads, live match info (port 5181)
- `apps/hq` — HQ intelligence / operator analytics (port 5177)
- `apps/clubmanager` — club OS: memberships, tournaments, Event OS brackets
- `apps/ref` — referee interface
- `apps/league` — league management
- `apps/superadmin` — platform-level analytics and ops

**Packages:**
- `packages/core` (`@platform/core`) — ALL Supabase calls for every app live here. The single source of truth for data access: `storage/supabase.js` (194KB) exports every DB wrapper. Never call `supabase.rpc()` or `supabase.from()` outside this file.
- `packages/ui` (`@platform/ui`) — shared React component library

**Tooling:** Turbo monorepo (`turbo.json`), npm workspaces, Vercel deployments per app.

---

## COMMANDS

```bash
# Build a specific app (most common — required after every execute step)
cd apps/inorout && npm run build
cd apps/venue && npm run build
cd apps/clubmanager && npm run build
# For UNATTENDED / allowlisted runs, use the cd-free forms (a compound `cd <dir> && …`
# trips a permission prompt in the agent/IDE harness even when allowlisted):
npm run build --prefix apps/inorout      # cd-free single-app build
bash skills/scripts/check-build.sh       # the build gate (cd's inside the script)

# Dev server for a specific app
cd apps/inorout && npm run dev
cd apps/display && npm run dev    # port 5181
cd apps/hq && npm run dev         # port 5177

# Build all apps via Turbo (from monorepo root)
npm run build

# Reinstall after dependency changes
npm install && cd apps/inorout && npm run build

# Deterministic check scripts (always call these, never reinvent them inline)
bash skills/scripts/check-build.sh
bash skills/scripts/check-hygiene.sh <file>
bash skills/scripts/check-rpc-security.sh <rpc_name>
bash skills/scripts/check-rpc-columns.sh <rpc_name>
bash skills/scripts/check-db-schema.sh <table_name>
bash skills/scripts/check-schema-column.sh <table> <col>
bash skills/scripts/check-references.sh "<term>" [--removed|--rpc]
bash skills/scripts/check-workspace-deps.sh
```

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
  skills/casual-regression.md — MANDATORY for any Phase 5+ cycle that touches
                                  apps/inorout/src/ or packages/core/. Gates
                                  the casual flow against unintended changes.
  skills/ephemeral-verify.md  — MANDATORY for any cycle that adds or modifies
                                  a write RPC. End-to-end DO-block proof
                                  against the live DB with auto-rollback.
  skills/post-incident.md     — run after every bug fix is committed.
                                 Proposes BUGS.md, DECISIONS.md, CONTEXT.md updates.

- Never edit during audit
- Never skip verify
- Never commit without a passing build
- Never rename or drop a column without running schema-sync.md first
- Never commit an RPC change without running rpc-security-sweep.md first
- Never commit a Phase 5+ cycle touching apps/inorout without running casual-regression.md first
- Never commit a new write RPC without running ephemeral-verify.md first
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
- `STRATEGY.md` — commercial strategy, pilot venue plan, go-to-market
  sequencing. Read before any pilot, pricing, or sales-facing work.

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
- `STRATEGY.md` — commercial strategy, pilot plan, go-to-market sequencing.
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
- `skills/casual-regression.md` — mandatory for Phase 5+ cycles touching apps/inorout. Proves casual flow unchanged.
- `skills/ephemeral-verify.md` — mandatory for any new write RPC. Live-DB end-to-end proof with auto-rollback.
- `skills/post-incident.md` — documentation after every bug fix.
- `.claude/skills/dev-loop/SKILL.md` — guardrailed, self-correcting dev loop. `/dev-loop <change>` for one change; `/loop /dev-loop <manifest>` for an epic. Wraps AUDIT→EXECUTE→VERIFY→COMMIT with a fail-fast proof gate (node --check → check-hygiene → rpc/schema gates + ephemeral-verify → check-build → Playwright end-to-end smoke = the real correctness signal; Vercel preview = build/deploy only) + ship-safety classification (`skills/scripts/check-live-config.sh`) and a fresh-context QA+Security review (security reviewer runs check-rpc-security). PR-only; never pushes main (enforced by `.claude/hooks/pre-push-guard.sh`); never blind auto-merges (merge=live prod deploy; tier-3 = human-on-intent); App-Store binary freeze on auth/native during Apple review. Opt-in `Merge mode: auto|queue`. Delegates to the skills above, never restates them.
- `.claude/skills/backlog/SKILL.md` — on-demand backlog picker. `/backlog` surveys what's done/scoped/next (`skills/scripts/survey-backlog.sh` + MEMORY recall + verify-first reconciliation), ranks a shortlist with tier + ship-safety tags (biases to dark-in-prod work during the Apple freeze), asks which to start, then launches it UNMANNED via dev-loop. Runs the work hands-off to PRs; surfaces only batched intent/merge decisions.
- `.claude/skills/qa-loop/SKILL.md` — closed test → triage → auto-fix → re-test QA loop. `/qa-loop` runs the deterministic regression net (node --check + check-hygiene + check-build + `skills/scripts/qa-suite.sh` = cold, flake-aware, server-aware e2e), triages findings T1/T2/T3, batches the CLEAR T1+T2 (one objectively-correct fix, `check-live-config` CLEAR) into ONE dev-loop pass, re-tests, then surfaces T3 (tier-3/PROTECTED draft-only + product decisions) in plain English. Still-open + T3 land in BUGS.md / GO_LIVE_ISSUES.md (no parallel report system). Scopes: `full` = +supervised Playwright-MCP browser walk (console + a11y, read-only, never prod/unattended); `scripted` = deterministic lane only (the only scope fit for `/loop`/scheduled, hits live demo DB); free text narrows tests+walk+fixes to one area. Thin orchestrator over dev-loop — inherits its guardrails, adds no merge power.

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
13. Native-app-affecting changes MUST be tested on a real iPhone
    in the actual native app before commit. In or Out is NATIVE-APP-
    ONLY now — there is no PWA / "Add to Home Screen" install path.
    Files in scope: App.jsx (routing/auth/realtime), PlayerView,
    MySquads, AuthGateModal, useRequireAuth, supabase.js client
    config, capacitor.config.ts. The build hook, type-check, and
    grep cannot see "tap does nothing"-class bugs. Test by opening
    the change in the native app (via a preview build / the live
    web-bundle) and walking the affected flow on-device. Established
    session 43 after three behaviour-only bugs surfaced only via
    real-device test (wrong-row gate logic, OTP code length cap,
    and the latent mig-070 bug above). NOTE: the legacy PWA-manifest
    plumbing (api/manifest.js, the index.html inline manifest script,
    the SquadReady manifest swap) still physically exists but its
    install path is dead — see the native-app-only reference memory;
    removing it is a separate, deliberate cleanup.
14. New RPCs designed for multiple downstream apps MUST record their
    consumers in RPCS.md's Notes column. Extends hard-rule #12 forward:
    if Cycle 5.4's `get_player_fixture_detail` is designed for the
    Phase 4 reception display + Phase 7 AI briefings, that's recorded
    NOW so a later return-shape change doesn't silently break Phase 4
    when it's built. Established Phase 5 plan, applies to any RPC
    explicitly designed for a yet-unbuilt consumer.
15. Ephemeral-verify NEVER touches existing rows — not production,
    not the demo seed (demo_venue, team_demo, company_demo, dc_* etc).
    It seeds its OWN throwaway fixture with `_e2e_`-prefixed ids + its
    own admin token, runs the RPC flow against THAT, and ends with
    `RAISE EXCEPTION 'ROLLBACK_TESTS_PASSED :: ' || v_summary` to roll
    back AND carry the verdict out in the error message. BANNED, no
    exceptions: capturing an EV verdict via a committed temp table or
    committed rows; calling write RPCs against demo/prod ids "just to
    test"; any EV path that can COMMIT. After every EV run the
    leak-check (count of `_e2e_%` rows = 0) is mandatory — non-zero
    means the rollback failed; STOP and restore. Established session 63
    after an EV result-capture variant committed against demo_venue and
    mutated the seed (restored same cycle). skills/ephemeral-verify.md
    holds the ONLY sanctioned template.

---

## CLOUD SESSION DISCIPLINE

Cloud sessions (run from the phone, away from the laptop) are
encouraged. They carry one failure mode the desktop flow does not:
two sessions branched off the same `main`, editing the same files,
blind to each other. Whichever merges first wins; the second
conflicts. Established session 70 — two same-day sessions (BST cron
fix + guest-row fix) both appended to BUGS.md and RPCS.md and both
numbered their migration `207`; the second PR landed `dirty` and had
to be hand-resolved.

Rules:

1. **One session at a time, closed start-to-finish.** Kick off a
   session, let it run fix → verify → **merge its PR** → confirm
   merged, BEFORE starting the next. The conflict only exists when
   two PRs are open against the same base at once. This is the single
   highest-leverage habit and costs nothing — it's just sequencing.

2. **Merge the PR the moment a session says "ready."** Don't leave a
   finished fix sitting as an open PR. The danger window is
   "fix done, PR not merged."

3. **"DB fix is already live, PR is source-sync only" still merges
   promptly.** That exact phrasing is the trap: the live DB runs ahead
   of committed source until the PR lands — the drift Hard Rule #11
   forbids. A working fix whose source isn't on `main` is not done.

4. **If two MUST run in parallel, keep them in different files.**
   Conflicts only happen on shared files — and almost every fix
   appends to the shared docs (BUGS.md, RPCS.md, CONTEXT.md,
   DECISIONS.md, GO_LIVE_ISSUES.md) and grabs the next migration
   number. Two sessions on genuinely separate app areas merge clean;
   two that both touch the docs or both add a migration will collide.

5. **Migration numbers are first-come on `main`.** A cloud session
   picks the next number off the base it branched from. If another
   session merged a migration meanwhile, the numbers clash (two
   `207_*` files). Harmless on the live DB — applied by timestamp —
   but it breaks the "numbered chronologically" convention. Sequencing
   (rule 1) is the only real fix; if a clash already exists, leave the
   live DB alone and just note it.

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
