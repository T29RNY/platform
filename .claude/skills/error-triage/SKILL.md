---
name: error-triage
description: Structured engineering triage for a pasted stack trace / error message (or, once a tracker is chosen, a Sentry-or-equivalent issue URL). Classifies severity (P1 outage / P2 degraded / P3 cosmetic), the affected app + RLS/security scope, a grounded root-cause hypothesis, and a recommended next action — file via /backlog-capture or open a /dev-loop defect-fix phase directly. Use when the operator pastes a crash report, an error message, a stack trace, or a tracker issue URL and wants it triaged. Read-only investigation — never edits code, never applies a migration, never fixes anything itself; ERROR_INCIDENT_TRIAGE_HANDOFF.md is the scope record. No tracker (Sentry or equivalent) is wired up in this repo yet (BETA_LAUNCH_CHECKLIST.md — DECISION NEEDED); a Sentry-shaped URL is accepted defensively but only pasted text is a reliable input today.
---

# error-triage — structured engineering triage for a pasted error or issue URL

Takes one error (pasted stack trace / console message / network error, or a tracker
issue URL) and produces a triage: **severity**, **app + RLS/security scope**, a
**grounded root-cause hypothesis**, and a **recommended next action**. It never fixes
anything — same read-only, hand-off-only discipline as `.claude/skills/prod-verify/
SKILL.md` and `.claude/skills/babysit-prs/SKILL.md`. Scoped in
`ERROR_INCIDENT_TRIAGE_HANDOFF.md` — read it for the full rationale; this file is the
thin, invocable version of that plan.

> ⚠️ Not the same feature as `INCIDENT_TRIAGE_HANDOFF.md` (venue-safeguarding incident
> queue, migs 461–469). This triages **engineering errors/exceptions**, not venue
> safety incidents.

## THE BLOCKER THIS SKILL WORKS AROUND

No error tracker (Sentry or equivalent) is wired up anywhere in this repo —
`BETA_LAUNCH_CHECKLIST.md` still lists it as "DECISION NEEDED" — and there is no
`ErrorBoundary` and no global `window.onerror`/`unhandledrejection` handler in `apps/`
or `packages/`. So **the only reliable input today is pasted text**: the crash-report
path the checklist already defines ("screenshot + WhatsApp message + don't refresh").
A Sentry-shaped issue URL is accepted defensively (attempt a `WebFetch` of the public
page) but if that fails auth, ask the operator to paste the trace body instead — never
block on a tracker that doesn't exist yet.

## STEP 0 — MANDATORY REDACTION (do this before anything else, always)

The input may contain a live token, JWT, UUID, or under-18/medical field value. Before
generating any finding, hypothesis, or filed row:

- Replace any token/JWT/UUID-shaped string with `<param_name redacted>` — keep the
  parameter name (`p_admin_token`, `adminToken`, `auth.uid()`) for classification,
  never the value. This matches the existing convention in BUGS.md/GO_LIVE_ISSUES.md,
  which already discuss tokens by parameter name only.
- Replace any value for `dob`, `date_of_birth`, `guardian_*`, `safeguarding`,
  `medical`, `allergies`, `send_notes`, or other `member_profiles`/`players`
  under-18/health fields with `<minor-data redacted>` — keep only the field name.
- If redaction would strip the entire useful signal (e.g. the trace IS a token value
  with no surrounding context), say so and ask for a redacted re-paste rather than
  guessing.

Every step below operates on the REDACTED text only.

## STEP 1 — PARSE THE INPUT

- **Pasted stack trace / error text (the default, reliable path):** extract a file
  path (`apps/*/src/...` or `packages/core/...`), an error type (`TypeError`,
  a Postgres code like `42501`/`PGRST301`), an HTTP status (401/403/404/500) if
  present, and the route/screen it fired on if stated.
- **Sentry-shaped URL** (`sentry.io/organizations/*/issues/<id>` or similar): attempt
  a `WebFetch` of the public page and extract the same fields. On auth failure or an
  unreachable/private page, say so and ask the operator to paste the trace body
  instead — do not fabricate fields from the URL alone.
- **TODO for when a tracker is chosen (Phase 2, not built):** swap this step for the
  tracker's issue-fetch API (needs an auth token + org/project slug). Everything from
  STEP 2 onward is unchanged — this parse step is the only seam.

## STEP 2 — APP + RLS/SECURITY SCOPE (reuse babysit-prs's map, don't reinvent)

Map any file path in the trace to its app, same table `babysit-prs` uses:
`apps/inorout`→platform-clubmanager (live casual app) · `apps/venue`→platform-venue ·
`apps/ref`→platform-ref · `apps/display`/`apps/hq`/`apps/clubmanager`/`apps/league`/
`apps/superadmin`→their own deploys. `packages/core`/`packages/ui` in the trace widens
scope to every consuming app (grep the changed export if unsure which apps use it).

If no file path is present (pure console/network message), fall back to route
heuristics: `/p/<token>` → anon player route, `/admin*` / `p_admin_token` → admin
token route, an authenticated Supabase JWT with no token param → authenticated route.

RLS/security classification, grounded in CLAUDE.md's RLS checklist:
- `PGRST301` / `42501` / "permission denied for table" → the RLS wall working as
  designed — likely a missing-RPC bug, **not** a security hole. Say so explicitly so
  the fix direction is "route through a SECURITY DEFINER RPC," never "loosen RLS."
- `supabase.rpc(...)` on the stack → grep the function name against
  `packages/core/storage/supabase.js` to identify the wrapper, which tells you
  whether it's the anon-token, authenticated, or admin-token variant.
- A pure frontend frame (React render error, no network call) → client-only, no RLS
  surface.

**Never suggest a code or SQL fix here** — hypothesis and scope only. If the finding
touches auth/RLS/tokens, flag it for human review regardless of severity (STEP 5).

## STEP 3 — SEVERITY (P1 / P2 / P3 — flat, no richer scheme)

- **P1 (outage):** a write-path `SECURITY DEFINER` RPC failure (e.g.
  `set_player_status`, `admin_settle_player`), any error blocking the live casual
  squad-management flow (`apps/inorout`) during an active match window, or a
  5xx/RLS-denial blocking an entire route for all users. A reported "white screen" is
  treated as de facto P1 — there's no ErrorBoundary to catch and downgrade it.
- **P2 (degraded):** a read-path failure with no write impact, a non-blocking RPC
  failure with a working fallback, or an error scoped to one flow/one user.
- **P3 (cosmetic):** console warnings, layout/CSS issues, non-blocking React key
  warnings, deprecation notices — no functional user impact.

## STEP 4 — ROOT-CAUSE HYPOTHESIS (grep first, never free-associate)

1. Grep the error's function/RPC name against `BUGS.md` and `GO_LIVE_ISSUES.md` — is
   this already a known issue? (Same dedup discipline as `backlog-capture` STEP 4.)
2. Grep `rls_migrations/` and `packages/core/storage/supabase.js` for the current
   signature of the implicated function; compare argument order/types against what
   the trace shows was called (Hard Rule 7's call-site check, run backwards from a
   failure).
3. `git log --oneline -- <file>` on the implicated file — did this regress after a
   recent commit?
4. If none of the above surfaces a clear cause, **say so explicitly**: "no matching
   known bug, no recent commit to this file, no signature mismatch found — root cause
   is a judgment call, needs a repro." A named uncertainty beats a fabricated cause.

## STEP 5 — RECOMMENDED NEXT ACTION

- **P1, OR a TIER-3 surface (migration/RLS/money/auth) with a clear, reproducible root
  cause** → recommend `/dev-loop <the defect + its done-check>`, same pattern
  `prod-verify` uses for T1 findings. Note that a TIER-3 fix still needs human sign-off
  inside dev-loop's own plan gate — this skill does not grant that sign-off.
- **P2/P3, or root cause is not clear** → recommend
  `/backlog-capture <the finding>`, classified with backlog-capture's own table:
  `bug` (default), `⚠️ SECURITY` (auth/RLS/token/SECURITY DEFINER signal), or
  `📋 COMPLIANCE` (under-18/consent/health/App-Store signal). When ambiguous, prefer
  the more consequential class: security > compliance > bug.
- **Any SECURITY or COMPLIANCE classification is a hard stop to human review** — state
  the recommendation in plain English and let the operator decide; never silently
  auto-open a dev-loop phase for an auth/RLS/token/under-18 finding, even at P1.
- This skill never fixes anything itself. Its output ends at the recommendation.

## OUTPUT FORMAT

```
ERROR-TRIAGE — [date]

INPUT:     [pasted trace / issue URL] — redacted: [n] token(s), [n] minor-data field(s)
APP:       [app] → [Vercel project] · SCOPE: [anon / authenticated / admin-token / client-only]
SEVERITY:  P1 / P2 / P3 — [one-line why]
ROOT CAUSE: [grounded hypothesis with the grep evidence] OR [honest "needs a repro"]
ACTION:    /dev-loop <...>  OR  /backlog-capture <...>  [+ SECURITY/COMPLIANCE flag if any]
```

## GUARDRAILS (never relaxed)
- **Read-only** — never edits code, never applies a migration, never merges, never
  fixes anything in place. Its only output is the triage + a recommended command for
  the operator (or a downstream skill) to run.
- **Redact first, always** — STEP 0 runs before any other step, no exceptions.
- **Never propose a code/SQL fix** — hypothesis and next-action only.
- **Auth/RLS/token/compliance findings always surface to the operator**, never silently
  routed, regardless of severity.
- **No tracker API calls** — until a tracker is chosen (BETA_LAUNCH_CHECKLIST.md), the
  only network call this skill makes is a defensive `WebFetch` of a public issue-page
  URL, and only when the input looks like one.

## INVOCATION
- `/error-triage <paste the stack trace / error text>` — the default path.
- `/error-triage <tracker issue URL>` — attempts a public-page fetch; falls back to
  asking for pasted text.

## Related
- `ERROR_INCIDENT_TRIAGE_HANDOFF.md` — the scope record (rationale, phase split, what's
  deliberately deferred to Phase 2).
- `.claude/skills/babysit-prs/SKILL.md` — the app-detection map this reuses.
- `.claude/skills/backlog-capture/SKILL.md` — the classify table this reuses.
- `.claude/skills/prod-verify/SKILL.md` — the T1-hand-off pattern this mirrors.
