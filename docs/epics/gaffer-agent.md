# Epic manifest — Gaffer Phase 1 (read-only assistant)
- Epic: Ship the Gaffer Phase-1 read-only AI assistant, canaried on team_demo — the
  4 context RPCs + ai_briefings audit table + the edge function + 5 admin surfaces,
  answer-only (zero writes). "Done" = an admin on the canary team can open each surface
  and get a grounded, audited briefing; Phase-1 exit-criteria monitoring is then handed
  to the operator. Spec: GAFFER.md ("FOUR-PHASE ROLLOUT" → Phase 1, "SURFACES — DETAILED").
- Plan gate: batched
- Approved: 2026-06-29

## Phases   (status: pending | in-progress | done | blocked: <why> | needs-human: <what>)

### P0 — Land Stage 1 on main
- status: done
- deps: none
- goal: PR #151 (Stage 1 casual-canary wiring) merged to main, so later phases branch
  off a main that already has the ENABLE_GAFFER→VITE_GAFFER_ENABLED gate + GafferCard.
- tier-3 touch: outward (merge — human)
- proof: `git log origin/main` shows the Stage 1 commit; gates already passed on #151.
- PR: #151

### P1 — ai_briefings audit table + RLS
- status: needs-human: scope decision — table already live (mig 033); only the HQ read policy is missing, and it's likely premature. See audit note below.
- deps: P0
- goal: Create the `ai_briefings` table + index + RLS (admins read own team; players
  read audience='player' AND own player_id; HQ reads audience='hq' for their companies).
- tier-3 touch: migration + RLS  →  DRAFT-BUT-ASK (write .sql + _down.sql, get sign-off, do not apply)
- proof: check-db-schema after apply; RLS policies present; ephemeral-verify of read scoping.
- AUDIT (2026-06-29): `ai_briefings` is ALREADY LIVE from migration 033 (built s33, never
  canaried, 0 rows). Verified against the live DB: table + all 15 cols (incl. a bonus
  `question` col for qa), both indexes (`team_surface_idx`, `team_match_idx`), RLS enabled,
  AND the admin-read + player-read policies all present. So the table/index/admin+player-RLS
  parts of this phase are DONE. The ONLY delta vs the goal is the **HQ read policy**
  (`audience='hq'`), and it is blocked on a design decision:
    (a) `teams` has NO `company_id` column — there is no clean team→company join to scope
        HQ rows by; would need a join path that doesn't yet exist (`company_admins` exists
        but no team→company link on `teams`).
    (b) HQ surfaces (`hq_weekly_digest`) are Phase 3, not Phase 1 — an HQ read policy now is
        a no-op (no `audience='hq'` rows exist until Phase 3).
  RECOMMENDATION: treat the table/index/admin+player RLS as satisfied by mig 033, and DEFER
  the HQ read policy to the Phase-3 epic, where the team→company resolution gets designed
  alongside `hq_weekly_digest`. No new migration drafted (re-creating the table would be
  wrong; the HQ policy needs the deferred design). NEEDS-HUMAN: confirm defer-HQ-to-Phase-3
  (→ P1 done, unblocks P2), or instruct to draft the HQ policy now with a chosen join path.

### P2 — Phase-1 context RPCs
- status: pending
- deps: P1
- goal: Build the 4 SECURITY DEFINER read RPCs that derive team scope from p_admin_token
  and each return one jsonb: gaffer_get_team_summary, gaffer_get_payment_summary,
  gaffer_get_attendance_risk, gaffer_get_matchday_briefing. Plus a server-side
  briefing-logger RPC for the edge fn to INSERT ai_briefings.
- tier-3 touch: migration + RLS  →  DRAFT-BUT-ASK
- proof: check-rpc-security each RPC + check-rpc-columns + ephemeral-verify (read-only,
  scoped to an _e2e_ fixture). Record consumers in RPCS.md (Hard Rule 14).

### P3 — System prompts per surface
- status: done
- deps: none (parallelisable with P1/P2; consumed by P4)
- goal: Versioned system-prompt strings at apps/inorout/src/views/Gaffer/prompts/<surface>.js
  for team_summary, payment_summary, attendance_risk, matchday_briefing, qa.
- tier-3 touch: none (tier-1, frontend-only)
- proof: node --check + check-hygiene; build green.
- AUDIT (2026-06-29): ALREADY BUILT (s33 era) and live on main. All 5 surface prompts
  (team_summary, payment_summary, attendance_risk, matchday_briefing, qa) + base.js
  (shared BASE_SYSTEM_PROMPT) + index.js (surface→{SYSTEM_PROMPT,PROMPT_KEY} lookup) exist,
  tracked & clean, each versioned `.v1`, spec-aligned with GAFFER.md. Proof: git status
  clean; node --check passed all 7; check-hygiene passed all 7. Zero changes needed → no PR.

### P4 — Edge function
- status: pending
- deps: P1, P2, P3
- goal: The Vercel edge fn (apps/inorout/api/_agent.js — reconcile vs GAFFER.md's
  gaffer.js naming during audit): verify adminToken→team_admins (else 401) → call the
  matching context RPC → resolve prompt by surface → call Vercel AI Gateway
  (claude-sonnet-4-6) → log via the P2 briefing RPC → return {content,briefingId,cachedAt}.
  Implement the GAFFER.md caching policy.
- tier-3 touch: secret (AI Gateway / Anthropic key) + outward (deploy)  →  DRAFT-BUT-ASK
- proof: local invocation against an _e2e_ fixture; never deploy or wire a live key
  without sign-off. No key committed (Hard Rule: no versioned credentials).

### P5 — Admin surfaces (frontend)
- status: pending
- deps: P4
- goal: Wire the 5 read-only surfaces to the edge fn — Q&A panel in AdminView (replace
  the disabled Gaffer/index.jsx scaffold), team-summary card on admin home (extends the
  Stage-1 GafferCard), payment-summary card on PaymentsScreen, attendance-risk banner,
  matchday-briefing modal. Each is independently shippable; split into sub-PRs if large.
- tier-3 touch: none (tier-1, frontend-only)
- proof: node --check + check-hygiene + check-build + Playwright smoke of each surface
  behind VITE_GAFFER_ENABLED; casual-regression (touches apps/inorout/src).

### P6 — Light the canary
- status: pending
- deps: P1, P2, P4, P5
- goal: Enable on team_demo only — INSERT the ai_agent_access opt-in row + set
  VITE_GAFFER_ENABLED=true on the Vercel Preview env.
- tier-3 touch: migration (ai_agent_access INSERT) + outward (env flip)  →  DRAFT-BUT-ASK + needs-human
- proof: ai_agent_access row present for team_demo; real-device admin walk of one surface
  (human-test checkpoint).

### P7 — Phase-1 exit-criteria monitoring
- status: needs-human: operator-run observation, not a build phase
- deps: P6
- goal: 4 weeks across ≥3 real teams, <1% factual error vs context_snapshot, PostHog
  gaffer_briefing_useful >60% positive. This gate unlocks the Phase-2 epic.
- tier-3 touch: outward
- proof: operator review of ai_briefings + PostHog.

## Log
<!-- one line per phase outcome: date · phase · result · PR# -->
- 2026-06-29 · P0 · Stage 1 (casual-canary wiring) merged to main · PR #151
- 2026-06-29 · P1 · AUDIT: table+indexes+admin/player-RLS already live (mig 033); only HQ read policy missing + likely premature → needs-human scope decision (defer HQ to Phase 3?). No migration drafted. · n/a
- 2026-06-29 · P3 · DONE — already built/live on main (s33): 5 surface prompts + base + index, all .v1, spec-aligned. Proof: git-clean + node --check ×7 + hygiene ×7. Zero changes. · n/a
- 2026-06-29 · HEADS-UP (not yet audited): migs 034–037 (gaffer_get_context_*) already exist — P2's 4 context RPCs are likely already built too (naming `gaffer_get_context_<surface>` vs manifest's `gaffer_get_<surface>` to reconcile; briefing-logger RPC may still be the only true gap). P2 is blocked on P1 regardless. · n/a
