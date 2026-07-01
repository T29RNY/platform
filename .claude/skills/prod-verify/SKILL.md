---
name: prod-verify
description: Targeted post-deploy verification of the LIVE site after a dev-loop PR merges and Vercel deploys. Confirms the merge is actually live, derives which surfaces to walk from the merged diff (tests what changed, not everything), runs a SUPERVISED Playwright-MCP walk of live prod DEMO surfaces only, then classifies each failure T1 (live functional defect → open a /dev-loop fix phase) or T3 (design/gate decision → surface to the operator). Use when the operator says "prod-verify", "post-deploy check", "verify the deploy", "did it work in prod", or right after merging a dev-loop PR. Also invokable manually with an explicit app/surface list (`/prod-verify apps/venue bookings`). Read-only — never edits, never merges, never runs unattended against prod.
---

# prod-verify — targeted post-deploy verification of the live site

The formal **Step 5 (POST-DEPLOY)** of AUDIT→EXECUTE→VERIFY→COMMIT→POST-DEPLOY, made
invocable. Where `qa-loop` tests the **branch before merge**, `prod-verify` tests **live
prod after merge** — the two halves of the same discipline. It is a **thin
orchestrator**: it reuses `skills/post-deploy.md`'s live checks, `babysit-prs`'s
file→app map, `qa-loop`'s Playwright-MCP walk + triage pattern (and `DEMO_USERS.md`),
and hands any real defect to **`dev-loop`**. It adds **no** new services, tables, report
systems, or merge power. Read `.claude/skills/dev-loop/SKILL.md` — prod-verify inherits
its guardrails and never invents a second path.

## THE ONE HARD BOUNDARY — live prod, demo-only, supervised

Every sibling skill forbids hands-on walks against production. prod-verify's whole job
is to walk production, so it lives inside `post-deploy.md`'s **narrow, already-sanctioned
exception** and nowhere wider:

- **Live prod URLs, but DEMO surfaces only** — the demo player token
  (`in-or-out.com/p/p_demotoken_01`) + demo admin (`in-or-out.com/demoadmin`), and the
  equivalent demo surface for other apps. This is a "did the bundle deploy and render
  end-to-end" smoke, **not** an auth/RLS correctness proof (Hard Rule 6 — demo is
  invalid for *proving* auth/RLS, but safe and valid for a prod render smoke).
- **NEVER a real team.** No `team_finbars`, no real user data, no writes to anyone's
  live squad.
- **Read-mostly.** Navigate and observe; do not perform destructive or state-mutating
  actions against prod. The demo token is single-use/rotating — treat the walk as a
  render + console + network smoke, not a write test.
- **Supervised, NEVER scheduled-unattended.** prod-verify runs because the operator is
  present — they just tapped merge at the dev-loop merge gate. It is **not** a `/loop`
  or cron target. (An unattended prod-facing walk is exactly what qa-loop/dev-loop
  forbid.)
- **Read-only skill.** prod-verify NEVER edits code, NEVER merges, NEVER applies a
  migration. Its only "action" on a defect is to *launch* a `/dev-loop` fix (which
  re-enters every guardrail). It is as hands-off as `babysit-prs`.

If a step would breach any of the above, STOP and surface it — do not "just check the
real team" or "just schedule it nightly".

---

## THE LOOP

### 0 — SCOPE (what merged, and what does it touch?)
Establish the subject of this verification:

- **`/prod-verify`** (no arg) — the most-recently-merged PR to `main`. Find it with a
  read-only `gh pr list --state merged --limit 1 --json number,title,mergedAt,headRefName`.
- **`/prod-verify <PR#>`** — that specific merged PR.
- **`/prod-verify <app/area>`** (e.g. `apps/venue bookings`) — an explicit manual
  surface list; no merged PR needs to be in scope. Skip STEP 1's diff-derivation and
  walk exactly the named surfaces.

For a PR-scoped run, read its diff read-only (`gh pr diff <n>` / `gh pr view <n>
--json files`) — the changed file list drives STEP 1.

### 1 — DERIVE THE SURFACES FROM THE DIFF (test what changed, not everything)
Map the merged diff's changed files → app(s) → the specific live routes to walk, using
the **same file→app map `babysit-prs` uses**:

- `apps/inorout/*` → **platform-clubmanager** → `in-or-out.com` (demo player `/p/p_demotoken_01`
  + demo admin `/demoadmin`; walk the changed casual flow + its adjacent screens).
- `apps/venue/*` → **platform-venue** · `apps/ref/*` → **platform-ref** ·
  `apps/display/*` → display · `apps/hq/*` → hq · `apps/clubmanager`/`league`/`superadmin`
  → their own deploys.
- `packages/core/*` or `packages/ui/*` → touches **every** app that imports it — widen
  the walk to the consuming app(s) the change actually reaches (grep the changed export
  if unsure), not all eight blindly.
- **Docs/config-only** diff (`.claude/` / `docs/` / `skills/` / `*.md`, no app/package/
  build-input file) → **deploys nothing**. Report **"nothing to walk — no app deployed"**
  and exit clean (mirrors babysit-prs's N/A rule). Don't invent a walk.

Narrow the walk to the changed flow + one screen either side of it (post-deploy.md
STEP 2's "adjacent flows"), not a full regression of the app.

### 2 — CONFIRM DEPLOY-LIVE (never walk a stale bundle · post-deploy.md STEP 1)
Before touching a URL, confirm the merged commit is actually serving:

- Read the own-app deploy status via `gh pr checks <n>` / the merge-commit Vercel
  deployment. Confirm **Ready**, not Building/Error.
- **Exclude the known false alarm:** `platform-ref` "fails" on every PR — ignore it
  unless the PR touched `apps/ref`.
- Account for the deploy-lag caveat (MEMORY: in-or-out.com auto-deploys the monorepo;
  Vercel MCP status can read stale; updates fully land on close+reopen). If still
  building → **wait**, re-check; never walk a stale bundle and report a false green.
- If nothing deployed (docs-only from STEP 1) → skip straight to the clean report.

### 3 — WALK THE LIVE SURFACE (supervised Playwright-MCP, demo-only)
Drive the live demo surfaces with the Playwright **MCP** tools (`browser_navigate`,
`browser_snapshot`, `browser_click`, `browser_console_messages`, `browser_network_requests`).
For each derived surface, confirm:

- Page loads — **no white screen, no JS exception** (`browser_console_messages` — capture
  errors *and* warnings as findings).
- The **changed flow renders and works end-to-end** as a user would do it.
- **No 401/403/404/500** in the network tab (`browser_network_requests`).
- **Adjacent flows** (one screen either side of the change) still load.
- Use `127.0.0.1`-equivalent reasoning only where true-unauth matters (localhost-admin-
  backdoor note) — but this is prod, so walk as the demo player / demo admin per
  `DEMO_USERS.md`.

Capture screenshots where useful. Report exactly what was observed — never mark PASS
without evidence.

**If Playwright MCP is unavailable:** state "Playwright MCP not available — manual check
required", give the exact URLs + what to look for, and do **not** mark PASS. The operator
confirms manually (post-deploy.md fallback).

### 4 — LIVE-DB CHECKS (only if the diff touched an RPC or schema · post-deploy.md STEP 3)
For a diff that changed an RPC or DB schema, add read-only live-DB confirmation:

- `bash skills/scripts/check-rpc-security.sh <rpc>` → run the generated SQL via Supabase
  MCP **read** — confirm `security_definer = true`, `overload_count = 1`, correct grants.
- `bash skills/scripts/check-db-schema.sh <table>` → confirm every column the change
  reads/writes exists with the right type.
- Spot-check the happy path with a **read-only** `execute_sql` SELECT — confirm the shape.
  (Read-only Supabase MCP is allowlisted; do **not** use demo data to *prove* auth/RLS.)
- **Schema-cache staleness** (404 on an RPC that exists): the fix is
  `SELECT pg_notify('pgrst','reload schema');` — but that is a live-DB **write** via
  `execute_sql`, deliberately un-allowlisted. **Recommend it to the operator with the
  one-line command; do not run it yourself.** (This is a T3 gated action.)

### 5 — TRIAGE EACH FINDING — T1 or T3
Two buckets (deliberately not qa-loop's three — a defect that reached **prod** always
warrants a real fix cycle, so there is no in-place "T2 auto-polish" here):

- **T1 — LIVE FUNCTIONAL DEFECT.** Page errors/crashes, broken flow/route, a control
  doing the wrong thing, console error on load, a 4xx/5xx the change caused, an a11y
  failure. → **Open a `/dev-loop` defect-fix phase** (`/dev-loop <the defect + its
  done-check>`). prod-verify does **not** fix it in place — the fix branches, proves,
  reviews, PRs, merges, re-deploys, and is then re-verified by another `/prod-verify`
  (closed loop). Before proposing the fix, sanity-check it isn't itself tier-3; if it
  is, it's still a `/dev-loop` change but flag the gate.
- **T3 — DESIGN / GATE / TIER-3 DECISION.** A product/design call (not one right
  answer), OR anything that needs a gated action (the schema-cache flush, a migration
  re-apply, an env flip). → **Surface to the operator in plain English** — the choice +
  your recommendation first, or the one-line gated command for them to run. **Never
  auto-act.**

If a finding is pre-existing (not caused by this deploy — reproduce on an unrelated
surface to check), note it as pre-existing, don't attribute it to the PR.

### 6 — REPORT + LEDGER
Print a plain-English digest (post-deploy.md output format, operator preference):

```
PROD-VERIFY [PR #n / area] — [date]

DEPLOY:   commit <hash> · Vercel <Ready/Building/Error> · [platform-ref excluded]
SURFACES: [derived from diff] — [app → routes walked, or "nothing to walk"]
WALK:     [per surface] PASS / FAIL / MANUAL-REQUIRED  + observations
DB:       RPC-security / schema / happy-path  PASS / FAIL / N/A
FINDINGS: [n] — T1: [n] (→ dev-loop) · T3: [n] (→ operator)
VERDICT:  CLEAN  /  DEFECTS FOUND
```

Reuse the repo's existing ledgers — **do not spawn a parallel report system**:
- Still-open + T3 items → `BUGS.md`.
- Production-class issues → `GO_LIVE_ISSUES.md` (repo hard rule — any new production bug
  is appended here in the same commit as its fix).

### 7 — CLOSE
- **CLEAN** → "Cycle closed — [PR #n] verified live." Done.
- **T1 defects** → launch/queue the `/dev-loop` fix(es); the cycle reopens on the next
  deploy.
- **T3** → the operator's call; prod-verify's job ends at the surfaced question.

---

## INVOCATION
- **`/prod-verify`** — verify the most-recently-merged PR (auto-derive surfaces).
- **`/prod-verify <PR#>`** — verify a specific merged PR.
- **`/prod-verify <app/area>`** — explicit manual surface list (no PR in scope).
- Free text narrows the walk to that area.

Runs right after the dev-loop **merge gate** — it is the formal POST-DEPLOY action.

## GUARDRAILS (never relaxed — inherited from dev-loop / post-deploy.md)
- **Live prod = demo surfaces only, read-mostly, supervised, never a real team, never
  scheduled-unattended.** The one hard boundary above.
- **Read-only skill** — never edits, never merges, never applies a migration; a defect
  becomes a `/dev-loop` fix, never an in-place patch.
- **Gated actions stay gated** — schema-cache flush / migration re-apply / env flip are
  recommended for the operator to run, never executed here (they're live-DB writes /
  irreversible).
- **No fake greens** — PASS only with evidence; MANUAL-REQUIRED beats an unverified PASS.
- **Thin orchestrator** — reuse post-deploy.md / babysit-prs / qa-loop / dev-loop +
  BUGS.md / GO_LIVE_ISSUES.md; add no parallel systems.
- **This project only** — never point the walk at another repo/env.
