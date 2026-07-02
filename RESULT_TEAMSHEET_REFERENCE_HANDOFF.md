/dev-loop RESULT_TEAMSHEET_REFERENCE_HANDOFF.md

# Result-entry teamsheet reference — HANDOFF

Plan gate: batched
Merge mode: per-phase

## WHAT IT IS

When a team admin logs a match result in `ScoreScreen.jsx` ("Log Result" → Exact
Score / Won By / Declare), they're asked to pick which team won (Team A or Team
B) with **no reminder of who was actually on each team**. If they can't recall
the split from memory, there's currently no reference on screen to check against
— they have to rely on a screenshot, a WhatsApp message, or guessing.

This happened live: the operator logged yesterday's result, hit "Won By", and
had no way to tell which team was which because the live team split had
already been reset (correctly, as part of setting up the next match) by the
time they got round to entering the result.

**Fix:** show a small, always-visible "Team A vs Team B" reference panel during
the winner-selection stage of result entry, sourced from data that survives a
team reset — not from the live, resettable `players.team` column.

**Target user:** team admin (the only person who ever opens ScoreScreen).
**Job to be done:** "let me check who was on which team while I'm picking the
winner, without leaving this screen or hunting for a screenshot."

## LOCKED DECISIONS

- The reference panel shows player names grouped under "TEAM A" / "TEAM B"
  headers, colour-coded `#60A0FF` / `#FF6060` (the two hardcoded hex colours
  already sanctioned in CLAUDE.md CONVENTIONS) — visually consistent with the
  existing Stage-3 "Team Switches" block and `HistoryView.jsx`'s "🔵 TEAM A /
  🔴 TEAM B" roster columns.
- The panel appears during **Stage 2** (the mode/winner-selection stage —
  Exact Score, Won By, Declare) — i.e. moved earlier than where a roster is
  currently shown (Stage 3, "Team Switches", which only renders *after* the
  winner is already picked — too late to help).
- **Data source is the per-match snapshot, not live state.** `ScoreScreen.jsx`'s
  existing `origTeamAPlayers`/`origTeamBPlayers` (`ScoreScreen.jsx:207-208`)
  derive from `inPlayers` filtered on the live, denormalised `players.team`
  column — which a *later, unrelated* "Clear Teams" confirm (for the next
  match) legitimately nulls out for the whole squad. The new panel must
  instead resolve names from `potmMatch.teamA` / `potmMatch.teamB`
  (`ScoreScreen.jsx:197-199`, backed by `matches.team_a`/`team_b` — the
  immutable snapshot written once at pre-kickoff team-confirm time, per
  `admin_save_teams`, and never touched by a later match's team reset) against
  the current `squad` array to resolve IDs → display names. This is the actual
  root-cause fix, not just a UI reshuffle — reusing live `players.team` again
  would silently reproduce the exact bug that prompted this.
- No new RPC, no schema change, no migration. `matches.team_a`/`team_b` are
  already fetched into `matchHistory` (`getMatches` → `dbToMatch`,
  `packages/core/storage/supabase.js:297-300`) and already reach `ScoreScreen`
  as `potmMatch` (`ScoreScreen.jsx:197-199`). This is a pure frontend read +
  render change.
- **Known limitation, confirmed acceptable:** `matches.team_a`/`team_b` store
  player *IDs* only. If a player has since been fully removed from the squad
  (not just moved to reserve/dormant), their ID won't resolve to a name via
  `squad.find`. Fall back to a plain "(former player)" label rather than
  dropping the row silently — so the panel still shows the correct headcount
  per side even if a name can't be resolved. This is a pre-existing edge case
  (HistoryView has the same limitation) and not a blocker for this PR.

## KEY AUDIT FACTS

- Sole result-entry component: `apps/inorout/src/views/AdminView/ScoreScreen.jsx`,
  mounted from `apps/inorout/src/views/AdminView/index.jsx:502`.
- Stage 2 (winner selection) renders at `ScoreScreen.jsx:491-570` (`mode ===
  "margin"` / `"declared"` blocks); Stage 3 ("Team Switches", roster already
  rendered but too late) at `ScoreScreen.jsx:575-618+`.
- `currentTeam(p)` (`ScoreScreen.jsx:176-179`) reconciles live team vs
  in-progress switches — untouched by this change; the new reference panel is
  read-only display, it does not feed `handleSave`.
- `admin_save_teams` RPC (`rls_migrations/048_admin_save_teams_scope_team_set.sql`)
  confirms: `p_confirm=true` writes `matches.team_a`/`team_b` for **that
  specific `v_match_id`** permanently, and separately nulls-then-sets
  `players.team` for the whole squad. A later confirm call for a *different*
  match (the normal "set up next week's teams" flow) only touches
  `players.team` — it does not rewrite the previous match's already-saved
  `matches.team_a`/`team_b`. That's exactly why sourcing from `potmMatch`
  instead of live `players.team` fixes the bug.
- `HistoryView.jsx:137-138,404-405` already has the exact "🔵 TEAM A / 🔴 TEAM
  B" roster-column visual pattern this PR should mirror stylistically (post-
  game view, same data shape: `teamA`/`teamB` ID arrays resolved to names).
- No open BUGS.md entry for this — it's a fresh report from this session, not
  a regression of a known issue.
- Downstream consumers: none — this is a local render inside `ScoreScreen`,
  not a new RPC or return shape, so Hard Rules #12/#14 don't apply.

## ROADMAP

### PR #1 — Teamsheet reference panel on result-entry winner selection

TIER-1 · CLEAR (frontend-only, no migration, no RPC, no schema change)

In `ScoreScreen.jsx`:
1. Add a small helper that resolves `potmMatch?.teamA` / `potmMatch?.teamB`
   (arrays of player IDs) against `squad` to build `{ id, name }` lists,
   falling back to `"(former player)"` for unresolved IDs.
2. Render a compact "TEAM A / TEAM B" reference panel (reusing the existing
   Stage-3 two-column style at `ScoreScreen.jsx:588-593`) inside the Stage-2
   `StageCard`, above or alongside the `"Which team won?"` / `"WHO WON?"`
   controls, for all three modes (exact/margin/declared) — visible the moment
   `mode` is picked, before a winner is selected.
3. Leave `origTeamAPlayers`/`origTeamBPlayers` and the Stage-3 panel exactly as
   they are (Stage 3 remains sourced from live `players.team`, since Team
   Switches is legitimately about the live/current assignment) — this PR only
   adds the new Stage-2 panel sourced from `potmMatch`.

Gates: `bash skills/scripts/check-build.sh` (apps/inorout) · hygiene 7/7 on the
changed file · Playwright smoke: open Log Result, confirm the teamsheet panel
renders correctly for a match, then simulate the reported scenario (clear/reset
teams for a *different*, later match) and confirm the panel still shows the
original match's correct split · no console errors.

Done-check: with teams reset for the next match, opening "Log Result" on the
prior match still shows the correct Team A / Team B split before a winner is
picked.

## 🚦 GATES the loop must stop at

None expected to be tier-3 — this PR is frontend-only, no migration/RLS/money/
auth/native surface touched. If dev-loop's audit step finds this can't be done
without touching `players.team` semantics, STOP and re-scope rather than fall
back to the live-state source (that would silently reintroduce the bug).

## DONE =

PR merged; a real admin can open "Log Result" on a past match — even after
teams have since been reset/cleared for a newer match — and see the correct
Team A vs Team B split on screen throughout the winner-selection step, with no
screenshot or memory required.

## Related

- No open FEATURES.md/BUGS.md row — net-new, small fix-and-improve reported
  live this session.
- Builds on existing `HistoryView.jsx` roster-column pattern and the existing
  (but too-late-in-the-flow) Stage-3 panel in `ScoreScreen.jsx`.
