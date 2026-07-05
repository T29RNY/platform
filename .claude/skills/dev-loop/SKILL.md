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

**Base-state check (do this FIRST, before reading anything else).** If the task says
"build on PR #N" / "now merged" / "on top of <branch>", **verify that claim against the
remote** — `gh pr view <N> --json state,mergedAt` — don't trust the prompt's premise.
A brief written hours earlier may name a PR that's still *open*. If the named base is
**not** merged AND your change touches files it also touches, branching off plain `main`
will (a) miss the base's changes — failing any done-check that assumes them — and
(b) collide with the open PR on the shared files. The fix: **branch off the open PR's
head**, so your diff-vs-`main` carries the base + your work as one superseding PR, and
flag at the merge gate that it supersedes #N. (Calibrated after the unmanned-hardening
run, where the brief said "#161 merged" but it was open — same two files.)

**Tooling hygiene (keeps the loop hands-off — the single biggest cause of "the
unmanned loop keeps asking for approval"):** the permission allowlist matches *simple*
commands. Any command shape it can't cleanly match prompts the human — so every Bash
call MUST be ONE simple, allowlistable command. Concretely:
- **No `cd` in a compound command.** `cd <dir> && npm run build` trips a permission
  prompt in the agent/IDE harness *even when both halves are allowlisted* — the
  compound form can't be matched. Build with **`npm run build --prefix apps/<app>`**
  (no `cd`) or the build gate **`bash skills/scripts/check-build.sh`** (it `cd`s
  *inside* the script, so the outer call stays simple). Navigate with absolute paths,
  never a bare `cd`.
- **No multi-line / piped / redirected / process-substitution probes.** No inline
  `node -e` / `npx tsx -e`, no `sed … | diff <(…)`, no `VAR=x cmd | tail`, no
  `cmd 2>&1 | …`. Each of these misses the allowlist and prompts every time, which is
  what breaks an unattended run. **To compare two files, use the Read tool and reason
  over them directly — not `sed`/`diff`/`<()` in bash.** For any repeatable check, put
  it in a `skills/scripts/check-*.sh` script and call that one script. Read an exit
  code with `echo "exit=$?"` on its own line, never by piping.
- **One increment's checks = a short list of bare allowlisted commands**, each run on
  its own (`node --check <file>`; `bash skills/scripts/check-*.sh <args>`;
  `npm run build --prefix apps/<app>`). If you catch yourself writing a `&&`/`|`/`<()`
  chain to "save a round-trip", stop — that round-trip is cheaper than a human prompt.

**Allowlist preflight (front-load the prompts — do this BEFORE the first gate runs):**
at the start of an unattended run, list the gate commands this cycle will use
(syntax / hygiene / build / rpc-security / live-config / e2e) and confirm each is
**allowlist-safe** — one simple command, no compound `cd`, no pipe / redirect /
process-substitution / env-prefix. Anything that isn't safe gets reshaped (into a
`skills/scripts/check-*.sh` call or a `--prefix` form) up front. The point is to catch
a prompt-triggering command *before* you fire it mid-run, where it stalls the whole
unattended loop waiting on a human — not after.

**Where gate commands live.** The read-only gate suite belongs in the **committed**
`.claude/settings.json` allow-list (the `check-*.sh` set + `npm run build --prefix *`,
added in #161) so every session — desktop or cloud — inherits the same allowlist and
runs hands-off. Per-user, machine-specific entries go in the gitignored
`settings.local.json`, never the committed file. When you notice a stale one-off entry
in `settings.json` (a hardcoded single-file path that a wildcard now covers), prune it
in a dedicated dev-tooling commit — keep the committed allowlist a clean, general gate
suite, not an accretion of one-shots.

### 1b — DIAGNOSE (bug cycles only) · reproduce-before-fix · hard gate
**Only when the cycle is a BUG FIX** (a defect to correct), not a feature/tooling
build. For a bug, EXECUTE is **blocked until a reproduction pins the cause** — the
reproduction IS the proof of cause; a fix without one is a guess. This is the gate that
would have saved the all-day one-line HealthKit hang, where **four** prior "fixes"
each shipped with a confident-but-wrong root cause and **none reproduced** (PR #278).

Before any edit, produce and report:
- **A reproduction of the failure in the smallest runnable case** — drive the exact
  flow (browser / console / scratch script / on-device) and observe the real
  behaviour. For a "library call misbehaves" bug, run it live and watch it fail.
- **The mechanism, tied to that reproduction** — *this input → this observed fault*,
  not a narrative. **Match symptom to mechanism:** a *hang* ≠ an *error* ≠ a *crash* —
  reject any theory whose predicted symptom doesn't match what you actually saw (an
  unregistered plugin throws FAST; it does not hang — that one contradiction killed
  half the HealthKit theories).
- **Evidence read from the INSTALLED dependency source**, not memory of it, when a
  third-party call is involved (`node_modules/...`).

Discipline (codifies `feedback_reproduce_before_fixing`):
- **Distrust prior fixes' stated causes.** A trail of superseded "confirmed" fixes
  means none were proven. Code comments asserting a root cause are narrative — verify.
- **A "confirmed root cause" in the task prompt is a HYPOTHESIS, not a fact** — verify
  it before any expensive/irreversible fix, especially if the requester hedges.
- **Try the boring/simple layer first** — JS before native, your-own-code before the
  framework, a one-line change before a repackage/rebuild.

If the failure genuinely cannot be reproduced (heisenbug / prod-only / needs a real
device the loop can't drive), **do not guess a fix** — STOP, report exactly what was
tried and what's needed (e.g. a real-iPhone walk), and hand back. A reproduction you
can't get is a human-test checkpoint, not a licence to patch on a hunch.

Some footguns are now caught deterministically so they never need re-diagnosing: the
Capacitor thenable-await hang above is CHECK 8 of `check-hygiene.sh`
(`skills/scripts/check-plugin-proxy.sh`) — it fails the proof gate on an async plugin
resolver or an `await` of a plugin proxy. When a bug's mechanism generalises, prefer
turning it into a `check-*.sh` guard over just fixing the instance.

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

**Worktree by default for epic / `/loop` runs (L11).** An unattended epic spans many
fires and may run alongside another session on the same machine — so default to an
**isolated git worktree** (`git worktree add -b <branch> <path> <base>`) rather than
switching branches in the shared checkout. Rationale: two sessions sharing one checkout
can `git checkout` a branch out from under each other mid-run, corrupting both working
trees; a worktree gives the run its own files while sharing the one `.git`. A single
one-shot `/dev-loop` change in a known-solo checkout can branch in place, but when in
doubt — or any multi-phase / parallel run — use the worktree.

### 4 — EXECUTE (one increment) · L6
Make ONE agreed increment — code **and** its checks/tests in the same batch. One file
or one logical unit. Follow `skills/execute.md`. Do not bundle the next phase in.

### 5 — PROOF GATE (fail-fast, cheapest first; show evidence) · L1 L2 L3
Run in order, stop on first red, and **show the command + real exit code**, never
"it passes":

0. **Diff-classifier (mechanical trigger — run FIRST, don't rely on noticing)** —
   `bash skills/scripts/check-diff-triggers.sh`. It reads the diff and prints exactly
   which mandatory skills this change forces, so the DB-surface gates below are no
   longer conditional on the agent *spotting* the trigger:
   - migration / RLS touch → **forces `skills/schema-sync.md`**
   - RPC `CREATE OR REPLACE` touch → **forces `skills/rpc-security-sweep.md` +
     `skills/ephemeral-verify.md`**
   - Phase-5+ `apps/inorout/src` or `packages/core` touch → **forces
     `skills/casual-regression.md`**
   Exit 1 means one or more skills are forced — run every one it names (steps 3/6
   below) before the merge gate; exit 0 means none apply. Treat its output as the
   authoritative list, not a hint.
1. **Syntax & static correctness** — `node --check <each changed .js/.jsx>` (instant
   syntax), then `bash skills/scripts/check-lint.sh` (ESLint `no-undef` +
   `rules-of-hooks`). This catches the ReferenceError / hook-order class of runtime
   crash the Vite build and `node --check` both pass clean — the `setClearDebtExpanded`
   casual-status-tap outage (PR #251). ~2-3s; lints the whole app+package tree. Also
   hook-enforced at commit (Gate 1e), so running it here just **fails fast** instead of
   burning a cycle to the commit step.
2. **Hygiene** — `bash skills/scripts/check-hygiene.sh <each changed file>`
   (also hook-enforced on every edit). Its CHECK 8 (`check-plugin-proxy.sh`) catches the
   Capacitor thenable-await footgun (async plugin resolver / `await` of a plugin proxy,
   the PR #278 hang).
3. **DB-surface gates (forced by step 0 when touched), in parallel:**
   - RPC added/changed → `bash skills/scripts/check-rpc-security.sh <rpc>` +
     `bash skills/scripts/check-rpc-columns.sh <rpc>`, then **ephemeral-verify**
     (`skills/ephemeral-verify.md`) — live-DB end-to-end proof with auto-rollback.
     Also run the Hard-Rule advisories on any staged migration —
     `bash skills/scripts/check-mapper-sync.sh` (Rule 12, the is_self class),
     `bash skills/scripts/check-audit-events.sh` (Rule 9),
     `bash skills/scripts/check-realtime-subscriber.sh` (Rule 10),
     `bash skills/scripts/check-rpc-consumers.sh` (Rule 14, multi-app RPC → RPCS.md consumer record); each exits
     non-zero on a candidate finding for you to resolve or explicitly wave through.
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
   means the change can reach the live casual team or the live App-Store app (its
   Capacitor web bundle): treat it as tier-3, carry the matching proof (real-device walk /
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

**Scale review depth to tier (don't over-spend on docs).** A review is mandatory, but
its *weight* should match blast radius. For a **tier-1, `check-live-config`-CLEAR,
docs/config-only diff** (`.claude/` / `docs/` / `*.md`, no app/RPC/SQL), one combined
QA-correctness reviewer is proportionate — the security grader adds little where there's
no code, secret, RLS, or money surface to attack (state it as "security: N/A — no code
surface" rather than spending a second 50k-token agent on prose). The **full QA +
Security split (and adversarial pass for PROTECTED) is required the moment the diff
touches app code, an RPC, auth, money, or anything `check-live-config` flags PROTECTED.**
Never drop *below* one reviewer; never let the writer self-grade.
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
- **Skip CI-watch entirely for docs/config-only diffs.** If `check-live-config` is
  CLEAR *and* the diff touches only `.claude/` / `docs/` / `*.md` (no app, package, or
  build-input file), no app deploys from this change — the Vercel builds are pure noise
  (and `platform-ref` will "fail" regardless). Note "CI N/A — docs-only" and go straight
  to the merge gate; don't block on a deploy signal that can't tell you anything.
- **A red check only sends you back to step 5 if it's *your* app's deploy.** Map the
  change to its app (e.g. `apps/inorout` → `platform-clubmanager`) and judge on that.
- **Known false alarm:** `platform-ref` fails on **every** PR (pre-existing, unrelated
  to any `apps/inorout` change). Do **not** treat it as red-for-this-PR, and do **not**
  loop back to step 5 over it — note it and move on. (Calibrated during the
  ProfileSheet dup-key test, where `platform-ref` was red but irrelevant.)

### 9 — MERGE GATE (human) · hard guardrail
**Never auto-merge.** Report the PR and wait for a human to merge — but because
**merging `main` is a live production deploy** (apps/inorout → `platform-clubmanager`
→ `app.in-or-out.com` = the running casual team's app AND the web bundle loaded by the
live App-Store app), the operator merges on trust. So you MUST hand them a
one-line **ship-safety verdict**, never a bare "ready":
- **DARK-IN-PROD — safe to merge now.** check-live-config CLEAR, OR the change is
  flag-gated OFF in prod (e.g. `VITE_GAFFER_ENABLED` unset) / dead code / dev-tooling
  (`.claude/`, `skills/`, `docs/`) not in the app bundle. Say *why* it's dark.
- **SHIPS-LIVE — hold / proof required.** check-live-config PROTECTED. Name the
  surface, the proof carried, and whether it's safe to ship live (the Apple-review
  freeze is **lifted** — but PROTECTED still needs proof). Do not say "ready" without this.

**After the human merges — the formal POST-DEPLOY (Step 5).** Once the merge lands and
Vercel deploys, the post-deploy verification is `/prod-verify <PR#>`
(`.claude/skills/prod-verify/SKILL.md`) — it confirms the deploy is live, derives the
surfaces to walk from this PR's diff, runs a supervised demo-only live walk, and
classifies any failure T1 (→ a new `/dev-loop` fix) or T3 (→ surface). Supervised and
prod-facing, so it's operator-invoked (not `/loop`/unattended); recommend it at the
merge gate.

**Merge-from-a-worktree gotcha (don't misread it as a failed merge).** When you run
`gh pr merge` from inside a worktree whose base branch (`main`) is checked out in
*another* worktree, gh's *remote* merge succeeds but its post-merge **local** checkout
of `main` fails with `fatal: 'main' is already used by worktree at <path>`. That error
is only the local-sync step — confirm the real outcome with
`gh pr view <n> --json state,mergedAt` (expect `MERGED`), then fast-forward the shared
checkout separately (`git -C <main-worktree> pull --ff-only`). Don't retry the merge or
report it as failed on the strength of that local error.

**APPLE-REVIEW FREEZE — currently LIFTED (app went live in the App Store 2026-06-30).**
No build is in review, so auth / session / routing / native changes are **no longer
hard-frozen**. But the app is now **LIVE**: those changes ship to real App-Store users
through the Capacitor web bundle, so they remain tier-3 **PROTECTED** — require
ephemeral-verify / real-device proof + a ship-safety verdict before merge; just not a
hard stop. **Re-impose the freeze automatically the moment a new build is submitted for
review** — it's the surface that caused rejections #1 and #2. PWA-only mechanics
(service-worker / manifest / offline) are deprecating; drop their flag once the PWA is
decommissioned.

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

**Allowlisted unmanned surface (committed `settings.json`).** To run the reversible
pipeline prompt-free — including in cloud sessions — the committed allowlist grants the
loop the **read-only / reversible** operations only: Supabase **reads**
(`list_tables`/`list_migrations`/`get_advisors`/`get_logs`/schema reads), GitHub
**reads + PR plumbing** (`pull_request_read`, `get_file_contents`, `create_pull_request`,
comment), `gh pr create`/`view`/`checks`/`diff`, and **feature-branch** `git push` /
`git worktree` (the `pre-push-guard` hook still blocks `main`). **Deliberately NOT
allowlisted — these stay per-use gates because they are irreversible or hit live prod:**
`apply_migration`, `execute_sql` (can COMMIT to the live DB), `deploy_edge_function`,
`merge_pull_request` / `gh pr merge`, and DB-branch mutations
(`create`/`delete`/`merge`/`reset_branch`). The loop drafts + fully proves these
(ephemeral-verify / rpc-security / reviews) then surfaces a one-line plain-English
**intent question** — the operator's y/n on *intent* is the safety, and allowlisting
them would skip their eyes on an irreversible live-prod action. Granting the reversible
set is high-leverage and safe; granting the irreversible set is **not** "safest" and
must stay an explicit per-action decision.

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
`phase-manifest.template.md`.

**Launch honesty — name the expected-stops count before the first fire.** When kicking
off an epic, scan the manifest and report up front how many phases are tier-3 /
`needs-human` / FROZEN versus auto-proceedable, in one line — e.g. *"heads up: 3 of 4
phases need your sign-off (2 migrations + 1 deploy), so this run stops on you more than
it builds."* A mostly gated epic that runs quiet between stops looks broken; stating the
stop-count at launch sets the expectation so a correctly-behaving unmanned run doesn't
read as a failure. Each fire:

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
