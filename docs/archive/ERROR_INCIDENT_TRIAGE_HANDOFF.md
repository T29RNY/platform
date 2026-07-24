# Error/Exception Triage — Epic Manifest

*Scoped 2026-07-02. Audit + plan only — no code yet.*
*Invocation once approved: `/dev-loop ERROR_INCIDENT_TRIAGE_HANDOFF.md` (single change,
Phase 1 only — Phase 2 is BLOCKED, see below, not a `/loop` epic).*
*PR-only; never pushes main; never applies a migration or touches secrets/env without*
*explicit sign-off.*

> ⚠️ **Naming note:** this is a different feature from `INCIDENT_TRIAGE_HANDOFF.md`
> (venue-safeguarding incident queue, migs 461–469, MEMORY `[[project_incident_triage]]`).
> That one triages **venue safety incidents** reported by operators. This one triages
> **engineering errors/exceptions** — a Claude-Code skill, not a DB feature. Slug
> `error-incident-triage` throughout to avoid collision.

---

## WHAT IT IS (plain English)

**Target user: the operator (Tarny) as solo engineer** — whoever is pasting a crash
report from the WhatsApp path today, or reviewing a tracker issue once one exists. Not a
player-facing feature; no native/Capacitor/HealthKit/App-Store surface is touched.

A new Claude-Code skill — `/error-triage` — that takes an error (a pasted stack trace
today; a Sentry-or-equivalent issue URL once one is chosen) and produces a structured
engineering triage: **severity** (P1 outage / P2 degraded / P3 cosmetic), **affected app +
RLS/security scope**, a **root-cause hypothesis** (grounded in greps against BUGS.md,
migrations, and `supabase.js` — not a guess), and a **recommended next action**: file it
via the existing `/backlog-capture` skill (non-urgent / needs a repro) or open a
`/dev-loop` defect-fix phase directly (P1 + reproducible root cause). It never fixes
anything itself — same read-only, hand-off-only discipline as `/prod-verify` and
`/babysit-prs`.

**The hard external blocker:** no error tracker is wired up anywhere in this repo today.
`BETA_LAUNCH_CHECKLIST.md:75` — *"Sentry or equivalent error tracking — DECISION
NEEDED"* — is still open, and there is no `ErrorBoundary` component and no
`window.onerror`/`unhandledrejection` handler anywhere in `apps/` or `packages/` (confirmed
by grep). So today the **only possible input is a human pasting a raw stack trace** — the
crash-report path the checklist already defines (*"screenshot + WhatsApp message + don't
refresh"*, `BETA_LAUNCH_CHECKLIST.md:82`).

**Two phases, ONE triage pipe — design now, wire later:**
- **Phase 1 (this manifest, buildable TODAY):** the triage LOGIC — parse pasted error
  text → classify app/RLS-scope/severity → hypothesize root cause → recommend
  backlog-capture or dev-loop. No external decision required.
- **Phase 2 (BLOCKED — not scoped further here):** wiring a live tracker in as the input
  source (Sentry issue-URL fetch, or a webhook). Hard-gated behind the
  `BETA_LAUNCH_CHECKLIST.md:75` decision — cannot be scoped in detail until a tracker is
  picked, because the input shape (API vs webhook vs polling) depends entirely on which
  tool is chosen.

## LOCKED DECISIONS (to confirm with operator)

1. **Phase 1 ships as a skill file only** (`.claude/skills/error-triage/SKILL.md`) — no
   DB schema, no RPC, no migration. Read-only investigation, same class as `prod-verify`/
   `babysit-prs`.
2. **Severity = flat P1/P2/P3**, not a richer SEV0–4 scheme. Best-practice research
   confirms 3–4 levels is the working norm for small teams — "if people argue about the
   level, the definitions are too ambiguous."
3. **Input today = pasted stack trace / error text only.** A Sentry-shaped URL is accepted
   defensively (attempt a `WebFetch` of the public page; on auth failure, ask the operator
   to paste the trace body instead) but **no tracker API integration is built** — there's
   no API key/project to call.
4. **Mandatory redaction pass before any output or filing** (see LENS: security below) —
   non-negotiable, ships in Phase 1 from day one, not a later hardening pass.
5. **Auth/RLS/token-related findings always route to human review**, never auto-classified
   as safe-to-fix, even at P1. The skill states a hypothesis and a recommended *next step*
   (open dev-loop / file to backlog-capture) — it never proposes the SQL/code fix itself.
6. **The missing-tracker gap is filed as its own GO_LIVE_ISSUES.md item**, separate from
   and prior to this skill — it's a real production-visibility gap today (silent RLS/RPC
   failures could go unnoticed), and it exists whether or not this skill gets built.

## KEY AUDIT FACTS (load-bearing — don't re-derive)

- **No prior scope exists for this feature.** Checked repo-root `*_HANDOFF.md` (30+
  files, none named error/exception/monitoring), `docs/epics/` (2 files, neither
  relevant), MEMORY.md index, FEATURES.md, DECISIONS.md, BUGS.md — clean miss.
  `INCIDENT_TRIAGE_HANDOFF.md` exists but is the unrelated venue-safeguarding feature
  (migs 461–469) — confirmed different scope, different data model, different app
  surface (`apps/venue`/`apps/hq` incidents table, not error/exception handling).
- **Next free migration = 470** (not needed for Phase 1 — no schema touched — but
  recorded per the repo convention in case Phase 2 ever needs one for an audit-log table).
- **No error tracker, no ErrorBoundary, no global error handler anywhere in the repo.**
  Grepped `apps/` and `packages/` for `ErrorBoundary`, `window.onerror`,
  `unhandledrejection` — zero matches. The only existing error-adjacent conventions are:
  `console.error`-only logging (CLAUDE.md Hard Rule 3), `audit_events` server-side traces
  on every fire-and-forget RPC (Hard Rule 9), and the WhatsApp crash-report path in
  `BETA_LAUNCH_CHECKLIST.md`.
- **Reusable patterns to build on, not reinvent:**
  - **App + RLS-scope detection** — reuse `babysit-prs`'s file→app map verbatim
    (`apps/inorout`→platform-clubmanager, `apps/venue`→platform-venue, `apps/ref`→
    platform-ref, etc.; `packages/core`/`packages/ui` widen to every consuming app). RLS
    surface grounded in CLAUDE.md's RLS checklist: `PGRST301`/`42501`/"permission denied"
    = the RLS wall working as designed (likely a missing-RPC bug, not a hole);
    `supabase.rpc()` frame = check which wrapper in `supabase.js` is on the stack to tell
    anon/authenticated/admin-token context apart.
  - **Root-cause hypothesis** — concrete greps, not free-association: match the error's
    function/RPC name against `BUGS.md`/`GO_LIVE_ISSUES.md` (known-issue dedup, same
    pattern as `backlog-capture` STEP 4); grep `rls_migrations/` + `supabase.js` for the
    current signature and compare against what the trace shows was called (this is Hard
    Rule 7's call-site check, run backwards from a failure); `git log --oneline -- <file>`
    for a recent regression. If none surface a cause, **say so explicitly** — "needs a
    repro" beats a fabricated hypothesis.
  - **Filing/handoff** — reuse `backlog-capture`'s exact classify table (`feature` →
    FEATURES.md, `bug` → BUGS.md, `security` → BUGS.md `⚠️ SECURITY`, `compliance` →
    BUGS.md `📋 COMPLIANCE`), don't invent new tags. Reuse `prod-verify`'s T1-routing
    pattern for the dev-loop handoff (open `/dev-loop <defect + done-check>`, never patch
    in place).
- **Interim error-signal sources that need NO tracker decision** (surfaced by the
  best-practice lens, useful to note even though out of THIS skill's scope): Vercel's own
  Runtime Logs / Observability (built into every plan) and Posthog (already chosen per
  `BETA_LAUNCH_CHECKLIST.md:72`, has its own error-tracking module) are both real,
  already-available partial substitutes. Each of the 8 apps has its own `vercel.json` /
  Vercel project — any future tracker wiring is inherently per-app, not monorepo-wide.
- **2026 best-practice for Phase 2, when unblocked:** Sentry ships a hosted MCP server
  (`mcp.sentry.dev/mcp`) that exposes issues/stack traces/breadcrumbs directly into an
  agent's context, plus documented scheduled-triage patterns structurally identical to
  this repo's `babysit-prs`/`qa-loop` sweeps. The Vercel Marketplace also lists Sentry as
  a one-click integration — if/when chosen, it's a Marketplace install, not a bespoke
  build. This is a Phase 2 note only; not built now.

## SEVERITY HEURISTIC (Phase 1 logic — the actual triage rule)

- **P1 (outage):** a write-path `SECURITY DEFINER` RPC failure (e.g. `set_player_status`,
  `admin_settle_player`), OR any error blocking the live casual squad-management flow
  (`apps/inorout`) during an active match window, OR a 5xx/RLS-denial blocking an entire
  route for all users (not one player). A reported "white screen" is treated as de facto
  P1 (no ErrorBoundary exists to catch and downgrade it).
- **P2 (degraded):** a read-path failure with no write impact, a non-blocking RPC failure
  with a working fallback, or an error scoped to one flow/one user (single player, single
  guest row) that doesn't block core availability-marking.
- **P3 (cosmetic):** console warnings, layout/CSS issues, non-blocking React key warnings,
  deprecation notices — no functional user impact.

## SECURITY & REDACTION RULE (non-negotiable, ships in Phase 1)

Grepped `BUGS.md`/`GO_LIVE_ISSUES.md` — the existing convention is tokens discussed
**by parameter name only** (`p_admin_token`, `adminToken`), never by raw value. This skill
extends that discipline to its own output, since it ingests raw pasted text that could
contain a live token/JWT/UUID or under-18 data (`dob`, `guardian_*`, `safeguarding`,
`medical`, `allergies`, `send_notes`):

- **Redact before generating any finding or filing anything** — replace any
  token/JWT/UUID-shaped string with `<param_name redacted>`; replace any DOB/guardian/
  medical/safeguarding field *value* with `<minor-data redacted>`, keeping only the field
  name for classification.
- **Never propose a code/SQL fix in the output** — hypothesis + recommended next action
  only, exactly like `prod-verify`'s T1 pattern. This prevents the skill from ever
  suggesting an insecure shortcut (e.g. "just allow anon read") for what's actually an
  RLS-by-design denial.
- **Any SECURITY or COMPLIANCE-classified finding is a hard stop to human review** — never
  auto-routed to dev-loop without the operator seeing the plain-English recommendation
  first, even at P1.

## ROADMAP

### PR #1 — Phase 1: triage logic skill · TIER-1 · CLEAR
Build `.claude/skills/error-triage/SKILL.md`: input parsing (pasted trace today,
defensive Sentry-URL WebFetch attempt), app/RLS-scope detection (reuse babysit-prs's map),
severity classification (heuristic above), root-cause hypothesis (the grep steps above),
redaction pass, and handoff routing to `/backlog-capture` or `/dev-loop` per the rules
above. Docs-only — no app code, no schema, no RPC. Gates: none (CLEAR, no live surface
touched). Done-check: skill file passes `check-manifest.sh`-equivalent read (it's a skill,
not a data-epic manifest, so the check is "does it declare read-only + hand-off-only
guardrails explicitly, matching prod-verify/babysit-prs house style") + a dry run against
one real pasted stack trace (from BUGS.md's own history, e.g. the mig-070 `is_self` bug)
to confirm the classification lands sensibly.

### PR #2 — File the missing-tracker gap · TIER-1 · CLEAR (docs-only)
Append a GO_LIVE_ISSUES.md entry: "no error tracker wired up → silent RLS/RPC failures in
production have no visibility beyond weekly manual Supabase-log review," separate from and
independent of PR #1 — this gap exists regardless of whether the triage skill ships.
Can be filed via `/backlog-capture` directly instead of a dedicated PR if the operator
prefers (effort: XS).

### 🚦 Phase 2 — Live tracker wiring — BLOCKED, not scoped further
Gated on `BETA_LAUNCH_CHECKLIST.md:75` ("Sentry or equivalent — DECISION NEEDED"). Once a
tracker is chosen: needs API creds/webhook secret **per app** (8 separate Vercel
projects), a webhook receiver (new serverless endpoint — which app hosts it is itself an
open design question, plausibly `apps/hq` given its ops/intelligence role), and a decision
between Sentry-MCP-in-context vs a raw webhook-to-BUGS.md pipe. Ship-safety: PROTECTED
(touches secrets/env + a new endpoint) the moment it's real — re-scope with a fresh
`/scope error-incident-triage-phase2` once the tracker decision lands; do not attempt to
pre-build Phase 2 plumbing against a hypothetical tracker.

## 🚦 GATES the loop must stop at
- PR #1: none functionally gated (docs/skill-file only) — still goes through the normal
  dev-loop PROOF GATE + REVIEW + PR flow, just no migration/RLS/auth/money surface.
- Phase 2: hard-gated on the operator's Sentry-or-equivalent decision. Do not start
  scoping Phase 2 in detail until that decision is made.

## DONE =
PR #1 merged: `/error-triage <pasted stack trace>` produces a redacted, correctly-classified
P1/P2/P3 + app/RLS-scope + grounded root-cause hypothesis (or an honest "needs a repro") +
a `/backlog-capture` or `/dev-loop` recommendation, for a real historical bug replayed as
a dry run. PR #2 merged or captured: the missing-tracker gap has a durable GO_LIVE_ISSUES.md
line. Phase 2 explicitly NOT started — waits on the BETA_LAUNCH_CHECKLIST.md:75 decision.

## Related
- `BETA_LAUNCH_CHECKLIST.md:75` — the blocking decision.
- `.claude/skills/babysit-prs/SKILL.md`, `.claude/skills/prod-verify/SKILL.md`,
  `.claude/skills/backlog-capture/SKILL.md`, `.claude/skills/qa-loop/SKILL.md` — patterns
  this skill reuses (file→app map, T1-hand-off, classify table, tier/ship-safety split).
- `INCIDENT_TRIAGE_HANDOFF.md` — the unrelated venue-safeguarding feature (not this one).
