---
name: go-live-check
description: Full go-live readiness audit for one persona / feature / feature-flag at a time. Derives the target's complete touched-surfaces manifest (tables+RLS, routes, permissions/roles, feature flags, marketing pages, email templates, migrations, legal/DPIA/compliance gates), checks every applicable surface, ACTUALLY tests the real flows (browser walk or real test suite — never "the page renders"), classifies every finding T1/T2/T3, gives a READY / NOT READY / READY WITH KNOWN GAPS verdict naming the exact human action to go live, and always closes with a standard plain-English summary. Use when the operator says "go-live check", "go-live readiness", "is <persona/feature/flag> ready to launch", or names a user type/persona/feature-flag they want audited before launch. Read-only investigation + real testing; fixing T1/T2 findings is a separate, explicitly-requested follow-up that runs through dev-loop.
---

# go-live-check — full readiness audit for one target at a time

A **thin orchestrator**, not a new build system. It reuses this repo's existing
machinery — `GO_LIVE_ISSUES.md`, `BUGS.md`, `DECISIONS.md`, `check-rpc-security.sh`,
`check-db-schema.sh`, Playwright MCP, and `dev-loop`/`backlog-capture` for anything that
needs fixing or filing — rather than inventing a parallel audit system. Read
`.claude/skills/dev-loop/SKILL.md` before running any fix pass; go-live-check inherits
its guardrails and never invents a second fix path.

**One target per run.** The operator names a persona (e.g. "Safeguarding Lead", "Venue
Operator"), a feature, or a feature-flag. Never widen scope to "check everything" —
that's a different, much bigger ask. If the operator hasn't named a target yet, ask
which one, in chat text (not a popup — [[feedback_no_popup_questions]]).

---

## STEP 0 — LOCK THE TARGET

State the target back in one line: persona / feature / flag name, and what "live" means
for it (a flag flip, an App Store submission, a marketing launch, etc). If ambiguous,
ask ONE clarifying question in chat before proceeding.

---

## STEP 1 — TOUCHED-SURFACES MANIFEST (write this down BEFORE checking anything)

Read-only reconnaissance. Grep and read — do not edit anything in this step. Build a
manifest with one section per surface type below. For each, either list what was found
or write **"N/A — target does not touch this surface"** explicitly. Silent omission is
not allowed — an empty section with no explanation reads as "forgot to check."

Surfaces to derive:

1. **Tables & RLS policies** — every table the target reads or writes. Cross-reference
   `SCHEMA.md` and grep migrations for `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` on
   each.
2. **Routes / pages** — every screen or page across the touched app(s) reachable by
   this persona/feature.
3. **Permission / role checks** — every place a role/permission gate should apply, both
   in-page (component-level `if (role !== ...)`) and centrally (route guards, RPC-level
   `resolve_*_caller` checks). Note: centrally-checked but not in-page (or vice versa) is
   itself a finding, not a pass.
4. **Feature flags** — the flag(s) that gate this target, and everywhere they're read
   (frontend `VITE_*` checks, backend/RPC-level gates if any).
5. **Marketing pages** — any `marketing/` page, landing page, or in-app CTA that leads a
   user toward this target.
6. **Email templates** — any transactional/notification email this target triggers.
7. **Migrations** — every migration file that created or altered the schema/RPCs this
   target depends on. Confirm each has a matching applied state (check
   `mcp__supabase*__list_migrations` read-only, or the project's migration convention).
8. **Legal / compliance gates** — anything in `DECISIONS.md`, `GO_LIVE_ISSUES.md`, or a
   privacy register that flags this target's data processing as needing sign-off.

Cross-reference `BUGS.md`, `GO_LIVE_ISSUES.md`, `DECISIONS.md`, and memory for anything
already known about this target before checking — don't re-discover what's already
documented; verify it's still true.

Present the manifest to the operator (or just proceed straight to Step 2 if the run is
unattended/pre-authorised) before checking readiness.

---

## STEP 2 — CHECK EACH SURFACE

Work through the manifest, checking only sections marked applicable. For every
inapplicable section, state "N/A — [why]" rather than skipping silently.

- **Data & RLS coverage** — is RLS actually `ENABLED` on every touched table (not just
  present in a migration file — confirm the ENABLE statement wasn't later reverted).
  Read-only `execute_sql` against `pg_tables`/`pg_policies` if available; otherwise grep
  migrations and flag if unconfirmed live.
- **Feature-flag wiring** — read the flag check in the code and confirm it actually
  gates the claimed surface (every route/component/RPC it should cover), not just the
  entry point. A flag that gates the button but not the RPC is a finding.
- **Permissions / role boundaries** — trace at least one attempt to reach the surface as
  a role that should be blocked. Confirm both the in-page guard and the
  server-side/RPC-side guard (client-side-only gating is a T3 finding — trivially
  bypassed).
- **UI completeness** — real flows only. No placeholder/lorem/fake data screens counted
  as done. If a screen exists but wiring to real data is unconfirmed, that's a finding,
  not a pass.
- **Marketing readiness** — click every CTA/signup link that leads to this target
  end-to-end; confirm it lands where it claims to, with no dead links or wrong copy.
- **Email templates & dry-run safety** — confirm sends are logged (not silently
  swallowed on error) and that the template renders correctly with the current variable
  set. Prefer a dry-run/sandbox provider check over an actual live send.
- **Audit logging** — every state-changing action this target performs must write to
  `audit_events` (or the project's audit table) — Hard Rule 9. Grep the RPC bodies.
- **Billing / compliance gates** — confirm gates default OFF until explicitly launched,
  and that the default is enforced server-side, not just in a client default prop.
- **Migration safety** — confirm migration source files exist in the repo matching what
  was actually applied live (Hard Rule 11 — no drift). Check for the DROP-before-
  CREATE-OR-REPLACE pattern on any RPC whose parameter types changed.
- **Legal / DPIA / privacy sign-off** — if this target introduces new personal-data
  processing, confirm it's captured in the privacy register / `DECISIONS.md` legal-gate
  entries. If a legal gate exists and is still open, that's a hard T3 blocker, not a
  note.
- **Rollback / kill-switch safety** — confirm there's a clean way to turn this back off
  (a flag flip, a flag default reversion) without a migration or code revert. If the
  only rollback path is "revert the PR," that's a finding.

---

## STEP 3 — ACTUALLY TEST IT

Do not stop at reading code. For every touched flow:

- If a Playwright/e2e spec already covers it → run it (`skills/scripts/qa-suite.sh` or
  the specific spec), report PASS/FAIL/FLAKE with evidence.
- If no automated test exists → drive it manually via Playwright MCP (supervised,
  never against a real team/live prod — demo/local per Hard Rule 6 and the
  `prod-verify`/`qa-loop` conventions) and report what was actually observed.
- **If a touched flow has no test AND cannot be walked in this session** (e.g. requires
  a role you can't assume, a real device, a live payment) — that absence is itself a
  **finding**, not something to skip past. Say so explicitly: "Untested: [flow] —
  [why], recommend [real-device walk / real-Lead eyeball / etc]."

Never report a flow as working without one of: a passing automated test, an observed
manual walk, or an explicit "untested" finding.

---

## STEP 4 — CLASSIFY EVERY FINDING

Same tiering as the rest of this repo's loop (`qa-loop`/`dev-loop` convention) — **when
unsure, default to T3**:

- **T1 — objectively-correct fix, no gated footprint.** Broken link, missing RLS policy
  that should obviously be enabled, a permission check present centrally but missing
  in-page (or vice versa) with one clear correct fix.
- **T2 — quality/hardening, no gated footprint.** Missing loading state, weak error
  message, a flow that works but is rough.
- **T3 — security/migrations/money/email-sending/legal, or a genuine product decision.**
  Any RLS change, any migration, any billing gate, any live email send, any legal/DPIA
  gap, any auth/native-app-affecting change (tier-3 PROTECTED per dev-loop), any finding
  where more than one reasonable fix exists. **Never auto-applied — drafted only.**

---

## STEP 5 — VERDICT

One of:

- **READY TO LAUNCH** — no T1/T2/T3 blockers found (or all resolved). Name the exact
  human action to go live (e.g. "flip `VITE_X_ENABLED` to true in Vercel env for
  apps/venue").
- **NOT READY** — one or more blocking findings (any open T3, or unresolved T1s that
  break the core flow). List the blockers plainly.
- **READY WITH KNOWN GAPS** — core flow works, but a T3 punch-list remains (e.g. legal
  sign-off pending, real-device walk owed). Name the exact human action to launch
  ANYWAY if the operator accepts the gaps, and separately what closes each gap.

Never flip a flag, apply a migration, or merge to main as part of a verdict — the
verdict names the action; the operator (or a separately-invoked dev-loop pass) takes it.

---

## STEP 6 — IF ASKED TO FIX T1/T2

Only on explicit request (this skill does not self-invoke a fix). Batch all CLEAR T1+T2
findings into **one** `/dev-loop` change set — branch → implement → typecheck/build →
fresh-context QA + security review of the diff → PR → watch CI → **stop at the merge
gate**. Never merge to main, never apply a migration, never touch RLS/money/live-email
without explicit operator sign-off (same boundary as `dev-loop`/`qa-loop`).

T3 findings are never fixed inline — file each as a backlog/tracking item via
`/backlog-capture` (or a GitHub issue if that's the ask) with source tagged
`go-live-check <target>`, so they don't die in chat scrollback.

---

## STEP 7 — CLOSE (standing format, every run and every follow-up fix)

Always end a go-live-check run — and any follow-up fix pass — with this exact
structure, in plain English (no code snippets, no jargon):

```
GO-LIVE CHECK — [target] — [date]

VERDICT: READY TO LAUNCH / NOT READY / READY WITH KNOWN GAPS

ISSUES FOUND / FIXED:
- [plain-English description of what was wrong and why it mattered]
- ...

CREATED:
- [PR #n / issue #n / migration file / doc update] — [one-line what it is]
- ...

RECOMMENDED ACTION PER ITEM:
- [item] → [merge PR #n / needs legal sign-off before applying / no action needed / etc]
- ...

TO ACTUALLY GO LIVE: [the exact human action — flag flip, sign-off, deploy step]
```

If nothing was created (pure audit, no fixes), say so plainly: "Nothing created this
run — audit only." If a fix pass follows a prior audit, reference the audit it closes
out.

---

## INVOCATION

- **`/go-live-check <persona/feature/flag>`** — full manifest → check → test → verdict
  for that one target.
- Free text after the target narrows scope further (e.g. "just the RLS and legal
  gates").
- Fixing findings is a separate, explicit follow-up ask — this skill doesn't
  self-escalate into a build.

## GUARDRAILS (never relaxed)
- **One target per run** — never silently expand to "the whole platform."
- **Manifest before checks** — write down what will be checked before checking it.
- **No silent omission** — every inapplicable surface gets an explicit "N/A — why."
- **Actually test, don't just read** — a missing test is a finding, not a skip.
- **T3 default when unsure** — security/migration/money/email/legal/product-decision
  findings are drafted, never auto-applied.
- **Never flip a flag, merge to main, or apply a migration/RLS change yourself** — the
  verdict and the fix pass both stop at the human gate (dev-loop merge gate; operator
  sign-off for anything tier-3).
- **Standard closing format, every time** — issues found/fixed, everything created with
  links/IDs, recommended action per item, the exact action to go live. No exceptions.
- **Thin orchestrator** — reuse `GO_LIVE_ISSUES.md`/`BUGS.md`/`DECISIONS.md`,
  `check-rpc-security.sh`/`check-db-schema.sh`, Playwright MCP, `dev-loop`,
  `backlog-capture`. Add no parallel report system.
