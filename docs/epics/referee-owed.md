# Epic manifest — Referee track: owed follow-ons
- Epic: Close the four owed items on the `/hub` referee track (the main track shipped in
  migs 440–443 / PRs #135–139). "Done" = a referee on `/hub` has a shared Live-Match
  sheet, can compose a broadcast, their officiating history includes tournament games,
  and ref ratings exist end-to-end. Spec: `REFEREE_HANDOFF.md`. Referee surface lives in
  `apps/inorout/src/mobile/` (RefFixtures.jsx, RefMatch.jsx), amber-scoped (referee
  role), iframes `apps/ref` UNCHANGED.
- Plan gate: batched
- Merge mode: per-phase   (this is the unmanned-loop shakedown — one merge tap per phase, on purpose)
- Approved: 2026-06-30

## Phases   (status: pending | in-progress | done | blocked: <why> | needs-human: <what>)

### P1 — Shared Live-Match sheet
- status: pending
- deps: none
- goal: Extract the referee Live-Match view (RefMatch.jsx) into a shared sheet component
  so the same live-match surface can be reused (referee + broadcast/operator). No
  behaviour change for the referee path; this is the foundation P2/P4 build on.
- tier-3 touch: none (tier-1, frontend-only)
- proof: node --check + check-hygiene + check-build + Playwright walk of the referee
  live-match screen (`ref_demo_referee_live`) unchanged; casual-regression (touches
  apps/inorout/src/); check-live-config = PROTECTED → real-device referee walk owed at merge.

### P2 — Broadcast composer
- status: pending
- deps: P1
- goal: Let the referee compose + post a broadcast from the live match. REUSE the
  existing broadcast/realtime publisher (notify_team_change / realtime.send) + its App.jsx
  subscriber — do not build a parallel system (verify the matching subscriber per Hard
  Rule 10). New write RPC only if no existing one fits.
- tier-3 touch: none if it reuses an existing RPC; RLS/RPC (draft-but-ask) if a new
  write RPC is needed → then check-rpc-security + ephemeral-verify + audit_events insert.
- proof: as P1 + (if RPC) rpc-security + ephemeral-verify; confirm publisher↔subscriber match.

### P3 — Tournament arm of get_my_officiating_history
- status: pending
- deps: none
- goal: Extend the officiating-history reader (mig 441, currently league+casual only) to
  UNION tournament fixtures (identical per-game shape, via fixtures.official_id parallel
  reader — mig 372 untouched, Swift-safe). The "Past" section then shows tournament games.
- tier-3 touch: migration + RLS (SECURITY DEFINER return-shape ADD) → DRAFT-BUT-ASK
- proof: check-rpc-security + check-rpc-columns + ephemeral-verify (read-only, _e2e_
  fixture); **grep the RefFixtures.jsx consumer for the return shape (Hard Rule 12/14)**;
  RPCS.md consumer note. Intent-question at the gate: "history now includes tournament
  games the ref officiated — intended? y/n".

### P4 — Ref ratings
- status: pending
- deps: P1
- goal: Greenfield ref-ratings: a ratings table + a write RPC (rater scoped via token /
  auth.uid, audit_events insert per Hard Rule 9) + the rating UI on the shared Live-Match
  sheet (P1). Reliability/POTM exclusion N/A (referee, not player).
- tier-3 touch: migration + RLS + write RPC → DRAFT-BUT-ASK
- proof: check-rpc-security + ephemeral-verify (own _e2e_ fixture, auto-rollback,
  leak-check) + check-build + Playwright; casual-regression; real-device walk at merge.

## Log
<!-- one line per phase outcome: date · phase · result · PR# -->
