---
name: scope
description: Iteratively scope a NEW In-or-Out feature on behalf of its target users, then emit a build-ready handoff + the paste-ready trigger prompt. Read-only — never builds. Use when the operator says "scope <feature>", "scope a feature", "design <feature>", or wants a feature planned, scored, and turned into a /dev-loop manifest before any code. Fans out one fresh-context expert agent per lens (user, technical, security, UI/UX, data/DB, design, platform/native, safety, best-practice, future-proofing, effort/phase-split), synthesises, has an independent judge score it against scope-rubric.md, iterates until "as good as it'll get", writes <SLUG>_HANDOFF.md, and stops at a plain-English human review. Runs unmanned until that review.
---

# scope — design-and-decide front door (twin of dev-loop)

Where `dev-loop` **builds** one change correctly, `scope` **designs and decides** one
feature correctly — then hands the build straight to dev-loop. It is the planner that
sits in front of the builder.

**Read-only by construction.** It reads repo state + the web, spawns sub-agents, and
writes exactly one artefact at the end: `<SLUG>_HANDOFF.md`. It NEVER edits app code,
NEVER applies a migration, NEVER queries the live DB, NEVER builds. The handoff it
writes is the only thing it touches in the repo; your review gates every build.

Obeys all of `.claude/skills/dev-loop/SKILL.md`'s guardrails and `loop-principles.md`
(L-numbers below cite them). It does not restate the methodology — it delegates to the
repo `skills/` files (`feature-plan.md`, `audit.md`, `rpc-security-sweep.md`,
`schema-sync.md`) and to `scope-rubric.md` (in this folder) for scoring.

## Runs UNMANNED until the review — the discipline that keeps it that way

The operator fires `/scope <feature>` and walks away; nothing prompts until the
plain-English breakdown. That only holds if every command is allowlist-safe (the same
rule dev-loop lives by). So, without exception:

- **Use the Read / Grep / Glob tools, never ad-hoc `grep|…` / `ls|sort` / `sed`/`<()`
  in Bash.** A single piped Bash probe in any lens or judge sub-agent stalls the whole
  run waiting on a human. This is the #1 way an unmanned scope freezes — forbid it in
  every sub-agent prompt.
- **Grounding check-scripts only in their allowlisted form** (all already wildcarded):
  `check-references.sh *`, `check-db-schema.sh *`, `check-schema-column.sh *`,
  `check-rpc-security.sh *`, `check-rpc-columns.sh *`, and this skill's
  `check-manifest.sh *`. Read an exit code with `echo "exit=$?"` on its own line.
- **Never touch the live DB.** No `execute_sql`, no MCP write. Ground on `SCHEMA.md` /
  `RPCS.md` + the check-scripts. This keeps scope both unmanned *and* incapable of
  mutating anything.
- **Engine = Agent fan-out (default), not Workflow.** The Agent tool never prompts, so
  it stays hands-off; the main loop drives the score→iterate loop. Reserve the heavier
  `Workflow` engine for an explicitly-requested "deep scope" of a large, ambiguous epic.
- **The only seamless write is `Write(*_HANDOFF.md)`** (allowlisted). That single emit
  is the boundary; the breakdown is presented right after.

---

## THE LOOP — FRAME → FAN-OUT → SYNTHESISE → SCORE → ITERATE → EMIT → HUMAN

### 1 — FRAME (deterministic reads · L10)
Recall MEMORY (active threads), then read the In-or-Out state files that bear on the
feature: `CLAUDE.md` (operating contract), `DECISIONS.md`, `SCHEMA.md`, `RPCS.md`,
`FEATURES.md` (phase tracker + IO unlock grid), `BUGS.md`, `GO_LIVE_ISSUES.md`, and —
only if relevant — `IO_INTELLIGENCE.md`, `GAFFER.md`, `STRATEGY.md`, `CONTEXT.md`.
Run `skills/feature-plan.md` if the feature is a FEATURES.md backlog row.

Identify **the target user(s)** (casual player · team admin · guardian/U18 · referee ·
venue operator · club manager · league admin) and what **"wow"** means for each.

**Prior-scope check (do this FIRST in FRAME — never scope cold · L10).** Before any
fan-out, find out whether this feature has ALREADY been scoped, to any level, and
**build on / improve that** instead of starting from scratch. Search, in order:
1. Repo-root `*_HANDOFF.md` (Glob) — an existing manifest for this feature, full or partial.
2. `docs/epics/*.md` — lean phase manifests.
3. MEMORY `project_*.md` topic files + `MEMORY.md` index — a scoped-but-unbuilt thread
   (most In-or-Out scoping lives here: "📋 SCOPED ... UNBUILT").
4. `FEATURES.md` / `DECISIONS.md` — a backlog row or settled decisions that pre-constrain it.

Classify what you find by maturity and act on it:
- **None** → scope fresh (full loop below).
- **Rough note / backlog row / partial decisions** → load it, carry its **locked
  decisions forward as confirmed** (don't re-litigate settled product calls — flag them
  in LOCKED DECISIONS as "already decided"), and scope only the gaps.
- **Existing handoff manifest** → do NOT rewrite from zero. Audit it against current repo
  reality (the reality gate — files/tables/RPCs may have changed since it was written;
  the MATCH_WORKOUT manifest itself carries an "AUDIT FLAG: columns don't exist" note),
  fold in anything stale or missing, RAISE its score through the judge loop, and emit an
  **improved** version of the same file. Note in the breakdown that it builds on / supersedes
  the prior scope, and which decisions were inherited vs newly added.

State up front in the review which prior artefact (if any) this builds on, and at what
maturity you found it.

**Verify-first (the highest-value step · L10/L2):** before scoping anything, cheaply
check whether parts already exist — Grep migrations / RPCs / components. (The Gaffer
epic had 2 phases already built.) Detect the **next free migration number** from the
highest `NNN` in `rls_migrations/*.sql` via the Glob tool — NOT from MEMORY (its
"next free" line goes stale) — and note the "first-come on main" caveat (CLAUDE.md
cloud-session discipline).

### 2 — FAN-OUT (one fresh-context sub-agent per lens · L4/L8/L11)
Spawn the 11 lenses as **scoped Agent sub-agents** (clean windows; each sees only the
feature brief + the repo, not each other — so they don't converge prematurely). Each
returns a structured finding + open questions. Lenses (full criteria in
`scope-rubric.md`):

① target-user / jobs-to-be-done  ② technical / architecture  ③ security & RLS
④ UI/UX  ⑤ data model / DB & migrations  ⑥ design-system fit
⑦ platform surface (web/PWA now; native via Capacitor + `ios-plugins/`; push / HealthKit
/ camera / offline; **dark-ship** + App-Store-freeze awareness)
⑧ safety & compliance — **In-or-Out domain:** under-18 (`member_profiles.dob`), consent
toggles, UK-GDPR delete-cascade (`delete_my_account*`), special-category health data
⑨ best-practice / latest patterns (**WebSearch** the current-2026 approach)
⑩ future-proofing / extensibility (additive RPC params; record consumers in RPCS.md
HR#14; return-shape→consumer mapping HR#12)
⑪ effort / risk & phase-split (independently-shippable PRs; tier + ship-safety tags)

> ⚠️ This is In or Out, not LetTrack. The safety lens is **under-18 / consent / health /
> App-Store** — NOT lettings law (no Right-to-Rent / Awaab's Law here). State files are
> `DECISIONS.md` / `SCHEMA.md` / `FEATURES.md`, not `decisions-v1` / `master-backlog`.

Tell every sub-agent, verbatim: *use Read/Grep/Glob + the allowlisted `check-*.sh`
scripts only; no piped/compound Bash; never query the live DB.*

### 3 — SYNTHESISE
Merge the lens findings into ONE draft in the **gold-standard handoff shape**
(`MATCH_WORKOUT_TRACKING_HANDOFF.md` is the reference): plain-English **WHAT IT IS** →
**LOCKED DECISIONS** (assumptions to confirm) → **KEY AUDIT FACTS** (next migration,
reusable backend, gotchas — load-bearing, don't re-derive) → **ROADMAP** = PRs in
dependency order, each **tier-tagged (1/2/3) + ship-safety (CLEAR/PROTECTED) + 🚦 gate
tags + Gates: line + done-check** → **🚦 GATES the loop must stop at** → **DONE =** →
**Related**. If the synthesis is a single PR (not an epic), prepare a single-`/dev-loop`
emit instead (see EMIT).

### 4 — SCORE (independent judge · L4)
A **fresh-context JUDGE** (never the synthesiser) scores the draft against
`scope-rubric.md`: each lens 0–5 + a **"wow ceiling" check** + concrete gaps. Then run
the **deterministic gates** (a gate FAIL caps the score):
- **Reality:** every named file/table/column/RPC exists — Read/Grep +
  `check-db-schema.sh` / `check-schema-column.sh` / `check-references.sh --rpc`; the
  migration number is genuinely free.
- **Structure:** `bash skills/scripts/check-manifest.sh <draft file>` PASSES.
- **Methodology:** every tier-3 touch is 🚦-gated to a human, never auto-applied.

### 5 — ITERATE
Feed the judge's gaps into a refinement round (re-run only the weak lenses + re-synthesise),
then re-score. **STOP** per `scope-rubric.md` stop-conditions: every lens ≥4 AND overall
≥ bar AND gates PASS, **or** score plateaus (<2-pt delta for 2 rounds = "as good as it'll
get"), **or** 4-round hard cap (L9). **Log each round's score.**

### 6 — EMIT
Write the artefact(s) + the trigger prompt:
- **Epic (multi-PR):** `Write` the rich manifest to repo root as
  `<SLUG>_HANDOFF.md` (validated by `check-manifest.sh`; tier-3 auto-🚦-tagged). Embed
  the invocation line at the top (as MATCH_WORKOUT does):
  `/loop /dev-loop <SLUG>_HANDOFF.md`.
- **Single change:** still write a short `<SLUG>_HANDOFF.md` (so the rationale is on
  disk) and give the prompt `/dev-loop <the change, with its done-check>`.
- Set `Plan gate: batched` and default `Merge mode: per-phase` in the manifest header
  (auto/queue stays an explicit operator opt-in).

### 7 — HUMAN REVIEW (stop)
Present a **plain-English breakdown in chat** (no code): what the feature is, the locked
decisions it assumed, the PR roadmap, the **expected-stops count** ("3 of 6 PRs need
your sign-off — 2 migrations + 1 deploy"), the final round's score + any lens still <4
named as a known limitation, open questions, and the **paste-ready trigger prompt**.
Then **STOP.** Nothing builds until the operator fires the prompt.

---

## TOKEN DISCIPLINE
Deterministic FRAME before any LLM lens; scoped sub-agents with clean windows; read only
the ranges needed; on ITERATE re-run only the weak lenses, not all 11. Adapt the fan-out
to size: a small/obvious feature gets ~3 lenses + one judge round; a large/ambiguous epic
gets the full 11 + the deep score loop.

## HARD GUARDRAILS (never relaxed)
Read-only: no app-code edit, no migration apply, no live-DB query, no build, no commit,
no merge. The sole repo write is `<SLUG>_HANDOFF.md`. Never auto-launch the build —
emitting the prompt is not firing it. Tier-3 surfaces are drafted into the manifest and
🚦-gated, never executed here.

## Invocation
- `/scope <feature>`  — scope a new feature end-to-end → handoff + prompt → review.
- Natural language: "scope <feature>", "design <feature>", "plan out <feature>".
- Deep mode (large epic): "scope <feature> — deep" → use the `Workflow` engine for the
  fan-out + judge-convergence loop instead of inline Agent fan-out.
