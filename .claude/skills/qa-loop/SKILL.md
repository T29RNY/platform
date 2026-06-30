---
name: qa-loop
description: Closed test → triage → auto-fix → re-test QA loop for this monorepo. Walks the app, finds what's broken or rough, auto-fixes the SAFE stuff via dev-loop, STOPS for the risky stuff, re-tests, repeats until clean. Use when the operator says "qa-loop", "qa pass", "test and fix", "find what's broken", "shake it down", or wants the app swept for defects and the safe ones fixed hands-off. Default = regression net on the current branch; `full` adds a supervised browser walk; `scripted` = unattended deterministic lane only; free text narrows everything to one feature/area.
---

# qa-loop — test → triage → auto-fix → re-test, until clean

A **thin orchestrator**, not a new build system. It finds defects, sorts them by whether
there's one objectively-correct fix or a human call, hands the safe ones to **`dev-loop`**
(read `.claude/skills/dev-loop/SKILL.md` — qa-loop inherits ALL of its guardrails and
never invents a second fix path), and surfaces the rest. It obeys `loop-principles.md`
(L1–L12, in the dev-loop folder).

## This repo's testing reality (why the lane looks the way it does)

- **No unit runner, no typecheck, no lint.** `turbo run lint` is a no-op (not one of the
  8 apps defines a `lint` script). The deterministic test bed is: `node --check`
  (syntax), the `skills/scripts/check-*.sh` suite, `check-build.sh` (Vite build), and the
  **Playwright e2e** specs in `e2e/specs/`.
- **The deterministic lane is a REGRESSION NET, not a discovery engine.** With no units,
  it mostly proves "still compiles / existing specs still green." **Fresh defects are
  found by the browser walk** — so honest framing: default `/qa-loop` catches regressions;
  `/qa-loop full` is where new "broken / rough" issues actually surface.
- **e2e has two booby-traps — both handled by `skills/scripts/qa-suite.sh`, always use it:**
  1. A bare `npm run e2e` chains signed-in projects and rotates the single-use demo token
     → **false "signed-out" reds**. qa-suite runs each project **cold and alone**.
  2. `retries: 0` → a flake reads as a hard fail. qa-suite **re-runs any red once** and
     reports pass-on-retry as `FLAKE` (quarantine), not `FAIL`.
- **Dev servers are NOT auto-started**; specs point at `localhost:5173–5181`. Start the
  app(s) under test first (background); qa-suite reports `SKIP (server down)` otherwise —
  never a silent green.
- **Apps run local, but specs mint real demo sessions against the LIVE Supabase DB.** So
  even the "scripted" lane has live read/writes as the demo users (within the existing
  parity-test policy — ephemeral fixtures / demo accounts). Not hermetic; say so, never
  oversell `scripted` as zero-side-effect.
- **No GitHub Actions CI.** Vercel preview build = build/deploy only, never a correctness
  signal (the `platform-ref` check is red on every PR — a known false alarm).

---

## THE AUTO-FIX LINE — T1 / T2 / T3

The whole point. The divider: **is there ONE objectively-correct fix, or a product
choice? One right answer → auto-fix. A choice → surface.** When unsure, treat as T3.
And in this repo there is a hard deterministic gate on top: **a finding is only
auto-fixable if `bash skills/scripts/check-live-config.sh <files>` returns CLEAR.**
PROTECTED → T3 no matter how obvious the fix looks.

- **T1 — FUNCTIONAL DEFECT → AUTO-FIX.** Page errors/crashes, broken link/route, a
  control that does the wrong thing, a console error on load, a user seeing/doing
  something they shouldn't *that is a pure frontend gating bug*, accessibility failures.
  One correct fix, touches **no** tier-3 surface (`check-live-config` CLEAR).
- **T2 — QUALITY/UX DEFECT WITH A CLEAR FIX → AUTO-FIX.** Layout/spacing break,
  mislabeled or dead button, missing loading/empty/error state, copy typo, console
  warning, trivial polish. Still one right answer, still CLEAR.
- **T3 — GATED OR SUBJECTIVE → STOP, draft only, ask in plain English.** Exactly two
  kinds, nothing else auto-applies:
  - **(a) Touches a tier-3 / PROTECTED surface** — `check-live-config` PROTECTED, OR any
    of: a **migration** (`rls_migrations/*.sql`), **RLS / SECURITY DEFINER RPC**,
    **money** (Stripe), **auth** (`auth.uid()`, player/admin/venue tokens, SSO),
    **outward** (deploy, App-Store submit, real-device/PWA). Draft the fix; never
    apply/merge it.
  - **(b) A genuine design/structure DECISION** — a product choice, not one right answer.

---

## THE LOOP

### 0 — SCOPE + BASELINE (do this first, every pass)
- **Scope.** Free text after the command narrows EVERYTHING (which specs, which screens
  in the walk, which findings get fixed) to that feature/area. Out-of-area findings are
  **reported, not fixed** this pass. No free text → whole current branch.
- **Baseline (so qa-loop never chases pre-existing noise — like dev-loop's "platform-ref
  is always red" rule).** On a clean tree, record which checks/specs are ALREADY failing
  or flaky. qa-loop only acts on breakage that is **new vs this baseline**; long-standing
  reds it can't own are listed under "pre-existing" in the report, not fixed.
- **Bring servers up** for the lanes you'll run: `npm run dev --prefix apps/<app>`
  (background), wait for the port, then proceed. qa-suite's `SKIP` tells you what's still
  down.

### 1 — TEST (never fake a green · L1 L3)
Run cheapest-first, show the command + real exit code:
1. **Syntax** — `node --check <each changed .js/.jsx>`.
2. **Hygiene** — `bash skills/scripts/check-hygiene.sh <each changed file>`.
3. **Build** — `bash skills/scripts/check-build.sh` (workspace-deps + Vite build).
4. **e2e regression net** — `bash skills/scripts/qa-suite.sh [projects]` (cold,
   flake-aware, scoped to the area's projects when free text was given).
5. **(`full` only) Supervised browser walk · L5** — drive the running app with the
   Playwright **MCP** tools over the area's key routes/users (demo users per `DEMO_USERS.md`;
   `127.0.0.1` for true-unauth per the localhost-admin-backdoor note). Capture **console
   errors/warnings** (`browser_console_messages`) as findings, eyeball layout/empty/error
   states, and run an **axe-core** a11y check via `browser_evaluate`. **Read-only,
   supervised, local/preview only — NEVER production, NEVER unattended.**

Report pass / fail / **skip-with-reason** honestly. A skip-with-reason beats a green lie.

### 2 — TRIAGE
Sort every finding into T1 / T2 / T3 using the auto-fix line above. For each candidate
auto-fix, run `check-live-config.sh` on the files it would touch to confirm CLEAR — a
PROTECTED result demotes it to T3(a). Map each finding to its app (the fix batch may span
`apps/*`; the e2e re-test must cover each touched app's projects).

### 3 — FIX (ONE batched dev-loop pass · L6 — re-tests are expensive, don't fix-one-retest-one)
Hand **all** T1+T2 findings to `dev-loop` as a **single** change set:
`/dev-loop <the batched CLEAR fixes, each with its done-check>`. dev-loop owns the actual
edit → proof gate → fresh-context QA+Security review → PR. qa-loop adds **no** new merge
power: still PR-only, never push main, never auto-merge, never apply a migration. If the
batch is large or spans many areas, split into a few dev-loop passes — but batch within an
area, never one fix per re-test.

### 4 — RE-TEST + REPORT
Re-run the lane (step 1, scoped to touched apps) to confirm the fixes landed AND nothing
else regressed. Then write a **dated report** — reuse the repo's existing ledgers, don't
spawn a parallel system:
- Chat summary in plain English (operator preference): found / fixed (link the PR) /
  still-open / pre-existing.
- **Still-open + T3 items → `BUGS.md`** (the project's bug tracker). **Production-class
  issues → `GO_LIVE_ISSUES.md`** (required by the repo's hard rule). One entry each, not
  a `docs/qa/` duplicate.

### 5 — REPEAT
Loop back to step 3 **only if a NEW T1/T2 appeared** (a fix exposed another defect).
Otherwise **stop** — clean. Budget ~3 passes; if still surfacing new reds after that,
**reset rather than thrash**: stop, report the evidence, ask for direction.

### 6 — SURFACE T3 (human call, plain English · L9)
Present the T3 bucket as decisions, never diffs:
- **T3(a) gated** — the drafted fix + a one-line **intent** question
  (*"this changes who can read X — intended? y/n"*) + the ship-safety verdict from
  `check-live-config`. Drafted and proven, **never applied/merged** by the loop.
- **T3(b) decision** — the choice and the trade-off, your recommendation first.

---

## INVOCATION

- **`/qa-loop`** — default. Baseline → deterministic lane (syntax + hygiene + build +
  `qa-suite`) → triage → batch CLEAR T1+T2 to dev-loop → re-test → report → surface T3.
  Catches **regressions**.
- **`/qa-loop full`** (deep) — adds the **supervised** Playwright-MCP browser walk
  (console + a11y + eyeball). Where new defects are actually found. Read-only, supervised,
  **never unattended, never prod.**
- **`/qa-loop scripted`** — deterministic lane only (no walk). The **only** scope fit for
  an unattended / scheduled run (`/loop /qa-loop scripted` or a routine). Still hits the
  live demo DB — not hermetic.
- **`/qa-loop <feature/area>`** — narrows tests, walk, AND fixes to that area; out-of-area
  findings reported but not fixed this pass. Composs with the scopes
  (`/qa-loop full venue bookings`).

## GUARDRAILS (never relaxed — inherited from dev-loop)
- **No fake greens** — pass / fail / skip-with-reason reported honestly.
- **T3 is a hard stop** — tier-3 / PROTECTED surfaces are draft-only; structural choices
  are the human's call. `check-live-config` is the deterministic gate, not a vibe.
- **Any hands-on walk is read-only + supervised** — never scheduled unattended, never
  against production.
- **This project only** — never point tests, fixes, or deploys at another repo/env.
- **Thin orchestrator** — reuse dev-loop + the check scripts + BUGS.md/GO_LIVE_ISSUES.md;
  add no services, tables, or parallel report systems.

## Token discipline
Deterministic before LLM (L2); baseline-aware so settled reds aren't re-investigated;
scope sub-agents (audit/review live inside dev-loop) to the diff; batch fixes; read only
the ranges you need; don't re-run a clean lane.
