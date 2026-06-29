---
name: dev-loop
description: Guardrailed, self-correcting dev loop for this monorepo. Use for a single change (/dev-loop <describe the change>) or, wrapped in /loop, to run an epic from a phase manifest (/loop /dev-loop <path-to-manifest>). Runs AUDIT -> PLAN GATE -> BRANCH -> EXECUTE -> PROOF GATE -> REVIEW -> SMOKE -> PR -> watch CI, correcting until green within a bounded budget and stopping at every human/tier-3 gate. PR-only; never pushes to main; never auto-merges; never applies a migration or touches RLS/money/auth without explicit sign-off.
---

# dev-loop

A loop that builds one change correctly and proves it, hands-off, then stops at the
human gates. Read `loop-principles.md` (in this folder) first — this file is one
concrete wiring of L1–L12 for **this** repo. It does not restate the methodology;
it delegates to the existing skills in the repo `skills/` folder
(`audit.md`, `execute.md`, `verify.md`, `commit.md`, `post-deploy.md`,
`rpc-security-sweep.md`, `schema-sync.md`, `ephemeral-verify.md`,
`casual-regression.md`).

## This repo's reality (why the proof gate looks the way it does)

- **No typecheck** — the apps are plain JavaScript (`.jsx` on Vite), not TypeScript.
  Cheapest syntax check = `node --check <file>`.
- **No unit-test runner** — there is no vitest/jest. The deterministic self-check
  layer is the `skills/scripts/check-*.sh` suite + the build + (for write RPCs)
  ephemeral-verify against the live DB with auto-rollback. Treat those AS the test
  suite.
- **The real correctness signal is end-to-end** (L5): does the change actually run
  as a user? So the proof gate runs a **Playwright browser smoke** and that is the
  load-bearing check. The **Vercel preview build is a deploy/build check only — NOT
  a correctness signal.** Green Vercel ≠ feature works.
- **There is no GitHub Actions CI.** "Watch CI" = watch the Vercel preview build via
  `gh pr checks <n> --watch`. It tells you the app compiles/deploys, nothing more.

---

## INNER LOOP — one change / one phase, always

### 1 — AUDIT (explore/plan, no edits) · L10
Read every file the change touches. Follow `skills/audit.md`. Report current state,
signatures, call sites, DB/RLS/RPC exposure, mismatches, risk flags. **No edits.**
For a new feature from the backlog, run `skills/feature-plan.md` first.

**Tooling hygiene (keeps the loop hands-off — learned the hard way):**
- **No multi-line inline `node -e` / `npx tsx -e` probes.** They cannot be
  allowlisted and always prompt, which breaks unattended runs. Put any check in a
  `skills/scripts/check-*.sh` script or a committed test file and call that instead.
  Single-file syntax checks via `node --check <file>` are fine.
- **Avoid env-prefixed or piped commands** (`VAR=x npm run build | tail`) — a leading
  `VAR=` assignment or a pipe makes the command miss the allowlist and prompt. Put env
  vars inside the script, and read the exit code with `echo "exit=$?"` on its own line
  rather than piping.
- Prefer the committed `cd <dir> && npm run build` shape (covered by the allowlist)
  over ad-hoc one-liners.

### 2 — PLAN GATE (human) · L9
Post the plan, then decide whether to wait — don't manufacture a checkpoint for a
one-liner:
- **Tier-2/3 (DB / RLS / money / auth / outward), OR any genuine trade-off, OR
  ambiguity → STOP and wait for human approval.** Always. No exceptions.
- **Tier-1 (frontend-only; no DB/RLS/money/auth/outward) with a single unambiguous
  fix → post the plan and PROCEED** without blocking.
- In epic mode the gate is batched once for the whole manifest
  (`Plan gate: batched`).

**Scope forks:** if options exist but one **strictly dominates** — same idiom, same
tier, same blast radius, no real downside — take it, say which and why, and proceed.
Only STOP when the choice is a *real* trade-off (wider blast radius, a product
decision, a perf/clarity tension). Never silently widen or narrow scope on a genuine
fork. (Calibrated after the ProfileSheet dup-key test over-asked "both vs club-only"
when "both" strictly dominated.)

Do not start EXECUTE until the above is satisfied.

### 3 — BRANCH · hard guardrail
Create a feature branch off `main` (`feat/...`, `fix/...`). **Never commit on main.
Never push to main. Never `git add -A`** — stage only the files this increment owns.

### 4 — EXECUTE (one increment) · L6
Make ONE agreed increment — code **and** its checks/tests in the same batch. One file
or one logical unit. Follow `skills/execute.md`. Do not bundle the next phase in.

### 5 — PROOF GATE (fail-fast, cheapest first; show evidence) · L1 L2 L3
Run in order, stop on first red, and **show the command + real exit code**, never
"it passes":

1. **Syntax** — `node --check <each changed .js/.jsx>` (instant).
2. **Hygiene** — `bash skills/scripts/check-hygiene.sh <each changed file>`
   (also hook-enforced on every edit).
3. **DB-surface gates (only if touched), in parallel:**
   - RPC added/changed → `bash skills/scripts/check-rpc-security.sh <rpc>` +
     `bash skills/scripts/check-rpc-columns.sh <rpc>`, then **ephemeral-verify**
     (`skills/ephemeral-verify.md`) — live-DB end-to-end proof with auto-rollback.
   - Column moved/renamed/dropped → `skills/schema-sync.md` +
     `bash skills/scripts/check-schema-column.sh <table> <col>`.
4. **Build / deploy check** — `bash skills/scripts/check-build.sh`
   (workspace-deps gate + Vite build of `apps/inorout`; for another app also
   `cd apps/<app> && npm run build`). This proves it **compiles/deploys** — it is
   NOT proof the feature works.
5. **End-to-end smoke (the real correctness gate) · L5** — drive the running app in
   a real browser with Playwright and confirm the change works as a user would do it
   (`npm run e2e`, config `e2e/playwright.config.mjs`, or a targeted browser walk of
   the touched screen). A shallow green build with a broken feature is the classic
   miss — this step is what catches it.
6. **Casual regression** — if the increment touched `apps/inorout/src/` or
   `packages/core/` at Phase 5+, run `skills/casual-regression.md`.

### 6 — REVIEW (independent, fresh context) · L4
Spawn fresh-context reviewers that see **only the diff + the criteria** (not the
build-up). Reviewers over-report — scope them to **real** correctness / requirement /
security gaps, not style.
- **QA reviewer** — does the diff meet the stated requirement and is it correct?
- **Security reviewer** — given Stripe / auth / RLS / RPC are in scope and there is
  no type/test net, this is the most important grader. If any RPC was added/changed,
  the security reviewer **runs `bash skills/scripts/check-rpc-security.sh <rpc>`**
  (security + search_path + overloads) and treats its output as evidence, plus checks
  RLS exposure, `auth.uid()` trust, money/secret handling.

### 5–6 — CORRECT-UNTIL-GREEN · L8
Never stop on the first red. Loop fix → re-prove → re-review. Budget **~4 passes**.
If still red after the budget, **reset rather than thrash**: stop, report the failing
evidence and the diff, and ask for direction. A polluted context is worse than a stop.

### 7 — SMOKE / SURFACE · L5
Confirm the whole thing runs end-to-end one more time at the surface (the question is
"can it actually run?", not "did the units pass?"). PWA-affecting changes (Hard Rule
13) owe a real-iPhone home-screen walk — flag it as a human-test checkpoint; the loop
cannot do it.

### 8 — PR + watch CI (background) · L9
Open a PR to `main` (`gh pr create`). Watch the Vercel preview builds in the
background (`gh pr checks <n> --watch`). CI here is **build/deploy only** — it does not
replace step 5's browser smoke.
- **A red check only sends you back to step 5 if it's *your* app's deploy.** Map the
  change to its app (e.g. `apps/inorout` → `platform-clubmanager`) and judge on that.
- **Known false alarm:** `platform-ref` fails on **every** PR (pre-existing, unrelated
  to any `apps/inorout` change). Do **not** treat it as red-for-this-PR, and do **not**
  loop back to step 5 over it — note it and move on. (Calibrated during the
  ProfileSheet dup-key test, where `platform-ref` was red but irrelevant.)

### 9 — MERGE GATE (human) · hard guardrail
**Never auto-merge.** Report the PR and the proof, and wait for a human to merge.

---

## OUTER LOOP — epic mode (optional)

Wrap the inner loop with `/loop` over a **phase manifest** (the externalised state —
L7). Draft manifests into `docs/epics/` (created on first epic) from
`phase-manifest.template.md`. Each fire:

1. Read the manifest. Pick the next `pending` phase whose `deps` are all `done`.
2. Run the INNER LOOP for that phase.
3. Write status back into the manifest (`in-progress` → `done` / `blocked: <why>` /
   `needs-human: <what>`) and append a one-line `Log` entry. Advance.

**Stop the outer loop (hand back to human) at any of:**
- a MERGE GATE (every phase ends at one),
- a **tier-3** touch (migration / RLS / money / outward) — draft it, but do not
  apply/merge,
- a human-test checkpoint (e.g. real-iPhone PWA walk),
- a genuine blocker,
- correction budget exhausted (reset-on-thrash),
- a real scope decision that wasn't settled at the plan gate.

---

## HARD GUARDRAILS (never relaxed)

PR-only; never push to main (enforced by `.claude/hooks/pre-push-guard.sh`, not just
the deny rule); never auto-merge; **never apply a migration / change RLS / touch money
logic without explicit human sign-off**; never touch another project (work only in
this working directory); never `git add -A`; never commit a broken build (enforced by
`.claude/hooks/pre-commit-build.sh`); no versioned credentials.

## TIER-3 SURFACES IN THIS REPO (draft, never auto-apply/merge)

- **Migrations** — `rls_migrations/NNN_*.sql` (+ matching `_down.sql`), applied in the
  Supabase SQL editor / `apply_migration`. Land source in the same commit as the apply
  (Hard Rule 11). Draft the SQL; **stop and get sign-off before applying.**
- **RLS / SECURITY DEFINER RPCs** — gated by `skills/rpc-security-sweep.md` +
  `skills/ephemeral-verify.md`.
- **Money** — Stripe (apps + `packages/core/storage/supabase.js`). See the
  `stripe-best-practices` skill.
- **Auth** — `auth.uid()`, player/admin tokens, cross-app SSO.
- **Outward** — Vercel deploy, App Store submit, real-device PWA. Deploy/apply
  commands are `ask`-gated in `settings.local.json`.

## Invocation

- Single change:  `/dev-loop <describe the change>`
- Start an epic:  draft a manifest into `docs/epics/` from the template, get the
  one-time plan-gate approval.
- Run an epic:    `/loop /dev-loop <path-to-manifest>`
