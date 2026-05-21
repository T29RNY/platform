# In or Out — Known Bugs & Tech Debt
*Last updated: May 21 2026 (session 28)*

**Read this at the start of every session before touching any code.**

---

## PRE-UAT — Must fix before any real-user testing

### 1. Admin Decide button in ScoreScreen broken
**File:** `apps/inorout/src/views/AdminView/ScoreScreen.jsx`
**Detail:** POTM stage shows an "Admin Decide" button but `onAdminDecide` prop is not
wired. Button currently calls `onBack()` — exits ScoreScreen entirely instead of opening
the tiebreak modal.
**Fix:** Add `onAdminDecide` prop to ScoreScreen; wire from AdminView. AdminView already
has `POTMTiebreakModal` logic.

### 2. `insertMatch` direct write — POST /rest/v1/matches 401
**Files:** `apps/inorout/src/App.jsx:597`, `packages/core/storage/supabase.js:77`
**Detail:** App.jsx line 597 calls `insertMatch()` which does `supabase.from("matches").upsert()`
— a direct table write blocked by RLS post-session-24.
**Context:** Lineup lock cron creates the stub match row. `admin_save_match_result` RPC
handles result saves without needing a pre-existing row. The App.jsx:597 call is likely
dead/redundant.
**Fix:** Audit App.jsx:597 calling context, remove or replace with RPC. Then delete
`insertMatch` from supabase.js.

### 3. ScoreScreen POTM eligibility — GET /rest/v1/player_match 401
**File:** `apps/inorout/src/views/AdminView/ScoreScreen.jsx`
**Detail:** POTM eligibility lookup does a direct `player_match` table read — blocked by RLS.
**Fix:** Use existing `get_potm_voting_state` RPC (built session 25) or extend
`admin_get_team_state` to include eligible players.

---

## LOW — Known workarounds exist

### 4. BibsScreen standalone write broken under RLS
**File:** `apps/inorout/src/views/AdminView/BibsScreen.jsx`
**Detail:** BibsScreen bib assignment lacks `matchId` + `adminToken` in scope.
Direct `insertBib` write is blocked by RLS.
**Workaround:** Bibs can be set via ScoreScreen result save (has both). Standalone
BibsScreen assignment is non-functional post-RLS.
**Fix:** Thread `adminToken` + `matchId` into BibsScreen; replace `insertBib` with
`admin_save_bib_holder` RPC call.

### 5. `upsertSchedule` dead import in App.jsx
**File:** `apps/inorout/src/App.jsx:8`
**Detail:** Imported but never called in body after `setSchedule` was made a pure
state setter (session 24).
**Fix:** Remove from import line 8.

### 6. `insertMatch` still in supabase.js
**File:** `packages/core/storage/supabase.js:77`
**Detail:** Direct `matches` table write. After bug #2 App.jsx call site is removed,
this function can be deleted entirely.
**Fix:** Remove after bug #2 is resolved.

### 7. `player_career` mostly empty
**Detail:** Only `total_bib_count` is ever written. 11 other career fields (`total_games`,
`total_wins`, `total_losses`, `total_draws`, `total_goals`, `total_motm`,
`career_win_rate`, `career_reliability`, `career_impact`, `best_team_id`) are permanently
null/zero. Table exists but provides no value until Phase 2 career sync is built.

### 8. `team_demo` has no `team_admins` row
**Detail:** Demo team predates the `team_admins` table. Multi-team switcher won't show
`team_demo` for Tarny's account until backfilled. No impact on real teams.
**Fix:** `INSERT INTO team_admins (team_id, user_id) VALUES ('team_demo', '<tarny_user_id>');`

### 9. `scoring.js` filename mismatch
**File:** `packages/core/engine/scoring.js`
**Detail:** File hosts `periodCutoff` (a non-scoring helper) alongside `hasGoalData` +
`resolveDominantType`. Low priority until file grows further.
**Fix:** Rename to `stats-helpers.js` when adding more helpers.

---

## PRE-BROADER-BETA — Fix before Jun 9 public beta

### 10. CreateTeam email field redundant
**File:** `apps/inorout/onboarding/steps/CreateTeam.jsx`
**Detail:** Admin is already authenticated via Google OAuth. Showing a manual email
input is redundant and risks the wrong email being entered.
**Fix:** Pass `authUser.email` from App.jsx through Onboarding → CreateTeam. Use
silently as `adminEmail`. Hide the input field from the UI.

### 11. "Make game live" hint for new admins
**Detail:** New admins have no prompt explaining they need Admin → Match Settings →
game live toggle. First match will silently not open for players.
**Fix:** One-time post-onboarding banner pointing to Match Settings. Dismiss on tap,
store flag in localStorage.

---

## PHASE 2

### 12. Mid-game team switches
**Detail:** Spec agreed in decisions log. New ScoreScreen stage between score entry
and bibs. `team_switches jsonb` column on matches. Final team assignment determines
W/L/D per player. Switch icon (⇄) in match history.
See `DECISIONS.md` for full spec.

---

## RESOLVED THIS SESSION (May 21 2026 — session 28)

- Dead write functions removed from `supabase.js`: `bulkCancelLedgerEntries`,
  `bulkResetPlayerStatuses`, `deletePlayerMatchRows`, `findPlayerByUserId`,
  `findPlayersByName`, `getPlayerByUserId`, `updateCareerBibCount`
- Dead payment functions removed from `payments.js`: `handleClearDebt`, `handleStripePayment`
- `IsThisYou.jsx` deleted (never routed to or imported)
- Dead barrel exports removed from `packages/core/index.js`
- Dead imports removed from `AdminView/index.jsx` (`addCoverPlayer`, `removeCoverPlayer`)
- Commit: `1784b44`

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
