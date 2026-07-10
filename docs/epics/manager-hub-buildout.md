# Epic: Manager (team_manager) /hub build-out

**Origin:** operator on-device walk of the coach track on a real team (U7 Milan), 2026-07-10.
The coach `/hub` track shipped as a thin read slice (Tonight/League/People + matchday + reliability).
The operator's walk surfaced that the coach's **desktop** view (`apps/inorout/src/views/SessionsScreen.jsx`)
already does far more — and almost all of it is backed by **existing coach-auth `clubManager*` RPCs** the
mobile track simply never surfaced. This epic surfaces them, mirroring the desktop contract 1:1 and keeping
records synced (same RPCs → same tables → desktop and mobile see the same data).

**Guardrails:** reuse existing coach-auth wrappers; no new backend except the two flagged tier-3 phases.
Every screen renders inside `[data-surface="mobile"]`; every new sheet uses the shared `MobileSheet`
(portals to `#m-sheet-host`, clears the docked nav). Next free migration = **526**.

**Merge mode:** per-phase (each phase = its own PR + human merge). Ship-safety: all frontend-only phases
are DARK-for-non-coaches (role-gated) / `check-live-config` CLEAR; the two tier-3 phases hard-stop for sign-off.

**Expected stops:** 4 auto-proceedable-to-PR phases (P1–P4, no backend) + 2 tier-3 phases (P5, P6 — each a
migration, hard-stop for apply sign-off). Every phase ends at a human merge gate.

---

## Phase P0 — DONE
- ✅ PR #419 (merged c466f498): People rows → member-detail sheet; Tonight fixtures → Matchday.

## Phase P1 — Coach "More" launcher + Comms — `pending`
**deps:** none
Replace the dead `team_manager` More→profile route with a real launcher (`TeamManagerMore.jsx`, mirrors
`ClubAdminMore.jsx`) whose first live destination is **Comms** (`TeamManagerComms.jsx`): compose title+body →
`clubManagerSendAnnouncement(teamId, title, body)` (mirrors SessionsScreen `handleSendTeamMessage`, double-fire
guard, both fields trimmed+required, sent/error status). Team switcher when the coach runs 2+ teams. Wire
MobileShell: render `TeamManagerMore` for `team_manager` + `more` (sub-views: comms, later training/payments),
keep Profile row → shell profile sheet. Rows for not-yet-built P2–P4 shown as "Soon" (OperatorMore pattern).
**No backend.**

## Phase P2 — Training: list + add + cancel — `pending`
**deps:** P1
Surface **upcoming training** on Tonight (and a Training More sub-screen): reader for the coach's team sessions
(reuse `memberListUpcomingSessions` via the team's cohort, or thinnest coach reader if needed — verify at audit).
Add session (`clubManagerCreateSession`) + recurring series (`clubManagerCreateSessionSeries`) + cancel
(`clubManagerCancelSession`), mirroring SessionsScreen's create/series/cancel forms 1:1 (same fields/enums).
Add-forms use pinned-footer `MobileSheet`. **No backend** (verify the session reader path at audit; if a team-scoped
coach reader is missing, that's the one possible flag).

## Phase P3 — Fixture editing (home fixtures) — `pending`
**deps:** P1
In the League/Matchday flow, let the coach edit **home** fixtures — pitch/ref/kickoff only (away is operator-owned
by design): `clubManagerGetHomeFixtureOptions` + `clubManagerUpdateHomeFixture`. Mirror the desktop guarded-write
contract exactly (throws slot_unavailable / away_read_only etc → surface as friendly errors). **No backend.**

## Phase P4 — Payments view — `pending`
**deps:** P1
Payments More sub-screen: who's-paid / who-owes for the coach's team via `clubManagerTeamPayments(teamId)` (read-only),
mirroring SessionsScreen's payments panel + its "reminders go out automatically" framing. **No manual nudge** —
desktop deliberately has none (auto-reminder cron); a manual chase would put mobile ahead of desktop. **No backend.**

## Phase P5 (TIER-3) — mig 526: roster player-tap detail everywhere — `pending`
**deps:** P0
Add `member_profile_id` to each roster entry in `club_manager_list_team_fixtures` (mig 451 → **mig 526**, additive
field — no consumer breaks). Extract #419's `MemberDetailSheet` to a shared component; wire it on Tonight's hero
roster + League's expanded roster so tapping any availability row opens the same detail sheet as People.
**Migration — drafts + EV-proven, HARD-STOP for apply sign-off.**

## Phase P6 (TIER-3) — coach team invite / join link — `pending`
**deps:** none
`clubEnsureTeamInviteLink` is venue-token (club-admin) — a coach holds no venue token. Add a coach-auth
`club_manager_ensure_team_invite_link(p_team_id)` (mirrors the venue-token twin, manager-gated via auth.uid →
club_team_managers) + a share/copy UI on People or More. **Migration — drafts + EV-proven, HARD-STOP for sign-off.**

---

## Log
- 2026-07-10: epic opened after U7 Milan walk. P0 (#419) merged. Starting P1.
