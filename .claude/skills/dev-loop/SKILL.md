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
7. **Ship-safety / blast-radius** — `bash skills/scripts/check-live-config.sh`.
   Classifies the diff against live/irreversible surfaces. **PROTECTED** (exit 1)
   means the change can reach the live casual team or the iOS binary currently in
   Apple review: treat it as tier-3, carry the matching proof (real-device walk /
   casual-regression / ephemeral-verify), and HARD-STOP at the merge gate with an
   explicit ship-safety verdict. **CLEAR** (exit 0) = no protected surface touched.

### 6 — REVIEW (independent, fresh context) · L4
**This stage is the real safety net — not the human merge tap.** The operator
approves merges without re-deriving the diff, so correctness has to be *proven here*,
by reviewers the worker can't influence. Spawn them as **fresh-context sub-agents**
that see **only the diff + the criteria** (not the build-up — this also keeps the main
loop's context small, L8). Reviewers over-report — scope them to **real** correctness /
requirement / security gaps, not style. They are MANDATORY; never skip them, never let
the writer grade its own work.
- **QA reviewer** — does the diff meet the stated requirement and is it correct?
- **Security reviewer** — given Stripe / auth / RLS / RPC are in scope and there is
  no type/test net, this is the most important grader. If any RPC was added/changed,
  the security reviewer **runs `bash skills/scripts/check-rpc-security.sh <rpc>`**
  (security + search_path + overloads) and treats its output as evidence, plus checks
  RLS exposure, `auth.uid()` trust, money/secret handling.
- **Adversarial verify (tier-2/3 only)** — for any change flagged PROTECTED by
  step-7 ship-safety, spawn a third reviewer whose sole job is to **refute** that the
  change is safe to ship to the live team / Apple bundle. Default to "unsafe" on doubt.
  If it can't be refuted, that's the evidence; if it can, back to step 5.

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
**Never auto-merge.** Report the PR and wait for a human to merge — but because
**merging `main` is a live production deploy** (apps/inorout → `platform-clubmanager`
→ `app.in-or-out.com` = the running casual team's app AND the web bundle inside the
iOS binary in Apple review), the operator merges on trust. So you MUST hand them a
one-line **ship-safety verdict**, never a bare "ready":
- **DARK-IN-PROD — safe to merge now.** check-live-config CLEAR, OR the change is
  flag-gated OFF in prod (e.g. `VITE_GAFFER_ENABLED` unset) / dead code / dev-tooling
  (`.claude/`, `skills/`, `docs/`) not in the app bundle. Say *why* it's dark.
- **SHIPS-LIVE — hold / proof required.** check-live-config PROTECTED. Name the
  surface, the proof carried, and whether it's safe given the **Apple-review freeze**
  below. Do not say "ready" without this.

**APPLE-REVIEW FREEZE (while a build is in review):** auth / session-storage / PWA /
manifest / service-worker / native-wrapper changes are **frozen** — draft + prove, but
**do not recommend merge**; stop needs-human and say "frozen pending Apple decision."
This is the surface that caused rejections #1 and #2.

---

## OPERATING POSTURE — autonomy + efficiency

**Where trust lives.** The operator can't technically vet diffs and rubber-stamps
merges. Trust therefore lives in the **tooling, not the gate**: the deterministic
checks (build / hygiene / rpc-security / live-config), the mandatory fresh-context
QA+Security review, casual-regression, and ephemeral-verify. Make those rigorous and
the loop can run hands-off up to the merge tap. The gate stays human only because
merge = prod deploy — not because the human adds verification.

**Toward unmanned (what stays gated, always):** applying a migration, changing RLS,
touching money/auth, flipping a prod env/flag, deploying, or merging anything
check-live-config flags PROTECTED. These are drafted + proven but never executed by
the loop. Everything else — audit, build, prove, review, PR — is autonomous.

**Token efficiency (minimise spend per cycle):**
- **Verify-first, build-second.** Before writing anything, grep / check whether it
  already exists (migrations, RPCs, components). The Gaffer run skipped two whole
  phases this way. Cheapest possible avoided work.
- **Deterministic before LLM (L2).** Run the `check-*.sh` scripts first; only spawn
  LLM reviewers on what survives. Don't pay for a judge where a grep settles it.
- **Scoped sub-agents with clean windows (L8).** Run audit and review as sub-agents
  fed only the files/diff they need — keep the main loop context lean; don't carry the
  whole conversation into every step.
- **Cache state in the manifest, don't re-derive.** Write audit findings + status into
  the manifest once; a resumed cycle reads them instead of re-auditing. Read only the
  ranges you need; never re-read a file already in context.
- **One increment per cycle (L6).** Don't re-explore settled context or bundle phases.

---

## MERGE-JUDGE + BATCH-MERGE (opt-in, off by default)

Default stays **per-phase + human tap** (step 9). An epic can opt in via its manifest
header: `Merge mode: per-phase | auto | queue`.

**Merge-judge** — a verdict synthesised from signals already produced, not a new review:
`CI(own-app deploy) green` + `QA reviewer clean` + `Security reviewer clean` +
`check-live-config` + the phase's tier tag → one of:
- **AUTO-MERGEABLE** — only when `check-live-config = CLEAR` (tier-1: UI / copy / pure
  helpers / flag-gated-dark / dev-tooling) AND both reviewers clean AND CI green. Under
  `Merge mode: auto` the loop merges it; otherwise it's a one-tap recommendation.
- **INTENT-QUESTION** — tier-3 / PROTECTED. **Never blind auto-merge.** Keep the human
  in the loop ONLY where their judgment is real — *intent*, not code. Emit a
  plain-English question they can actually answer, e.g. *"This lets agency staff read
  tenant X's financial data — intended? y/n"* — not "review this diff." Plus require:
  the adversarial security pass (step 6) AND the matching contract test
  (rpc-security / ephemeral-verify / RLS read-scoping) **exists and passes**.
- **FROZEN** — auth / PWA / native during an active Apple review (step 9 freeze).
  Drafted + proven, never recommended for merge until the review clears.

**Batch-merge (`Merge mode: queue`)** — for working ahead, hands-off, until the
operator returns and says "merge all":
- Dependent phases **stack**: each phase branches off the previous phase's branch (PR
  targets that branch), so the loop builds P1→P2→P3 without waiting for merges.
- The loop keeps going until a phase genuinely needs a *merged* predecessor — a
  migration **apply**, an env flip, or a deploy. Those are tier-3 anyway → it stops
  there with the intent-question queued.
- On **"merge all"**: run merge-judge per queued PR **bottom-up**; auto-merge the
  green AUTO-MERGEABLE ones, present the batched INTENT-QUESTIONS together (you answer
  a handful of y/n intents), hold anything FROZEN. One sitting, minimal human surface.
- Caveat surfaced every time (no silent caps): a queued stack means later phases were
  proven against *branch state*, not against `main` — note which phases still owe a
  post-merge re-smoke.

Enabling `auto`/`queue` is an **explicit per-epic operator decision** — never the
default, never inferred. Tier-3 stays human-on-intent under every mode.

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
