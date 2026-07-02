# Epic manifest — Gaffer launcher UI (design-handoff build)

- Epic: Replace the always-visible flat Gaffer Q&A panel with the design-handoff
  orb launcher + bottom-sheet chat UI (`design_handoff_gaffer/`), wired to the
  existing admin-only backend first (PR #1/#2), then widen the same UI to
  players via the Universal Agent Foundation's `resolve_agent_caller` (PR #3).
  Spec: `GAFFER_UI_HANDOFF.md` (root), `design_handoff_gaffer/README.md`.
- Plan gate: batched
- Merge mode: per-phase
- Approved: 2026-07-02

## Phases   (status: pending | in-progress | done | blocked: <why> | needs-human: <what>)

### P1 — Orb launcher + drag/snap + chat-sheet chrome
- status: pending
- deps: none
- goal: New `GafferLauncher` component (68px orb, idle/nudge/listening/dragging
  states, drag-to-reposition + edge-snap + `localStorage['gafferCorePos']`,
  tap-vs-drag threshold, 64%-height bottom sheet wrapping the existing
  `Gaffer/index.jsx` message/composer logic). `gaffer-tokens.css` island
  (Locked Decision #2). Dark-mode only (Locked Decision #4). Reduced-motion
  respected. Same flag/gate as today (`ENABLE_GAFFER && isAdmin`).
- tier-3 touch: none (frontend-only, same backend/flag/audience as live today)
- proof: check-build.sh · check-hygiene.sh on all new/changed files ·
  check-references.sh "Gaffer" (old panel fully replaced) · manual:
  VITE_GAFFER_ENABLED=true + admin session shows orb not old panel; drag
  persists across reload; tap opens sheet; real Q&A round-trip via
  askGafferQuestion; flag off → zero DOM footprint.
- PR:

### P2 — Real nudge triggers (replace the demo timer)
- status: pending
- deps: P1
- goal: Replace the 8.5s demo timer with real event hooks scoped to admin
  audience (squad shortfall, unread team chat, subs due) using data already
  loaded into admin state.
- tier-3 touch: none expected — escalate to DRAFT-BUT-ASK if audit finds a new
  read RPC is required (decide during this phase's own audit, not now)
- proof: check-build.sh · check-hygiene.sh · manual: nudge fires only on a
  real qualifying event in a real (non-demo) team; dismisses correctly; no
  console errors when triggering data absent.
- PR:

### P3 — Widen Gaffer to players, scoped by role
- status: pending
- deps: P1
- goal: Rewire `/api/gaffer` + `gaffer_qa` RPC to resolve caller via
  `resolve_agent_caller` (migration 454) instead of admin_token-only. Define
  per-role field scoping on `gaffer_get_context_*` (admin = team-wide, player
  = self + team-public only). Flip App.jsx gate from `ENABLE_GAFFER && isAdmin`
  to `ENABLE_GAFFER`. No new UI — same `<GafferLauncher>` from P1.
- tier-3 touch: RLS + auth/caller-identity resolution → DRAFT-BUT-ASK, full
  security gate required
- proof: rpc-security-sweep.md + ephemeral-verify.md (new caller-resolution
  path) + casual-regression.md (touches apps/inorout/src) + manual: a
  player-token session gets answers scoped to own data only, verified by
  attempting to ask about another player's private info and confirming it's
  absent from context (not just verbally declined).
- PR:

## Log
<!-- one line per phase outcome: date · phase · result · PR# -->
