# In or Out — Known Bugs & Tech Debt
*Last updated: May 23 2026 (session 35 — +B6 PlayerView direct matches read 401)*

**Read this at the start of every session before touching any code.**

---

## LOW — Known workarounds exist

### 1. BibsScreen standalone write broken under RLS
**File:** `apps/inorout/src/views/AdminView/BibsScreen.jsx`
**Detail:** BibsScreen bib assignment lacks `matchId` + `adminToken` in scope.
Direct `insertBib` write is blocked by RLS.
**Workaround:** Bibs can be set via ScoreScreen result save (has both). Standalone
BibsScreen assignment is non-functional post-RLS.
**Fix:** Thread `adminToken` + `matchId` into BibsScreen; replace `insertBib` with
`admin_save_bib_holder` RPC call.

### 2. `player_career` mostly empty
**Detail:** Only `total_bib_count` is ever written. 11 other career fields (`total_games`,
`total_wins`, `total_losses`, `total_draws`, `total_goals`, `total_motm`,
`career_win_rate`, `career_reliability`, `career_impact`, `best_team_id`) are permanently
null/zero. Table exists but provides no value until Phase 2 career sync is built.

### 3. `team_demo` has no `team_admins` row
**Detail:** Demo team predates the `team_admins` table. Multi-team switcher won't show
`team_demo` for Tarny's account until backfilled. No impact on real teams.
**Fix:** `INSERT INTO team_admins (team_id, user_id) VALUES ('team_demo', '<tarny_user_id>');`

### 4. `scoring.js` filename mismatch
**File:** `packages/core/engine/scoring.js`
**Detail:** File hosts `periodCutoff` (a non-scoring helper) alongside `hasGoalData` +
`resolveDominantType`. Low priority until file grows further.
**Fix:** Rename to `stats-helpers.js` when adding more helpers.

### 5. Cross-browser / in-app-webview install loses token breadcrumb
**Files:** `apps/inorout/src/App.jsx` (getRoute), `apps/inorout/src/views/JoinSuccess.jsx`,
`apps/inorout/src/views/SquadReady.jsx`
**Detail:** Token persistence relies on `localStorage` (`ioo_last_visited` / `ioo_redirect_to`).
localStorage is scoped per-browser-per-origin, so the breadcrumb is lost when the user
crosses browser contexts between joining and installing:
- User opens invite link in an in-app webview (Gmail, WhatsApp, Facebook, Slack), then
  taps "open in Chrome" or installs from a different browser → fresh storage, no entry.
- User joins in Chrome but installs the PWA from Samsung Internet / Firefox Android.
- Same flow on iOS in-app webviews (still hits the redirect bridge, but only if the
  install actually happens inside Safari).
Result: installed PWA opens at `/` with no breadcrumb → falls through to landing /
PWA welcome and the player has to re-paste their invite link or `/p/TOKEN` URL.
**Mitigation in place:** the user only needs to hit `/p/TOKEN` once inside the same
browser that owns the PWA install for the breadcrumb to land correctly. Most users
who tap Install in Chrome after joining are fine.
**Fix (not yet built):** server-side breadcrumb — set a signed httpOnly cookie on
`/p/TOKEN` and `/join/CODE` GET requests, and have the root `/` route check it before
falling through. Or: include the token in the PWA `start_url` per-install (requires
a server-rendered manifest). Either approach moves persistence off the client and
survives browser handoffs.

### 6. PlayerView direct `matches` table read 401s on every page load
**File:** `apps/inorout/src/views/PlayerView.jsx`
**Detail:** Every page load logs
`Failed to load resource: 401 @ /rest/v1/matches?select=id,match_date,score_type&team_id=eq.team_demo&cancelled=neq.true`.
A leftover direct `supabase.from('matches')` read from before the post-session-24
RLS lockdown. Reads should go through an RPC. No user-visible impact —
the rest of the view loads fine — but every load wastes a request and
clutters the console (false-positive noise for real errors).
**Found:** session 35 verify pass via Playwright console logs.
**Fix:** Either extend `get_team_state_by_player_token` to include the
matches data PlayerView needs, or stand up a small read RPC mirroring the
query shape and replace the direct `from()` call.

---

---

## RESOLVED THIS SESSION (May 23 2026 — session 32)

- **B7: IO Intelligence deeper-intel cards were dead UI** — Most Played With (6+),
  Team Impact (7+), Nemesis (8+), Best Partnership (8+) all rendered the
  "Not enough data yet" placeholder in production, despite FEATURES.md
  marking them ✅ built. Root cause: `useIOIntelligence.js` hard-coded
  `mostPlayedWith`, `impact`, `nemesis`, `bestPartnership` to `null` and
  no upstream path computed them (RPC `get_team_state_by_player_token`
  returns only `match_stats`, `win_rate`, `reliability`;
  `computeStatsFromHistory` matched). Fixed by adding a pure client-side
  engine `packages/core/engine/deeperIntel.js` that computes all six
  deeper-intel metrics from `matches[]` + `squad[]` (already in state on
  every route). Wired into `computeStatsFromHistory` and both
  player-token state fetches in App.jsx. Hook stops nulling the keys.
  Shipped alongside two new cards (Most Faced Opponent 4+, Reliability
  Ranking 5+). Commit: `04877de`.

## RESOLVED (May 22 2026 — session 31)

- **B6: Status confirmation banners persisted on page refresh** — "🔒 Locked in",
  "👍 No worries we'll find cover" etc. all rendered on mount and only
  disappeared if the user happened to tap a status (firing the 5s timer).
  `hideConfirmation` initial value flipped from `false` to `true`; banners
  now only render in the 5s window after an actual `setStatus` call. Commit:
  `19abed9`.
- **B5: Player tile said "Are you in this Tuesday?" on a Wednesday match** —
  `gameDay` derived from `schedule.gameDateTime` first (which had drifted
  to a Tuesday in the demo schedule), falling back to `schedule.dayOfWeek`.
  Reversed the precedence: admin-configured `dayOfWeek` wins; the timestamp
  weekday is only a fallback. Commit: `c436992`.
- **B4: Smart Teams prediction stuck on "Even game" when one team is empty** —
  `computePrediction`'s `mean([]) ?? 0.5` defaulted both averages to 0.5,
  producing a draw verdict regardless of how lopsided the split was. Now
  returns `winner=null` when either side has 0 players; render guard hides
  the chip; confirm path saves NULL to `predicted_winner` rather than a
  misleading 'draw'. Commit: `d7cfa2f`.
- **B3: Manually-edited Smart Teams splits saved a stale prediction** — the
  algorithm's prediction was passed to `confirmTeams` even when the admin
  swapped players after Generate. Now the prediction is recomputed on every
  manual move (live), so the saved value always reflects the actual
  confirmed lineup. The "STALE / crossed-out" UI state was removed.
  Commit: `b31af19`.
- **B2: Game-is-live toggle blocked after Cancel This Week** — admin couldn't
  re-enable the game once cancelled. Root cause: `admin_upsert_schedule`
  writes day/kickoff/venue/etc but does NOT write `is_cancelled` or
  `active_match_id`. After `admin_cancel_match` set both, flipping
  `game_is_live=true` through the toggle left the schedule in conflicting
  state (`is_cancelled=true && game_is_live=true`, `active_match_id=null`)
  and the screen continued to render the cancelled state. New
  `admin_reopen_week` RPC (migration 032) owns the full reopen
  transaction: clears the cancelled state, inserts a fresh `matches`
  row, points `active_match_id` at it, writes a `week_reopened`
  audit_events row. JS `reopenWeek(adminToken)` wrapper. AdminView
  `openNextWeek` and ScheduleScreen `save` both branch through it when
  `schedule.isCancelled` is true. Verified against `team_demo`
  end-to-end via MCP. Commits: `5061508`, `e2f67ea`.

## RESOLVED (May 21 2026 — session 29)

- **B1: Stale `p.is_vice_captain` in 10 deployed RPCs** — `players.is_vice_captain` was
  removed in migration 026 (session 27) but 10 SECURITY DEFINER functions still referenced
  it in their SELECT clause. PL/pgSQL validates column references at runtime, not definition
  time, so all 10 failed silently with `internal_error`. Affected: all Manage Squad buttons
  (INJURED, DISABLE, PRIORITY), player attendance (`set_player_status`), payment marking
  (`set_player_paid`, `set_guest_payment`), injury self-report (`set_player_injured`),
  and admin tools (`admin_set_player_note`, `admin_set_player_status`,
  `admin_update_player_name`). Fixed via `apply_migration` — removed stale
  `'is_vice_captain', p.is_vice_captain,` line from all 10 SELECT clauses. Verified via
  `execute_sql` — all 10 return non-null. Schema cache reloaded. `admin_set_vice_captain`
  was already correct (uses `tp.is_vice_captain` via JOIN). No JS changes needed.
- **CreateTeam email field redundant** — `authUser` now flows App.jsx → Onboarding →
  `useOnboarding`, seeding `adminEmail` from OAuth email. Input field and validation
  removed from UI. RPC call unchanged. Commit: `419fba2`
- **"Make game live" hint** — Dismissible banner added to AdminView showing when
  `gameIsLive` is false and `ioo_game_live_hint_dismissed` not set. CTA links to
  Match Settings. Permanent dismiss via localStorage. Commit: `419fba2`

## RESOLVED (May 21 2026 — session 28)

- **ScoreScreen bib eligibility 401** — replaced `getBibEligiblePlayers` direct
  `player_match` read with synchronous derivation from `squad` prop (`bibsSorted`). No new
  RPC needed. `getBibEligiblePlayers` deleted from supabase.js. Commit: `8aaae57`
- **Admin Decide button** — confirmed non-bug. `POTMTiebreakModal` auto-detects
  `adminDecisionPending` on return to AdminView. Flow works correctly.
- **insertMatch 401** — App.jsx call site removed (`setMatchHistory` made pure);
  `insertMatch` deleted from `supabase.js`.
- **upsertSchedule dead import** — removed from App.jsx imports.
- **TeamsScreen hardcoded colours** — all 5 fixed with CSS variables.
- **App.jsx dead imports** — `insertMatch`, `upsertSchedule`, `addCoverPlayer`,
  `removeCoverPlayer`, `updateCoverPlayer`, `getUser`, `getUserProfile`,
  `getTeamByPlayerToken` all removed.
- **Raw RPC in AdminView/index.jsx** — `admin_confirm_payment` extracted to
  `confirmPayment()` wrapper in supabase.js.
- **Gold hardcoded colours in AdminView/index.jsx** — replaced with `var(--goldb)` / `var(--gold2)`.
- **console.warn in App.jsx** — changed to `console.error`.
- Dead functions removed from `supabase.js`: `bulkCancelLedgerEntries`,
  `bulkResetPlayerStatuses`, `deletePlayerMatchRows`, `findPlayerByUserId`,
  `findPlayersByName`, `getPlayerByUserId`, `updateCareerBibCount`, `insertBib`,
  `addCoverPlayer`, `removeCoverPlayer`, `updateCoverPlayer`, `getBibEligiblePlayers`
- Dead payment functions removed from `payments.js`: `handleClearDebt`, `handleStripePayment`
- `IsThisYou.jsx` deleted (never routed to or imported)
- Commits: `1784b44`, `3e2bfde`, `9003865`, `6df6fcf`, `9441888`, `957f63d`, `8aaae57`

---

## PREVIOUSLY RESOLVED (for reference)

| Bug | Fixed in |
|---|---|
| NameStep discards returning player name | Session 22 |
| `handleAddPlayer` missing `teamId` | Session 22 |
| `players.deputy` DB column (renamed, now gone) | Session 23 |
| `owes` double-increment risk | Session 26 |
| `App.jsx:639` join call signature mismatch | Session 27 |
| `getPlayerTeams` RLS bypass | Session 25 |
| Stats + My IO showing no data post-RLS | Session 25 |
| Realtime callbacks using direct table reads | Session 25 |
| `is_vice_captain` in wrong table (players → team_players) | Session 27 |
| POTM voting RLS (submit_potm_vote + get_potm_voting_state RPCs) | Session 25 |
| `add_guest_player` + payment RPCs referencing `players.is_vice_captain` | Session 27 |
| `carryForwardDebts` dead code removed | Session 26 |
| B1: 10 RPCs referencing removed `players.is_vice_captain` — all Manage Squad buttons + `set_player_status` + payments broken | Session 29 |
