# In or Out — RPC Inventory
*Last updated: Jun 7 2026 (session 70 — mig 207: admin_go_live/admin_go_live_for_team now delete stale guest rows on new-week open)*

All client writes go through these SECURITY DEFINER RPCs. Raw SQL names appear
only inside `supabase.rpc()` calls in `packages/core/storage/supabase.js`.

> **Session 59 (Phase 9 cont.) — no RPC change.** The new league reminder crons
> (`availabilityRequestJob`/`fixtureReminderJob` in `api/cron.js`) read
> `fixtures`/`team_players`/`players` with the **service role** (the cron.js convention,
> like `lineupLockJob`) and write only `notification_log` push rows via `/api/notify` direct
> mode — no new RPC, no migration. `api/_sms.js` (Twilio transport core) is unwired. See
> FEATURES "PHASE 9 (cont.)".

**Rule:** If an RPC doesn't exist for a write you need, create it in Supabase SQL
editor first, then add the JS wrapper. See CLAUDE.md RPC CHECKLIST.

---

## PATTERN

- Admin RPCs: derive `team_id` from `p_admin_token` server-side — never trust client
- Player RPCs: derive context from `p_token`
- Auth RPCs: use `auth.uid()` — no identity params needed
- All return `jsonb`
- All use `SECURITY DEFINER`

---

## CONSUMERS — FORWARD DEPENDENCY TRACKING

When an RPC is consumed by multiple apps (and especially when it's
designed for FUTURE apps that don't exist yet), record the consumers
in the Notes column so a later return-shape change doesn't silently
break a downstream app. Format:

> *Consumers: `apps/inorout` (PlayerView), `apps/ref` (LiveMatch), Phase 4 reception display (planned)*

Hard-rule #12 enforces that adding a field to an RPC requires the
same-commit mapper update for current consumers. This convention
extends that discipline FORWARD — when Phase 4 finally builds the
reception display, this column tells it which RPCs it can reuse
rather than rebuild.

Phase 5 cycles 5.3 and 5.4 introduce RPCs designed for multiple
future consumers — track them here as they land.

### Phase 2 RPCs — Team registration (venue/league)

*The Phase 2 venue/league RPC layer is otherwise uncatalogued here (dashboard, fixture generation, standings, etc.). These three are the team-registration trio (migs 098–100), added session 55. Not exhaustive.*

| SQL function | JS wrapper | Grant | Notes |
|---|---|---|---|
| `join_register_team(p_league_code, p_competition_id, p_team)` | `joinRegisterTeam(leagueCode, competitionId, team)` | authenticated only | Migration 098 (Cycle 2.5a); **behaviour changed in mig 158**. SECURITY DEFINER, search_path locked. Requires `auth.uid()`. Self-serve registration into a league competition. `p_team` is either `{name, short_name?, primary_colour?, secondary_colour?, admin_email?}` → creates a NEW competitive team + claims caller as team_admin; OR `{existing_team_id}`. **Mig 158 — a league team is ALWAYS a separate squad:** `existing_team_id` is accepted ONLY if that team is already `team_type='competitive'` (e.g. a league team also entering a cup, Phase 11); a casual team is rejected with `casual_team_cannot_register` (no in-place casual→competitive promotion). Inserts `competition_teams` row status `pending`; audit `team_registration_submitted`; broadcasts `team_registration_pending` to venue + league. Mig 158 also revoked a stale anon EXECUTE grant (Supabase default-privileges leftover) → authenticated only. **Consumers (hard-rule #14)**: `/join/LEAGUE_CODE` self-serve registration wizard (LEAGUE_MODE_SCOPE Phase 2G — NOT yet built in apps/inorout; RPC + wrapper only); venue approval dashboard (downstream of the pending row). |
| `venue_approve_team_registration(p_venue_token, p_competition_team_id)` | `venueApproveTeamRegistration(venueToken, competitionTeamId)` | anon + authenticated | Migration 099 (Cycle 2.5a). SECURITY DEFINER, search_path locked. Venue admin flips a `competition_teams` row `pending → active`. Caller resolved via `resolve_venue_caller`; the registration's competition→season→league must belong to the caller's venue (`registration_not_in_venue`). **Idempotent**: re-approving an already-active row is a no-op success (`noop:true`) so a double-click doesn't 500. Clears `rejection_reason`. Audit `team_approved`; broadcasts `team_approved` to venue + league. (Team-admin email/push delivery is owned by Cycle 2.7.) **Consumers**: apps/venue operator dashboard pending-registrations screen. |
| `venue_reject_team_registration(p_venue_token, p_competition_team_id, p_reason)` | `venueRejectTeamRegistration(venueToken, competitionTeamId, reason)` | anon + authenticated | Migration 100 (Cycle 2.5a). SECURITY DEFINER, search_path locked. Venue admin flips a `pending` `competition_teams` row → `rejected`. `p_reason` required, non-empty (`rejection_reason_required`), stored in `competition_teams.rejection_reason` (col added mig 097). Only `pending` is rejectable (`only_pending_can_be_rejected`); same venue-ownership gate as approve. Audit `team_rejected` (reason in metadata); broadcasts `team_rejected` to venue + league. **Consumers**: apps/venue operator dashboard pending-registrations screen. |

### Phase 11 RPCs — Cups & knockouts

| SQL function | JS wrapper | Grant | Notes |
|---|---|---|---|
| `get_cup_bracket(p_competition_id)` | `getCupBracket(competitionId)` | anon + authenticated | **Migration 188 (Cycle 11.3).** STABLE, read-only. Returns the full single-elim bracket: `{competition, champion, rounds:[{round_number, round_name, ties:[…]}]}`. Each tie carries teams + colours, the linked fixture's schedule/score/`decided_by`/ET/pens, `winner_team_id`, and `status` (pending/ready/scheduled/decided). Public match data (shown on the no-login display board), so keyed by competition_id with no token gate. **Extended mig 194 (Cycle 11.4b):** for `format='group_stage'` comps also returns `groups` (= `get_group_standings` payload), `all_groups_complete`, and `knockout_seeded` (additive; knockout `rounds`/`champion` unchanged). **Consumers**: apps/venue `BracketView` (+ schedules `ready` ties, Build-knockout gate); apps/inorout player bracket; apps/display bracket zone. |
| `ref_record_knockout_decider(p_ref_token, p_aet_home, p_aet_away, p_pens_home, p_pens_away, p_winner_team_id)` | `refRecordKnockoutDecider(refToken, {aetHome, aetAway, pensHome, pensAway, winnerTeamId})` | anon + authenticated | **Migration 187 (Cycle 11.2).** SECURITY DEFINER. Completes a cup knockout that was level at full time. Resolves the fixture by ref_token; requires `type='cup'`, `cup_tie_id` set, status `in_progress`, regulation level. Penalties take precedence over ET; the picked winner must match the higher of whichever decider is given (else `winner_pens_mismatch`/`winner_aet_mismatch`); a level ET with no pens raises `extra_time_level_needs_pens`. Sets scores + `decided_by` + `ko_winner_id`, status→completed → the `cup_advance_after_result` trigger advances the bracket. Audit `ref_knockout_decider`. **Consumers**: apps/ref `LiveMatch` DeciderModal (shown when `ref_confirm_full_time` returns `needs_decider`). |
| `venue_schedule_cup_tie(p_venue_token, p_tie_id, p_scheduled_date, p_kickoff_time, p_playing_area_id?)` | `venueScheduleCupTie(venueToken, tieId, scheduledDate, kickoffTime, playingAreaId=null)` | anon + authenticated | **Migration 187 (Cycle 11.2).** SECURITY DEFINER. Operator schedules a `ready` next-round cup tie (both teams known). Venue-ownership gate; requires tie status `ready`, no existing fixture, date in season. Creates the fixture (linked `cup_tie_id`), flips tie → `scheduled`, raises the fee charge. Audit `cup_tie_scheduled`; notify venue + league. **Consumers**: Cycle 11.3 venue bracket scheduling UI (wrapper shipped 11.2). |
| `ref_confirm_full_time(p_ref_token)` | `refConfirmFullTime(refToken)` | anon + authenticated | **Behaviour changed mig 187 (Cycle 11.2).** For a cup knockout (`cup_tie_id` set) that is **level**, it no longer completes — returns `{needs_decider:true, home_score, away_score}` and leaves the fixture `in_progress` (the ref then calls `ref_record_knockout_decider`). Decisive cup ties complete + stamp `decided_by='regulation'`; **league fixtures behave exactly as before**. Terminal completion fires the bracket-advance trigger. **Consumer**: apps/ref `LiveMatch` (handles `needs_decider`). |
| `_cup_advance(competition_id)` / `tg_cup_advance()` | *(none — trigger only)* | postgres/service_role only | **Migration 187 (Cycle 11.2).** Internal. `_cup_advance` is the idempotent sweep: resolve decided ties from terminal fixtures (walkover/forfeit/ko_winner/score), propagate each winner into its parent slot via the 11.1 feeder edges, mark pending ties whose both sides are known as `ready`. `cup_advance_after_result` (AFTER UPDATE on fixtures, WHEN `cup_tie_id` set) runs it on completion/walkover/forfeit. Only touches `cup_ties` (no fixtures recursion). Not client-callable. |
| `venue_persist_group_stage(p_venue_token, p_competition_id, p_num_groups, p_qualifiers_per_group, p_scheduled_date, p_kickoff_time, p_playing_area_ids uuid[], p_group_assignments jsonb?)` | `venuePersistGroupStage(venueToken, competitionId, numGroups, qualifiersPerGroup, scheduledDate, kickoffTime, playingAreaIds, groupAssignments=null)` | anon + authenticated | **Migration 192 (Cycle 11.4a).** SECURITY DEFINER. Group-stage equivalent of `venue_persist_cup_bracket`. Requires `type='cup'` AND `format='group_stage'` (`not_group_stage_cup`); refuses if fixtures/ties exist. Draws active teams into N groups (snake by `registered_at`, or operator `p_group_assignments {team_id:'A'}` override), writes `competition_teams.group_label`+`seed`, generates a single round-robin per group server-side (circle method, `fixtures.group_label` tagged, weekly rounds from `p_scheduled_date`), raises fee charges identically to `venue_generate_fixtures`, stores `competitions.config {num_groups, qualifiers_per_group, knockout_seeded:false}`. Guards `invalid_group_config`/`more_groups_than_teams`/`group_too_small_for_qualifiers`. Audit `group_stage_generated`; notify venue+league. EV-verified (6 teams→2 groups×3, 6 fixtures, 12 charges, leak 0). **Consumers (hard-rule #14)**: apps/venue SeasonWizard (group_stage branch); 11.4b `venue_seed_knockout_from_groups` (reads group results + config). |
| `get_group_standings(p_competition_id)` | `getGroupStandings(competitionId)` | anon + authenticated | **Migration 193 (Cycle 11.4a).** STABLE, read-only. Per-group mini-league tables for a group_stage cup. Aggregation mirrors `get_league_standings_for_player` (W=3/D=1/L=0, GD, GF, walkover/forfeit 3-0), scoped by `competition_id`+`group_label`. Returns `{competition_id, groups:[{group_label, qualifiers_per_group, standings:[{team_id, team_name, primary_colour, played, w, d, l, gf, ga, gd, pts, rank, qualifying}]}], all_groups_complete}`. Rank order pts→gd→gf→seed (deterministic; **no head-to-head/best-3rd tiebreak in v1**). Returns `groups:[]` for non-group comps (safe to call on any cup). Keyed by competition_id, no token (display board). **Consumers (hard-rule #14)**: apps/venue BracketView, apps/inorout BracketOverlay, apps/display BracketZone; 11.4b seed RPC + `get_cup_bracket` extension read this shape. |
| `venue_seed_knockout_from_groups(p_venue_token, p_competition_id, p_scheduled_date, p_kickoff_time, p_playing_area_ids uuid[])` | `venueSeedKnockoutFromGroups(venueToken, competitionId, scheduledDate, kickoffTime, playingAreaIds=[])` | anon + authenticated | **Migration 194 (Cycle 11.4b).** SECURITY DEFINER. Operator "Build knockout": seeds the bracket from final group standings. Requires `format='group_stage'`, `config.knockout_seeded=false`, no existing cup_ties, and **all group fixtures complete** (`group_stage_incomplete` else). Builds `v_ordered` = qualifiers in cross-group seeded order (all rank-1 by group, then rank-2, …) so group winners avoid each other early; calls `_cup_build_bracket`; flips `config.knockout_seeded=true`. Audit `knockout_seeded_from_groups`; notify venue+league. EV-verified (2 groups→final, qualifiers=winners, reject-before-complete + reject-re-seed; single-elim regression intact; leak 0). **Consumer**: apps/venue BracketView Build-knockout modal. |
| `_cup_build_bracket(p_competition_id, p_ordered text[], p_scheduled_date, p_kickoff_time, p_playing_area_ids uuid[], p_venue_id, p_league_id)` | *(none — internal)* | postgres/service_role only | **Migration 194 (Cycle 11.4b).** Internal builder extracted from `venue_persist_cup_bracket`: takes an already-ordered team list and creates `cup_rounds` + round-1 ties/fixtures/byes + rounds-2+ feeder ties + round-1 fee charges (ON CONFLICT skips pre-existing group-stage charges). Shared by `venue_persist_cup_bracket` (single-elim) and `venue_seed_knockout_from_groups` (group qualifiers) — no copy-paste. Not client-callable. |
| `venue_persist_cup_bracket(p_venue_token, p_competition_id, p_scheduled_date, p_kickoff_time, p_playing_area_ids uuid[], p_seed_team_ids text[])` | `venuePersistCupBracket(venueToken, competitionId, scheduledDate, kickoffTime, playingAreaIds, seedTeamIds)` | anon + authenticated | **Migration 185 (Cycle 11.1); refactored mig 194 (11.4b) to a thin caller over `_cup_build_bracket` — behaviour byte-identical, EV-regression-verified.** SECURITY DEFINER, search_path locked. Cup equivalent of `venue_generate_fixtures` — owns the WHOLE single-elim bracket, not just round 1. Caller via `resolve_venue_caller` (venue-ownership gate). Requires competition `type='cup'` AND `format='single_elimination'` (`not_single_elim_cup`); refuses if fixtures/ties already exist (`bracket_already_exists`). Computes canonical seeding order (textbook mirror), creates `cup_rounds` (one/round) + `cup_ties` (one/slot, with feeder edges), round-1 fixtures (round-robin across `p_playing_area_ids`, status `scheduled`, linked both ways via `cup_ties.fixture_id` ↔ `fixtures.cup_tie_id`); bye slots → `cup_ties.status='decided'` (no fixture). Raises round-1 fee charges identically to `venue_generate_fixtures`. Rounds 2+ left as `pending` ties with feeder pointers (advancement is Cycle 11.2). Audit `cup_bracket_generated`; notify venue + league. EV-verified (5 teams → 8-size, 3 byes, 3 rounds, 7 ties, leak 0). **Consumers (hard-rule #14)**: `apps/venue` SeasonWizard submit (single-elim branch); Cycle 11.2 advancement (reads ties/feeders); Cycle 11.3 `get_cup_bracket` display (venue/player/display). |

### Phase 5 RPCs (shipped)

| SQL function | JS wrapper | Grant | Notes |
|---|---|---|---|
| `team_admin_submit_lineup(p_admin_token, p_fixture_id, p_lineup, p_override_player_ids text[])` | `submitTeamLineup(adminToken, fixtureId, lineup, overridePlayerIds=[])` | anon + authenticated | Migration 159 (Cycle 5.6); **rewritten mig 162 (Cycle 5.7) — authoritative eligibility gate**. SECURITY DEFINER, search_path locked. Caller via `resolve_admin_caller` (admin_token OR VC player_token; mig 162 fixed the 5.6 VC bug). Asserts team-in-fixture (`not_your_fixture`), every picked player in squad (`players_not_in_squad`), no starting∩bench overlap (`player_in_starting_and_bench`). **Cycle 5.7 gates, all before any write:** squad size — `too_few_starters` / `too_many_subs` vs `league_config.min_starting`/`max_subs` (NULL = unbounded); double-reg — `player_double_registered` (hard, also writes a `lineup_double_registration_blocked` audit row); suspended/ineligible — `player_ineligible` unless the id is in `p_override_player_ids`. **Submit registers**: auto-upserts `player_registrations(active)` (ON CONFLICT DO NOTHING). Upserts `fixture_lineups`. Returns `{ok, starting_count, bench_count, registered_count, overridden[], warnings[]}` (`warnings` now always `[]` — former soft cases are hard gates). Audits `lineup_submitted` with `metadata.override_player_ids` (hard-rule #9). `p_lineup` = `{starting:[player_id], bench:[player_id], shirt_numbers:{player_id:int}}`. **DROP+CREATE** in mig 162 (added 4th arg → new overload; single-overload rule). **Consumers (hard-rule #14)**: writes `fixture_lineups`, consumed by `get_fixture_state_by_ref_token` (ref pre-match) + `get_team_next_fixture_lineup` (admin); Phase 4 reception display (future). |
| `team_admin_check_eligibility(p_admin_token, p_fixture_id, p_player_ids text[])` | `checkTeamLineupEligibility(adminToken, fixtureId, playerIds)` | anon + authenticated | Migration 162 (Cycle 5.7). **Read-only** (STABLE, SECURITY DEFINER, search_path locked). Caller via `resolve_admin_caller`. Returns `{ok, team_id, fixture_id, min_starting, max_subs, players:[{player_id, name, in_squad, double_registered, suspended, registration_status, suspension_until}]}` for the given candidate ids — per-player flags are properties of (player, fixture), independent of who's currently assigned. Powers the pre-submit UI badges + squad-size hints; submit (above) is the authoritative gate. **Consumers (hard-rule #14)**: `TeamsheetScreen` only; Phase 4 reception display (future). |
| `get_team_next_fixture_lineup(p_admin_token)` | `getTeamNextFixtureLineup(adminToken)` | anon + authenticated | Migration 159 (Cycle 5.6); **mig 162 swapped the caller resolution to `resolve_admin_caller`** (VC parity — paired-read rule). SECURITY DEFINER, search_path locked. Returns `{team_id, fixture, lineup}` — the team's next upcoming league fixture (`scheduled`/`allocated`, type `league`, ordered by date/kickoff) with opponent/date/venue/competition, plus the existing `fixture_lineups` row (or null). `fixture:null` for casual teams. **Consumers**: AdminView Teamsheet card + `TeamsheetScreen` (gating + prefill). |
|---|---|---|---|
| `get_player_competition_fixtures(p_token, p_filter)` | `getPlayerCompetitionFixtures(playerToken, filter='all')` | anon + authenticated | Migration 155 (Cycle 5.3). SECURITY DEFINER, search_path locked. Token → player → active competitions → that team's fixtures. `p_filter` ∈ `upcoming`/`past`/`all` (unknown → `all`). Per-row player perspective: `is_home`, `opponent_name`, `my_score`, `opponent_score`, `result` (`W`/`D`/`L` for completed; `W`/`L` for walkover+forfeit; null otherwise — reports status truthfully, no phantom 3-0; standings (mig 087) owns the 3-0 rule). Self-gating: casual token → `fixtures: []`. **Consumers (hard-rule #14)**: Cycle 5.3 player my-view `CompetitionFixturesCard` (built); Phase 4 reception "upcoming fixtures" panel (future); Phase 6 HQ "tonight's fixtures" feed (future). Return-shape additions for those won't break 5.3. |
| `get_player_fixture_detail(p_token, p_fixture_id)` | `getPlayerFixtureDetail(playerToken, fixtureId)` | anon + authenticated | Migration 156 (Cycle 5.4). SECURITY DEFINER, search_path locked. **Stricter gate than ref RPC**: fixture must be in one of the player's OWN active competitions AND involve one of the player's teams, else `fixture_not_visible`. Mirrors the mig-119 ref shape (fixture/competition/league/venue/pitch/both teams/both registered squads/events) PLUS perspective fields (`is_home`, `my_team_id`, `opponent_name`, `my_score`, `result`). Squads = LIVE active `player_registrations` (confirmed XI arrives 5.6). **Availability fields (`availability_counts`, `my_availability`) intentionally ABSENT — Cycle 5.5 adds them with same-commit mapper update (hard-rule #12).** **Consumers (hard-rule #14)**: 5.4 `FixtureDetailCard` (built); Phase 4 reception display; Phase 7 AI briefings. |
| `get_fixture_opposition_intel(p_token, p_fixture_id)` | `getFixtureOppositionIntel(playerToken, fixtureId)` | anon + authenticated | Migration 156 (Cycle 5.4). SECURITY DEFINER, search_path locked. Same visibility gate as detail. Returns `{ h2h:{all_time,this_season}, my_form, opponent_form, my_top_scorers, opponent_top_scorers, last_meeting }`. H2H/form from `fixtures` scores; top scorers from `match_events` (event_type='goal' — **no goals table**); walkover/forfeit → W/L only. **Consumers (hard-rule #14)**: 5.4 `OppositionIntel` (built); Phase 7 AI Gaffer narrative briefings. |

---

## PLAYER TOKEN RPCs (migration 011)

| SQL function | JS wrapper | Grant | Notes |
|---|---|---|---|
| `set_player_status` | `setPlayerStatus(token, status)` | anon | Sets status on players row. Refuses 'in' if `admin_locked_in=true` (raises `admin_locked_in`). Refuses 'in' if squad_size cap met (raises `squad_full`). Updated in migration 038. |
| `set_player_paid` | `handleCashPayment(token)` → `setPlayerPaid(token)` | anon | **Mig 211:** PENDING CLAIM — flags self_paid only; owes UNCHANGED, ledger untouched. Debt is cleared by `admin_confirm_payment`, not here. (Was: cleared owes on self-declare.) |
| `set_player_injured` | `insertPlayerInjury(token, injured)` | anon | Writes player_injuries row |
| `set_player_contact(p_token, p_phone, p_channel)` | `setPlayerContact(token, phone, channel)` | anon + authenticated | **Migration 189 (Phase 9 finish).** Player-self contact-capture (modelled on `set_player_note`). Sets `players.phone` + `players.notification_channel` (push/email/sms/whatsapp; sms+whatsapp use `phone`, require it → `phone_required_for_channel`; email uses the linked auth email). Audit `player_contact_updated_self` (metadata stores `has_phone`, never the number). Returns `{ok, phone, notification_channel}`. **Consumers:** apps/inorout PlayerProfile NOTIFICATIONS section; the 48h/2h reminder crons' push→email→SMS fallback (Phase 9 finish, Part B). |
| `get_my_contact(p_token)` | `getMyContact(token)` | anon + authenticated | **Migration 189.** STABLE read for prefill: `{phone, notification_channel, has_linked_email}`. Avoids a `dbToPlayer` mapper ripple (hard-rule #12). |
| `add_guest_player` | `addGuestPlayer(hostToken, guestName)` | anon | Creates guest player row |
| `save_push_subscription` | `savePushSubscription(token, sub)` | anon | Upserts push_subscriptions |
| `get_my_payment_history` | `getMyPaymentHistory(token, limit?)` | anon | Player-side read of own payment_ledger. Mirrors `admin_get_player_ledger` shape; client uses `dbToLedger` for camelCase. Migration 039. |
| `get_my_injuries` | `getMyInjuries(token)` | anon | Player-side read of own player_injuries on the team the token belongs to. Migration 039. |
| `leave_squad` | `leaveSquad(token)` | anon | Soft remove from this team. Detaches team_players + push_subscriptions; player row + history preserved. Refuses with `debt_owed:<amount>` if owes > 0. Audit + notify_team_change. Migration 040. |
| `delete_my_account` | `deleteMyAccount(token)` (calls `/api/delete-account`) | anon | Anonymises players row (name → "Deleted player", token/user_id/nickname cleared, disabled+reason set) — preserves FKs from player_match / payment_ledger / player_injuries / potm_votes. Detaches all team_players. Deletes push_subscriptions + player_career. Revokes admin grants. Returns `auth_user_id`; edge function (`apps/inorout/api/delete-account.js`) calls `supabase.auth.admin.deleteUser` to finish. Refuses with `last_admin:<csv of team_ids>` if the user is the only non-revoked admin of any team. Audit per team. Migration 040. |

---

## ADMIN TOKEN RPCs (migrations 012–018)

| SQL function | JS wrapper | Notes |
|---|---|---|
| `admin_get_team_state` | `getTeamStateByAdminToken(adminToken)` | Bulk read — all squad/schedule/match data |
| `admin_add_player` | `addPlayerToTeam(adminToken, name, type, priority)` | Writes players + team_players rows, generates token |
| `admin_remove_player` | `deletePlayer(adminToken, playerId)` | Soft delete via disabled flag |
| `admin_update_player_name` | `adminUpdatePlayerName(adminToken, playerId, name)` | |
| `admin_set_vice_captain` | `toggleViceCaptain(adminToken, playerId, value)` | Writes team_players.is_vice_captain |
| `admin_set_player_group` | `setPlayerGroup(adminToken, playerId, groupNumber)` | Group Balancer; writes team_players.group_number (1–5 or NULL); audit_events |
| `admin_clear_all_groups` | `clearAllGroups(adminToken)` | Group Balancer; sets every group_number to NULL for the team; returns cleared_count |
| `admin_set_player_priority` | `setPlayerPriority(adminToken, playerId, priority)` | |
| `admin_set_player_status` | `adminSetPlayerStatus(adminToken, playerId, status)` | Sets status. Setting 'in' also flips `admin_locked_in=true`; setting out/maybe/reserve/none clears it. Refuses 'in' if cap met (raises `squad_full`). Audits before/after + locked_after. Updated in migration 038. |
| `admin_disable_player` | `disablePlayer(adminToken, playerId, disabled)` | |
| `admin_confirm_payment` | `handleMarkPaid(adminToken, playerId, matchId)` (payments.js) / `confirmPayment(adminToken, playerId, matchId)` (supabase.js) | Sets paid=true; ledger cross-path promotion. **Mig 211:** now also clears `owes=0` (confirmation is the money event). `admin_reset_payment` restores owes when undoing a confirmed payment. `set_guest_payment` got an audit row + a text→uuid `v_ledger_id` fix. Payment RPC wrappers (`setPlayerPaid`/`setGuestPayment`/`resetPayment`/`waiveDebt`) now live in supabase.js. |
| `admin_reset_payment` | `handleResetPayment(adminToken, playerId, matchId)` | Resets all payment flags + ledger |
| `admin_waive_debt` | `handleWaiveDebt(adminToken, playerId, note)` | Zeros owes; writes waiver ledger entry; notify |
| `admin_save_match_result` | `saveMatchResult(matchId, teamId, adminToken, match)` | Writes result + the full end-of-match cascade. **p_team_a/p_team_b/p_motm/p_bib_holder are player IDs** (stored on matches.* as IDs; display layers must resolve id-first, name-fallback). **Freshness = `matches.winner WAS NULL` before this save** (migs 205/206) — NOT a player_match-row-count check (the kickoff lineup-lock pre-creates player_match rows and defeated the old check, silently skipping the cascade → session-68 £0-outstanding/empty-history/dead-bib-tracker bug). Fresh block (once per match): w/l/d, owes+=price for unpaid non-guest attendees, INSERT payment_ledger game_fee/unpaid per same, reset attended+1/total+1/team=NULL/status='none'/**admin_locked_in=false**/paid+self_paid+paid_by+paid_at cleared, goals, motm, bib_history cascade (+bib_count). **Never set matches.winner before the first result save** or the cascade is skipped. **Consumers** of the stored IDs: StatsView, HistoryView share text, PlayerLeagueTable (hard-rule #14). See [[project_result_save_invariants]]. |
| `admin_save_teams` | `confirmTeams(adminToken, matchId, teamA, teamB, predictedWinner?, predictedConfidence?, balanceScore?)` | Sets matches.team_a/team_b on confirm + writes denormalised players.team (clears for all team_players, then sets 'A'/'B' on the confirmed ids) so PlayerView Live Board renders the team sheet. 3 trailing prediction params (Group Balancer, migration 031) write to matches.predicted_winner/confidence/balance_score. Migration 043 added players.team write; **migration 048 scoped the two SET statements via team_players join to close a cross-team write surface** (a legit admin for team X could previously pass team Y player_ids in p_team_a/p_team_b and flip their team value — foreign IDs now silently filtered). Migration 031 added prediction params. Old 5-arg signature dropped. |
| `admin_save_bib_holder` | `saveBibHolder(adminToken, matchId, playerId, name)` | 4-step atomic: match bib_holder, player bib_count++, bib_history upsert, had_bibs flag |
| `admin_cancel_match` | `adminCancelMatch(adminToken, reason)` | Atomic cancel — replaces 7-step cancelWeek() |
| `admin_reopen_week` | `reopenWeek(adminToken)` | Reopens a cancelled week: clears schedule.is_cancelled / cancel_reason, sets game_is_live=true, inserts a fresh matches row, points active_match_id at it. Previously cancelled match stays in history (cancelled=true). Migration 031 sibling. |
| `admin_go_live` | `goLive(adminToken)` | Manual "Open Next Week". Idempotent (reuses a live active_match_id). **Mig 204:** when a NEW match is created, resets the squad to a fresh board — status='none', admin_locked_in=false, team=NULL for all team_players — so last week's in/out + A/B don't carry over. **Payment fields (paid/self_paid/paid_by/paid_at/owes) intentionally carry over** (the Owes balance depends on it). **Mig 207:** also deletes all is_guest=true rows for the team on new-match creation (team_players rows first, then players via guest_of) so hosts see a fresh Plus One button each week. Gated to new-match path so double-taps never wipe a guest added for the live week. **Mig 208:** resolves the caller via `resolve_admin_caller` so a Vice Captain's player token works (was a bare admin_token lookup → VC got `invalid_admin_token`); audit actor_type now reflects `vice_captain`. The sibling `admin_reorder_reserves` got the identical mig-208 fix. |
| `admin_go_live_for_team` | _(none — cron-only; service-role `supabase.rpc()` in cron.js `autoOpenGameJob`)_ | Service-role sibling of `admin_go_live` (mig 126); same mig-204 squad reset + mig-207 guest-row deletion on new-match creation. |
| `admin_upsert_schedule` | `upsertSchedule(adminToken, schedule)` | Includes p_game_is_live (added session 27). Mig 207: game_date_time now uses `AT TIME ZONE 'Europe/London'` (was UTC-naive — caused 1hr BST offset on all kickoff-relative cron jobs). Grant corrected to authenticated-only (anon had EXECUTE via stale 13-param REVOKE that never matched the live 14-param signature). **Mig 210:** resolves the caller via `resolve_admin_caller` so a Vice Captain's player token works (was bare admin_token lookup → VC got invalid_admin_token); audit actor_type reflects vice_captain; anon re-granted (token check is the gate, matching all sibling admin RPCs). VC parity now complete across all casual admin_* RPCs. |
| `admin_upsert_settings` | `upsertSettings(adminToken, groupName, groupLabels?)` / `saveGroupLabels(adminToken, groupName, groupLabels)` | Now takes optional p_group_labels jsonb (migration 031). COALESCE means passing NULL preserves existing labels. Old 2-arg signature dropped. |
| `admin_close_potm_voting` | `closePOTMVoting(adminToken, matchId, winnerId, wasAdminDecided)` | Updates matches + player_match |
| `admin_reset_player_token` | `resetPlayerToken(adminToken, playerId)` | Generates new token |
| `set_player_nickname` | `setPlayerNickname(adminToken, playerId, nickname)` | Admin sets nickname |
| `clear_player_injury` | `clearPlayerInjury(adminToken, playerId)` | Sets cleared_at |

---

## DRAFT RPCs

| SQL function | JS wrapper | Notes |
|---|---|---|
| `admin_save_teams_draft` | `saveTeamsDraft(adminToken, matchId, a, b)` | Saves draft without confirming |

---

## AUTH RPCs

| SQL function | JS wrapper | Auth | Notes |
|---|---|---|---|
| `link_player_to_user` | `linkPlayerToUser(token)` | authenticated only | Links player token to auth.uid(); guards double-link |
| `player_join_team` | `playerJoinTeam(teamId, name)` | authenticated only | Handles new + returning players; upserts team_players. **Migration 044 fixed pre-Beta launch blocker:** new-player INSERT branch now generates a player token via `generate_url_safe_token('p_', 14)` (the same helper `create_team` uses). Pre-fix, first-time joiners landed with `player.token=NULL` → JoinSuccess.jsx fell back to `/` → stranded on landing page. |
| `player_get_teams` | `getPlayerTeams()` | authenticated only | Returns all squads for auth.uid(); anon revoked |
| `player_get_teams_by_token` | `getPlayerTeamsByToken(token)` | anon + authenticated | Token-resolved variant of `player_get_teams` for iOS PWA (storage-partitioned, unauthed at request time) — mig 072. Returns all of the token-owner's squads. **Mig 153 (Cycle 5.1)** added `is_competitive` (squad has an active registration in a league-type competition). Consumer: `MySquads.jsx` LEAGUE pill. |

---

## ONBOARDING RPCs

| SQL function | JS wrapper | Auth | Notes |
|---|---|---|---|
| `create_team` | `createTeam(teamData)` | authenticated | Atomic: team + players + schedule + settings + team_admins; full rollback on error |

---

## QUERY RPCs (reads)

| SQL function | JS wrapper | Notes |
|---|---|---|
| `get_team_state_by_player_token` | `getTeamStateByPlayerToken(token)` | Bulk read for player route; includes match_stats, win_rate, reliability, ledger, last_match_meta, player_form |
| `get_team_state_by_admin_token` | `getTeamStateByAdminToken(adminToken)` | Bulk read for admin/demoadmin routes |
| `submit_potm_vote` | `submitPOTMVote(matchId, teamId, voterToken, nomineeId)` | SECURITY DEFINER; UNIQUE violation returns {error:"already_voted"} |
| `get_potm_voting_state` | `getPOTMVotingState(matchId, teamId, voterToken)` | Returns eligible players + existing vote |
| `find_player_by_email` | `findPlayerByEmail(email)` | Returns [{token, player_id, player_name, team_id, team_name}] |
| `get_head_to_head_raw_by_admin_token` | called via `getHeadToHead(meId, themId, teamId, period, adminToken)` | Migration 041. Returns 3 jsonb arrays (all_time_matches, period_matches, player_match_rows for both players). JS function branches on adminToken — RPC for admin-token routes (unblocks anon /demoadmin), direct reads for authenticated player sessions. Server-side period cutoff mirrors `scoring.js#periodCutoff`. |
| `get_player_league_table_raw_by_admin_token` | called via `getPlayerLeagueTable(teamId, period, adminToken)` | Migration 042. Returns 5 jsonb arrays (period_matches, player_match_rows, all_time_attended summaries, all_team_match_dates, players). Same branch-on-adminToken pattern as 041. Used by StatsView (to populate form + reliability columns) and HeadToHead (Section 4 Overall Comparison bars). |

---

## SUPER-ADMIN RPCs (migrations 045, 046)

The `apps/superadmin` dashboard at `https://platform-superadmin-*.vercel.app`
calls these four RPCs. All gated by `is_platform_admin()` (a global, cross-team
authorisation helper that checks the caller's `auth.uid()` against the
`platform_admins` table — see SCHEMA.md). New entries to `platform_admins` are
inserted by hand via SQL only; there is intentionally no UI to grant this role.

| SQL function | JS wrapper | Notes |
|---|---|---|
| `is_platform_admin` | (internal helper, no JS wrapper) | SQL boolean. Used as a precondition in every superadmin_* RPC. Returns true iff `auth.uid()` exists in `platform_admins`. |
| `superadmin_whoami` | `superadminWhoami()` | Returns `{signed_in, user_id, email, is_platform_admin}`. App-level gate after Supabase Google OAuth — if `is_platform_admin=false`, the UI shows an "Access denied" card with the signed-in email. |
| `superadmin_list_teams` | `superadminListTeams()` | Returns jsonb array of every team with: team_id, name, admin_email, join_code, onboarding_complete, created_at, player_count, admin_count, last_match_date, outstanding_total (sum of players.owes>0), admin_emails[]. Powers the Teams tab. |
| `superadmin_team_detail` | `superadminTeamDetail(teamId)` | Returns jsonb `{team, schedule, squad[], matches[], payments, admins[], recent_events[]}`. Squad includes player tokens (for /p/TOKEN deep-link inspection) and `owes`. Matches limited to last 10. Events limited to last 20. Powers the Team Detail tab. |
| `superadmin_recent_activity` | `superadminRecentActivity({limit, sinceHours})` | Returns jsonb array of audit_events joined with team name + actor email. Default limit 100, default 24h window. Powers the Activity tab. |

**Foundation:** `platform_admins` table (migration 045) is the global authorisation
layer parallel to `team_admins` (per-team). The `audit_events.actor_type` CHECK
constraint already allows `'super_admin'` — write surfaces (Phase 3/4, not yet
shipped) will use that actor_type and `auth.uid()` as actor_user_id for traceability.

---

## ASK THE GAFFER RPCs (context builders — Phase 1)

Spec: `GAFFER.md`. Called only by `apps/inorout/api/gaffer.js` (Vercel edge function).
Each returns a jsonb context block consumed by the surface-matching system prompt.
Auth via `p_admin_token`; anon grant is fine because the token is the auth signal
(same pattern as other admin RPCs).

| SQL function | JS wrapper | Surface | Notes |
|---|---|---|---|
| `gaffer_get_context_team_summary` | (none — edge function calls directly) | team_summary | Squad/status counts, recent form, top scorer/reliable 30d, last POTM, schedule. Migration 034. |
| `gaffer_get_context_payment_summary` | (none — edge function calls directly) | payment_summary | Outstanding total + count, oldest debt, top 5 owers, last-week collected vs owed, always-paid list. Migration 035. |
| `gaffer_get_context_attendance_risk` | (none — edge function calls directly) | attendance_risk | Squad shortfall, hours to kickoff, declining regulars (4-week vs prior 4-week rate drop), not-responded list, cover pool depth, risk_level enum. Migration 036. |
| `gaffer_get_context_matchday_briefing` | (none — edge function calls directly) | matchday_briefing | Confirmed squad (with VC + group), predicted teams (Smart Teams), bib rotation, in-form players, last POTM. Migration 037. |

**Edge function wrappers** (NOT supabase.rpc — they POST to /api/gaffer):
| JS wrapper | Notes |
|---|---|
| `getGafferBriefing(adminToken, surface, opts?)` | All structured surfaces. Returns `{content, briefingId, cached, surface, model, tokensIn, tokensOut, costPence}` or `{error}`. |
| `askGafferQuestion(adminToken, question, opts?)` | Q&A surface — concatenates all four structured contexts and lets Claude answer freeform under grounding rules. |

---

## LEAGUE MODE — PHASE 3 RPCs (ref view, migration 119 onwards)

Spec: `LEAGUE_MODE_SCOPE.md` § Phase 3. Ref opens
`https://app/ref/<ref_token>` on their phone — token is on
`fixtures.ref_token` (auto-generated at fixture INSERT, mig 055).
Token grants access to exactly one fixture. Anon-callable so refs
don't need an account; also granted to authenticated for future
ref OAuth without re-grant.

| SQL function | JS wrapper | Notes |
|---|---|---|
| `get_fixture_state_by_ref_token` | `getFixtureStateByRefToken(refToken)` | Migration 119. Single-fixture read for the ref pre-match + resume path. Returns `{fixture, competition, league, venue, pitch, official, home_team, away_team, home_squad, away_squad, events, caller}`. Migration 120 added `fixture.actual_kickoff_at` for the live-timer source. **Mig 160 (Cycle 5.6) made squads lineup-aware**: if a `fixture_lineups` row exists for a team, `home_squad`/`away_squad` return only its starting+bench (each tagged `lineup_role` 'starting'/'bench', shirt from the lineup overriding `players.shirt_number`, ordered starting-then-bench); otherwise the full active `player_registrations` squad **exactly as before** plus `lineup_role:null` (additive only, hard-rule #12). Squad logic lives in internal helper `_fixture_squad_json` (granted to nobody). Events ordered by `(minute, created_at)` for offline-resume. Raises `invalid_ref_token`. **Consumers**: apps/ref PreMatch/LiveMatch/PostMatch; apps/inorout `FixtureDetailCard` (reads `home_squad`/`away_squad`, ignores `lineup_role`). |
| `ref_start_match` | `refStartMatch(refToken, clientEventId, localTimestamp?)` | Migration 120. `status: scheduled\|allocated → in_progress`. Records `actual_kickoff_at` and inserts a `period_change` 1H event. Broadcasts `match_started` to both teams. |
| `ref_record_goal` | `refRecordGoal(refToken, {playerId, minute, period, clientEventId, ownGoal?, localTimestamp?})` | Migration 120. Resolves scorer's team via `player_registrations`. `ownGoal=true` stores `event_type='own_goal'` with `team_id = scorer's own team` (counts for opposite in materialisation). Idempotent on `clientEventId` — replay is a no-op. |
| `ref_record_card` | `refRecordCard(refToken, {playerId, minute, period, colour, clientEventId, localTimestamp?})` | Migration 120. `colour ∈ {yellow,red}` → `event_type ∈ {yellow_card,red_card}`. Idempotent. |
| `ref_record_substitution` | `refRecordSubstitution(refToken, {onPlayerId, offPlayerId, minute, period, clientEventId, localTimestamp?})` | Migration 120. Both players must register to the same team in this competition. Idempotent. |
| `ref_set_period` | `refSetPeriod(refToken, period, clientEventId, localTimestamp?)` | Migration 120. `period ∈ {HT,2H,ET1,ET2,PEN}`. Inserts a `period_change` event. Idempotent. |
| `ref_undo_event` | `refUndoEvent(refToken, clientEventId)` | Migration 120. DELETEs the `match_events` row by `client_event_id`. Idempotent (missing row treated as no-op). Server requires `status='in_progress'`; the 30-sec undo window is client-enforced. |
| `ref_confirm_full_time` | `refConfirmFullTime(refToken)` | Migration 120. Materialises `home_score`/`away_score` from match_events (goals(home)+own_goals(away), mirror). Transitions `status → completed`. Broadcasts `match_result_saved`. Standings recompute on-read via `get_league_standings_for_player` — no separate cascade RPC. |

**All seven `ref_*` write RPCs**: SECURITY DEFINER, search_path locked,
EXECUTE granted to `anon + authenticated`. Token-gated via private
helper `_ref_resolve_fixture` (anon/authenticated explicitly revoked —
Supabase auto-grants every public function so a plain `REVOKE FROM
PUBLIC` doesn't catch those roles). Every successful write inserts an
`audit_events` row (`actor_type='referee'`, `actor_identifier=ref_token`)
and fires THREE realtime broadcasts:
- `notify_team_change(home_team_id, reason)` →
  `team_live:<live_channel_key>` (subscriber: `apps/inorout` App.jsx)
- `notify_team_change(away_team_id, reason)` → same channel pattern
- `notify_venue_change(venue_id, reason)` →
  `venue_live:<live_channel_key>` (subscriber: `apps/venue` App.jsx
  via mig 121) — fires once per event regardless of teams. Helper:
  `_ref_venue_id_for_fixture(p_fixture)` (private; competition →
  season → league → venue lookup).

Both broadcast functions' whitelists were extended in the same
migration as the calling RPCs (avoiding the §6.3 drift bug):
- `notify_team_change` gained `match_started` +
  `match_event_recorded` (mig 120).
- `notify_venue_change` was introduced in mig 121 with whitelist
  `match_started`, `match_event_recorded`, `match_result_saved`.
  **Important**: mig 121 silently shrunk the whitelist from mig
  101's 26 reasons to 3 (Phase 2 reasons started logging WARNINGs).
  Mig 127 restored the full Phase 2 list + added `result_corrected`.
  See BUGS.md "notify_venue_change regressed in mig 121".

### Venue overrides (mig 127, session 51)

| SQL function | JS wrapper | Notes |
|---|---|---|
| `venue_update_fixture_result` | `venueUpdateFixtureResult(venueToken, {fixtureId, homeScore, awayScore, reason})` | Migration 127. The ONLY path for correcting a result after `ref_confirm_full_time`. Token-gated via `resolve_venue_caller`. Requires fixture in `status='completed'` + non-empty reason + non-negative scores. Audit-logged with previous + new scores + reason. Broadcasts `result_corrected` (team) + `result_corrected` (venue) + `fixture_result_corrected` (league). Verified end-to-end via Supabase MCP (8 assertions, no leak). **Consumers**: Phase 5+ venue dashboard "edit result" UI (planned, not yet built — RPC is callable via MCP/SQL today). |

## LEAGUE MODE — PHASE 4 RPCs (reception display, migrations 164–168)

Spec: `LEAGUE_MODE_SCOPE.md` § Phase 4. The reception big-screen runs at
`https://<display-app>/display/<display_token>` on a venue TV. **Venue-scoped**
on `venues.display_token` (a per-venue READ-ONLY public token, distinct from the
operator's `venue_admin_token`). Consumer app: `apps/display` (new standalone Vite
SPA, own Vercel project). The display subscribes to the existing
`venue_live:<venues.live_channel_key>` broadcast — every `ref_*` write already
publishes there, so live scores update with no polling.

| SQL function | JS wrapper | Grant | Notes |
|---|---|---|---|
| `get_display_state(p_display_token)` | `getDisplayState(displayToken)` | anon + authenticated | Migration 165. **Read-only** (STABLE, SECDEF, search_path locked). Resolves the venue from `display_token`; returns one jsonb: `venue` (incl. `live_channel_key` + `display_config`; **never `display_pin`**), `competitions[]` (all `status='active'` comps across the venue's leagues — each with `standings_confirmed` + `standings_live` + `top_scorers`), `live_fixtures[]` (in-progress, live-computed scores + last 6 events), `upcoming_fixtures[]`/`recent_results[]` (today, Europe/London), `goals_ticker[]` (today), `server_time`. Standings **lift the proven `get_league_standings_for_player` scoring byte-for-byte** (walkover/forfeit → 3/0; W/D/L from effective score; gated on `leagues.standings_visibility='public'`); the LIVE pass also folds in-progress `match_events` scores (goals(home)+own_goals(away), mirrors `ref_confirm_full_time`). Raises `invalid_display_token`. **Consumers (hard-rule #14)**: `apps/display` (reception); Phase 6 HQ (future). |
| `check_display_pin(p_display_token, p_pin)` | `checkDisplayPin(displayToken, pin)` | anon + authenticated | Migration 166. **Read-only** (STABLE, SECDEF, search_path locked). Returns `{pin_required, ok}` — keeps the PIN server-side (never in the state payload). `pin_required=false` when `venues.display_pin IS NULL`. The 3-strike / 30-min lockout is **client-side** (localStorage) in `apps/display`. Raises `invalid_display_token`. **Consumers**: `apps/display` PinGate. |
| `venue_update_display_config(p_venue_token, p_config, p_display_pin DEFAULT NULL)` | `venueUpdateDisplayConfig(venueToken, config, displayPin=null)` | anon + authenticated | Migration 167. **Write** (the only Phase 4 write → ephemeral-verify gated). Operator-only via `resolve_venue_caller` (the `venue_admin_token`). Writes `venues.display_config` (validated: `mode∈fixed/cycle/smart`, `interval_secs 10–60`, `zones` ∈ known keys) and optionally `display_pin` (NULL = leave, '' = clear, else 4–8 digits → `pin_invalid`). Audit `display_config_updated` (actor_type `venue_admin`) + `notify_venue_change('venue_updated')`. **Consumers**: `apps/venue` DisplaySettings (Dashboard ▸ Reception display). |

`venue_get_state` (mig 168) additively gained `display_token` + `display_config`
in its `venue` object (so the operator UI can show the link + prefill config);
`display_pin` was already returned. No consumer break.

### Cycle 3.4 offline queue — NOT shipped as an RPC

The parent Phase 3 plan flagged a `ref_replay_unsynced` batch RPC
for offline reconnect. Cycle 3.4 chose instead to drain the
IndexedDB queue client-side, calling the existing 7 ref_* RPCs one
at a time. Idempotency on `client_event_id` makes this safe; for
the ~30 events in a typical match, the round-trip cost is fine.
A batch RPC can be added later if real-world usage shows it's
needed.

### Phase 5 RPCs (planned, not yet built)

Tracked in `/Users/tarny/.claude/plans/continuing-phase-3-of-steady-falcon.md`.
Migration numbers will be assigned at cycle time.

- `get_competitive_context_for_squad(p_token)` — Cycle 5.1
- (none — reuses existing `get_league_standings_for_player`) — Cycle 5.2
- ~~`get_player_competition_fixtures(p_token, p_filter)` — Cycle 5.3~~ **SHIPPED (mig 155)** — see Phase 5 RPCs (shipped) above
- ~~`get_player_fixture_detail(p_token, p_fixture_id)` — Cycle 5.4~~ **SHIPPED (mig 156)** — see Phase 5 RPCs (shipped) above
- ~~`get_fixture_opposition_intel(p_token, p_fixture_id)` — Cycle 5.4~~ **SHIPPED (mig 156)** — see Phase 5 RPCs (shipped) above
- `player_set_fixture_availability(p_token, p_fixture_id, p_status)` — Cycle 5.5 (+ new `player_availability` table)
- ~~`team_admin_submit_lineup(p_admin_token, p_fixture_id, p_lineup)` — Cycle 5.6~~ **SHIPPED (mig 159)** + `get_team_next_fixture_lineup` (mig 159) + `get_fixture_state_by_ref_token` made lineup-aware (mig 160) — see Phase 5 RPCs (shipped) above
- ~~`team_admin_check_eligibility(p_admin_token, p_fixture_id, p_player_ids)` — Cycle 5.7~~ **SHIPPED (mig 162)** + `team_admin_submit_lineup` rewritten as the authoritative eligibility gate + `league_config.min_starting`/`max_subs` (mig 161). **Phase 5 complete.** — see Phase 5 RPCs (shipped) above

---

## LEAGUE MODE — PHASE 6 RPCs (HQ dashboard, mig 171)

HQ is authenticated-only (Google OAuth, **no token** — scope 6A). The caller is resolved
from `auth.uid()` against `company_admins`; a `platform_admin` (mig 045) is a super_admin
override over any company. Role scoping: super_admin = all company venues; regional_admin =
own region only (`venues.region`, mig 169); analyst = read-only.

| RPC (SQL) | JS wrapper | Grant | Notes |
|---|---|---|---|
| `resolve_company_caller(p_company_id)` | _(internal — used by the hq_* RPCs)_ | authenticated | Mig 171. SECDEF, search_path. `TABLE(company_id, actor_type, role, region)`. auth.uid()→company_admins; platform_admin override → super_admin/no-region. Returns empty (no row) when unauthorized; callers raise `not_authorized`. |
| `company_admin_whoami()` | `companyAdminWhoami()` | authenticated | Mig 171. The HQ app's gate (mirrors `superadmin_whoami`). `{signed_in,user_id,email,is_platform_admin,companies:[{company_id,name,role,region}]}`. Platform admins with no company_admins row see all active companies. **Consumers:** apps/hq App.jsx. |
| `hq_get_company_state(p_company_id)` | `hqGetCompanyState(companyId)` | authenticated | Mig 171; scored health mig 179; **revenue axis mig 182**. SECDEF. `{company, venues:[{health 🟢🟡🔴, health_score /100, health_reason, collection_rate, health_axes{operations,utilisation,fixture_completion,revenue} + tonight/incident/pitch/ref counts}], summary, caller}`. regional_admin scoped to region. Revenue axis = all-time collection-rate % (NULL when owed=0, dropped from the score). **Consumers:** apps/hq VenueHealthGrid (dot + score badge + reason line, wired mig 182) + AlertsActions. `summary` shape also feeds Phase 6.3 analytics Overview + the deferred Phase 9 HQ digest (hard-rule #14). |
| `hq_get_venue_detail(p_company_id, p_venue_id)` | `hqGetVenueDetail(companyId, venueId)` | authenticated | Mig 171. SECDEF. Single-venue drill-down: leagues, open_incidents, fixtures tonight/this-week/recent, pending_registrations, refs. Validates venue∈company + region. **Consumers:** apps/hq VenueDetail. |
| `hq_resolve_incident(p_company_id, p_incident_id, p_resolution_note)` | `hqResolveIncident(companyId, incidentId, note)` | authenticated | Mig 171. **WRITE** (ephemeral-verify gated). analyst rejected (`read_only_role`); region enforced. Sets `resolved_at/by/note`; audits `incident_resolved` (actor_type `company_admin`, team_id=venue_id); `notify_venue_change('incident_resolved')`. **Consumers:** apps/hq VenueDetail resolve button. |

Also mig 171: `audit_events.actor_type` CHECK += `'company_admin'`; `notify_venue_change`
whitelist += `'incident_resolved'`.

**Cycle 6.3 — composable analytics (mig 172–173):**

| RPC (SQL) | JS wrapper | Grant | Notes |
|---|---|---|---|
| `hq_get_analytics(p_company_id, p_date_from DEFAULT NULL, p_date_to DEFAULT NULL)` | `hqGetAnalytics(companyId, from?, to?)` | authenticated | Mig 173; **`revenue` card mig 182**. SECDEF. One read returning all 7 card datasets (`overview`, `venue_comparison`, `top_scorers` [match_events goals], `discipline` [cards], `incidents`, `billing`, `revenue` [owed/collected/outstanding/collection_rate + `by_venue`, from venue_charges/venue_payments, mirrors `venue_get_charges`]) + the caller's saved layout (`config`) + `caller`/`range` meta. Role/region scoped like hq_get_company_state; optional date filter on fixtures + match_events + charge `created_at`. **Consumers:** apps/hq AnalyticsView; the card registry is the Phase 7 AI composition vocabulary. |
| `hq_get_analytics_for_company(p_company_id, p_date_from DEFAULT NULL, p_date_to DEFAULT NULL)` | _(none — cron-only; called via service-role `supabase.rpc()` in cron.js)_ | **service-role only** (anon + authenticated + PUBLIC REVOKED) | Mig 190 (Phase 9 HQ weekly digest). SECDEF read. **Service-role sibling of `hq_get_analytics`** for the JWT-less cron: identical analytics jsonb (same 7 sections) but **no `resolve_company_caller` gate, no region scoping (company-wide), no `config`/`caller`/`range` meta** — returns the bare analytics object. Precedent: mig 126 `admin_go_live_for_team`. **Consumer:** `apps/inorout/api/cron.js` `weeklyDigestJob` (hard-rule #14). Any return-shape change must stay aligned with the `_mailer.js` `hqWeeklyDigest` ctx builder. |
| `_hq_health_score(p_ops, p_util, p_completion, p_revenue DEFAULT NULL)` | _(internal — used by hq_get_company_state)_ | n/a (IMMUTABLE, not secdef) | Mig 179 (3 axes); **mig 182 added 4th `p_revenue` axis** (param-count change → old 3-arg DROPped). Weights ops .40 / util .30 / comp .30 / revenue .30; missing axes dropped + renormalised. Returns `{score, weakest}`. |
| `hq_set_dashboard_config(p_company_id, p_config)` | `hqSetDashboardConfig(companyId, config)` | authenticated | Mig 173. **WRITE** (ephemeral-verify gated). Validates shape, filters `cards` to the known 6 keys (order preserved), writes the caller's own `company_admins.dashboard_config`. Personal UI pref (not company data) → no audit. Returns `{ok, persisted, config}` (persisted=false for a platform_admin with no membership row). **Consumers:** apps/hq AnalyticsView edit mode. |

mig 172: `company_admins.dashboard_config jsonb NULL` (per-admin saved layout; NULL = default preset).

**Cycle 6.4 — live activity feed (mig 174):**

| RPC (SQL) | JS wrapper | Grant | Notes |
|---|---|---|---|
| `hq_get_activity(p_company_id)` | `hqGetActivity(companyId)` | authenticated | Mig 174. SECDEF, read-only. `{live:[tonight's fixtures + scores/status], upcoming:[soonest when none today], goals:[recent match_events goals], channels:[per-venue live_channel_key]}`. Role/region scoped. **Consumers:** apps/hq ActivityFeed (centre column) — subscribes to each `venue_live:<key>` channel + 30s poll. |

**Cycle 6.5 — HQ preview token (mig 175):**

| RPC (SQL) | JS wrapper | Grant | Notes |
|---|---|---|---|
| `hq_generate_preview_token(p_company_id)` | `hqGeneratePreviewToken(companyId)` | authenticated | Mig 175. **WRITE** (ephemeral-verify gated). **super_admin only** (regional_admin/analyst → `forbidden_role`). Inserts a 7-day `hq_preview_tokens` row; audits `hq_preview_token_generated`. Returns `{ok, token, expires_at}`. **Consumers:** apps/hq Share-preview button. |
| `get_hq_preview_state(p_token)` | `getHqPreviewState(token)` | **anon** + authenticated | Mig 175. SECDEF read (token is the secret). Validates + expiry (`expired_or_invalid`), stamps `accessed_at` on first open, returns a watermarked read-only company snapshot (company + venue health grid + summary; no drill-down/incidents/tokens). Whole-company (not role-scoped). **Consumers:** apps/hq PreviewView (`/hq/preview/TOKEN`). |

---

## MIGRATION FILE MAP

| Migration | Contents |
|---|---|
| 006 | RLS enable on all 19 tables |
| 007 | RLS team-scoped table policies |
| 008 | RLS financial/audit table policies |
| 010 | `get_team_state_by_player_token` + `get_team_state_by_admin_token` bulk RPCs |
| 011 | Player token RPCs: set_player_status, set_player_paid, set_player_injured, add_guest_player, save_push_subscription |
| 012 | Admin token RPCs: all admin write operations |
| 013 | Admin match/schedule RPCs |
| 014 | Admin payment RPCs |
| 015 | Onboarding: create_team |
| 016 | POTM: submit_potm_vote, get_potm_voting_state |
| 017+ | Incremental additions |
| 022 | link_player_to_user (authenticated only) |
| 026 | is_vice_captain migrated to team_players; players_public view updated |
| 027 | team_switches jsonb on matches |
| 028 | player_join_team (authenticated only) |
| 029 | price_per_player numeric(10,2) |
| 030 | drop create_team int variant |
| 031 | Group Balancer: team_players.group_number, settings.group_labels, matches.predicted_winner / predicted_confidence / balance_score; new RPCs admin_set_player_group + admin_clear_all_groups; admin_save_teams + admin_upsert_settings extended (old signatures dropped) |
| 032 | admin_reopen_week — fixes the cancel-then-relive toggle gap (admin_upsert_schedule writes neither is_cancelled nor active_match_id). Single RPC owns the clear-cancelled + fresh-matches-row + active_match_id update + audit_events insert. |
| 033 | ai_briefings table — Gaffer AI agent audit log; jsonb context_snapshot per row makes every LLM claim traceable. RLS: admins read own team admin rows, players read own player rows, writes via service role only. |
| 034 | gaffer_get_context_team_summary — Phase 1 surface RPC. |
| 035 | gaffer_get_context_payment_summary — Phase 1 surface RPC. |
| 036 | gaffer_get_context_attendance_risk — Phase 1 surface RPC. |
| 037 | gaffer_get_context_matchday_briefing — Phase 1 surface RPC. |
| 038 | players.admin_locked_in column + REPLACES admin_set_player_status (lock + cap), set_player_status (lock + cap), get_team_state_by_admin_token (includes admin_locked_in in squad rows). |
| 039 | `get_my_payment_history(p_token, p_limit)` + `get_my_injuries(p_token)` — Player-token-authed reads for the new player-facing PlayerProfile screen. Both SECURITY DEFINER; derive (player_id, team_id) from players.token via team_players join. GRANT to anon+authenticated. |
| 040 | `leave_squad(p_token)` + `delete_my_account(p_token)` — Player-token-authed destructive RPCs (self-leave + self-delete). leave_squad detaches team_players + push_subscriptions only; refuses with debt_owed. delete_my_account anonymises players row + detaches all teams; refuses with last_admin guard; returns auth_user_id for edge function follow-up. |
| 041 | `get_head_to_head_raw_by_admin_token(p_admin_token, p_me_id, p_them_id, p_period)` — SECURITY DEFINER raw-data RPC for H2H. Returns all-time matches, period-filtered matches, player_match rows for both players. Fixes anon /demoadmin direct-read RLS block. Anon grant (admin_token is the auth signal). |
| 042 | `get_player_league_table_raw_by_admin_token(p_admin_token, p_period)` — SECURITY DEFINER raw-data RPC for PlayerLeagueTable. Returns period matches, player_match rows, all-time attended summaries, all match dates (reliability denominator), player details. Same pattern as 041 — fixes anon /demoadmin StatsView (form + reliability columns) and H2H Section 4 (comparison bars). |
| 043 | admin_save_teams REPLACE — now also writes `players.team` ('A'/'B'/NULL scoped to team) when p_confirm=true so PlayerView Live Board renders the per-player team sheet. Previously only matches.team_a/team_b was written, leaving p.team stale. |
| 044 | `player_join_team` REPLACE — generates a player token on the new-player INSERT branch (was missing → first-time joiners landed with NULL token → JoinSuccess.jsx fell back to `/`). Pre-Beta launch blocker fixed before the invite link went out. |
| 045 | `platform_admins` table (global cross-team authorisation, separate from per-team team_admins) + `is_platform_admin()` helper + `superadmin_whoami()` RPC. Seeded with developer's auth uid. Foundation for the new apps/superadmin dashboard. |
| 046 | Superadmin read RPCs: `superadmin_list_teams()`, `superadmin_team_detail(p_team_id)`, `superadmin_recent_activity(p_limit, p_since)`. All gated by is_platform_admin(), all SECURITY DEFINER + STABLE, all return jsonb. Power the Activity / Teams / Team Detail tabs of the superadmin dashboard. |
| 047 | `delete_my_account(p_token)` REPLACE — purges FK refs to auth.users from team_admins, platform_admins.granted_by, user_profiles so auth.admin.deleteUser() succeeds. Pre-fix: SQL succeeded but auth row remained, blocking re-sign-in with the same email. Session 37. |
| 048 | `admin_save_teams` REPLACE — adds team_players scope to the two `UPDATE players SET team='A'/'B'` statements (the CLEAR was already scoped). Closes the cross-team write surface flagged in the pre-Beta audit. Foreign player_ids silently update 0 rows. Verified with adversarial + happy-path tests against live DB inside rolled-back transactions. |
| 049 | `notify_team_change` REPLACE — adds `player_account_deleted` to v_known_reasons whitelist (migration 047 passed this reason; warning was log-only, broadcast worked). Bonus diagnostic comment block in the file documenting the apex→www cron URL gotcha. |
| 155 | `get_player_competition_fixtures(p_token, p_filter)` — League Mode Phase 5 Cycle 5.3. Read-only player-facing competition fixtures (upcoming/past/all). See Phase 5 RPCs (shipped) table above. |
| 156 | `get_player_fixture_detail(p_token, p_fixture_id)` + `get_fixture_opposition_intel(p_token, p_fixture_id)` — League Mode Phase 5 Cycle 5.4. Read-only player-facing fixture detail + opposition intel, gated to the player's own competitions. See Phase 5 RPCs (shipped) table above. |
| 157 | `reset_team_status_on_fixture_played()` trigger fn + `trg_reset_status_on_fixture_played` AFTER UPDATE ON `fixtures` — League Mode Phase 5 Cycle 5.5. NOT an RPC. On `scheduled → completed/walkover/forfeit/void`, resets both teams' `players.status` to 'none' (+ `notify_team_change(...,'schedule_updated')`) so competitive availability (reusing the casual in/out board) starts fresh each game. SECURITY DEFINER, search_path locked. No new availability table/RPC — `set_player_status` (mig 011) is reused. |
| 158 | `join_register_team` REPLACE — League Mode session 55. A casual `existing_team_id` is rejected (`casual_team_cannot_register`); no in-place casual→competitive promotion. Closes the global-status dual-context must-fix structurally (a league team is always a separate squad). Also revoked stale anon EXECUTE grant. See Phase 2 registration table above. |
| 159 | `fixture_lineups` table + `team_admin_submit_lineup` + `get_team_next_fixture_lineup` — League Mode Phase 5 Cycle 5.6 Stage A. Teamsheet submission (submit registers picked players) + admin next-fixture read. See Phase 5 RPCs (shipped) table above. |
| 160 | `get_fixture_state_by_ref_token` REPLACE (lineup-aware) + internal helper `_fixture_squad_json` — League Mode Phase 5 Cycle 5.6 Stage B. Ref pre-match shows the submitted XI+bench when present (additive `lineup_role`), else the full registered squad unchanged. Backward compatible. See Phase 5 RPCs (shipped) table above. |
| 161 | `league_config.min_starting` + `max_subs` (nullable int, NULL = unbounded; CHECK >0 / >=0) — League Mode Phase 5 Cycle 5.7 Stage A part 1. Per-league matchday squad-size bounds for teamsheet enforcement. Additive (no backfill); flows through `get_league_config` via `to_jsonb(*)`. |
| 162 | `team_admin_check_eligibility` (read) + `team_admin_submit_lineup` DROP/REPLACE (authoritative eligibility gate: squad-size, double-reg block + audit, suspended override) + `get_team_next_fixture_lineup` REPLACE (VC dual-lookup) — League Mode Phase 5 Cycle 5.7 Stage A part 2. **Phase 5 complete.** See Phase 5 RPCs (shipped) table above. |
| 164 | `venues.display_token` (UNIQUE, auto-gen default) + `venues.display_config` jsonb + 8 companion read indexes — League Mode **Phase 4** reception display schema. Additive. |
| 165 | `get_display_state(p_display_token)` — venue-scoped read for the reception big-screen (confirmed + live standings, top scorers, live fixtures, upcoming/recent, goals ticker). See Phase 4 RPCs above. |
| 166 | `check_display_pin(p_display_token, p_pin)` — read-only PIN check (PIN stays server-side; client owns lockout). |
| 167 | `venue_update_display_config(p_venue_token, p_config, p_display_pin)` — operator write for display panel config + PIN. ephemeral-verify PASS. |
| 168 | `venue_get_state` REPLACE — venue object additively gains `display_token` + `display_config` for the apps/venue settings editor. |
| 169 | `venues.region text NULL` — regional_admin scoping for the HQ dashboard (Phase 6.1). Additive. |
| 170 | Demo company seed `company_demo` (Demo Sports Group) — links demo_venue (North) + venue_demo_south (South), tarny super_admin, 2 open incidents. Namespaced + reversible (`170_down`). |
| 171 | Phase 6 HQ RPCs — `resolve_company_caller`, `company_admin_whoami`, `hq_get_company_state`, `hq_get_venue_detail`, `hq_resolve_incident` (write). + `audit_events.actor_type`+='company_admin' + `notify_venue_change` whitelist+='incident_resolved'. rpc-security-sweep + ephemeral-verify PASS. |
| 172 | `company_admins.dashboard_config jsonb NULL` — per-admin HQ dashboard layout (Phase 6.3). |
| 173 | Phase 6.3 composable analytics — `hq_get_analytics` (read, 6 card datasets + caller layout) + `hq_set_dashboard_config` (write). rpc-security-sweep + ephemeral-verify PASS. |
| 174 | Phase 6.4 live activity feed — `hq_get_activity` (read; tonight/upcoming fixtures + goals ticker + venue channel keys). rpc-security-sweep PASS. |
| 175 | Phase 6.5 HQ preview token — `hq_generate_preview_token` (write, super_admin) + `get_hq_preview_state` (anon read, watermarked snapshot + accessed_at stamp). rpc-security-sweep + ephemeral-verify PASS. |
| 163 | `notification_log` + `channel`/`entity_id`/`recipient` (nullable) + partial email-dedup index — League Mode **Phase 9 Cycle 9.1**. Lets transactional email (Resend) be logged/deduped alongside web-push. No RPC change — the email layer (`api/_mailer.js` + `onboardingEmailJob` in `api/cron.js`) is a read-only consumer of existing audit actions (`team_registration_submitted`/`team_approved`/`team_rejected`/`fixture_ref_assigned`). |
| 204 | (session 68) `admin_go_live` + `admin_go_live_for_team` REPLACE — on **new-match creation** reset the squad board: status='none', admin_locked_in=false, team=NULL for all team_players. Payment fields carry over. Fixes week-rollover "teams stay locked, can't say in/out" (carried status='in' made the squad read full → set_player_status squad_full). |
| 205 | (session 68) `admin_save_match_result` REPLACE — freshness now keyed on `matches.winner` (NULL until first finalisation; the kickoff lineup-lock pre-creates player_match and defeated the old row-count check, silently skipping the whole cascade). Adds payment_ledger game_fee/unpaid charge per unpaid non-guest attendee + bib_history cascade. Fixes £0-outstanding, empty payment history, dead admin Bib tracker. (Applied 205→205b; 205b qualified latent ambiguous p.attended/p.goals exposed once the block ran.) |
| 206 | (session 68) `admin_save_match_result` REPLACE — also clears `admin_locked_in` in the fresh-save reset, closing the cross-week stuck-lock gap on the idempotent go-live reuse path. |
| 207 | (session 70) `admin_go_live` + `admin_go_live_for_team` REPLACE — on **new-match creation**, delete all is_guest=true rows for the team (team_players first, then players) before the status reset. Fixes stale guest row blocking the Plus One button each week. Gated to new-match path only. |

**Note:** Migrations 013–016 headers say "DO NOT EXECUTE" — stale from Phase B design phase.
All were deployed in Phase C via Supabase SQL editor.

---

## SUPABASE SCHEMA CACHE

PostgREST caches function signatures. After any RPC change, cache may serve stale version.

Symptoms: 404 on a function that exists, wrong parameter order error.

Fix: `SELECT pg_notify('pgrst', 'reload schema');` in Supabase SQL editor.

---

## PITCH BOOKING RPCs (migrations 133+)

Stage 3 read RPCs (booking-owned). Write RPCs (`book_pitch_*`,
`venue_confirm_booking`, etc.) land in Stage 4; JS wrappers land with the
casual/venue UI (Stages 5/6).

| SQL function | JS wrapper | Grant | Notes |
|---|---|---|---|
| `search_bookable_venues(p_query)` | `searchBookableVenues(q)` | anon, authenticated | Typeahead over `venues` WHERE `bookings_enabled`+`active`, name/slug/city ILIKE, LIMIT 20. Returns `[{venue_id,name,slug,city,cancellation_policy}]` (policy added mig 149). PII-free. *Consumers: `apps/inorout` ScheduleScreen booking modal.* |
| `get_team_bookings(p_team_id)` | `getTeamBookings(teamId)` | **authenticated** | Casual read of the team's own bookings (recent + future) with venue/pitch/policy detail. Auth via `auth.uid()` → `team_admins`. Powers the in-app bookings list, live Requested→Confirmed badge, recent-venues discovery, cancel. mig 148. *Consumer: `apps/inorout` ScheduleScreen (Stage 5).* |
| `get_pitch_free_slots(p_venue_id, p_date, p_playing_area_id?, p_slot_length?)` | `getPitchFreeSlots(...)` (Stage 5) | anon, authenticated | Expands `playing_areas.booking_windows` for `p_date`'s weekday → back-to-back slots per offered length → subtracts active `pitch_occupancy`. Graceful default 08:00–22:00/60 when a pitch has no windows. Returns `[{playing_area_id,pitch_name,slot_start,slot_end,slot_minutes}]`. PII-free. *Consumers: `apps/inorout` booking modal (Stage 5).* |
| `get_pitch_occupancy(p_venue_token, p_from, p_to)` | `getPitchOccupancy(...)` (Stage 6) | anon, authenticated (token is the secret) | Venue calendar grid: one row per active occupancy row joined to fixture/booking/maintenance detail over `[p_from, p_to]`. **Returns PII** (team names, walk-in names) → venue-operator only via `resolve_venue_caller`. *Consumers: `apps/venue` resource-timeline calendar (Stage 6, hard-rule #14).* |

Stage 4 write RPCs (booking-owned). Each: SECURITY DEFINER, holds/frees a
`pitch_occupancy` row through the partial EXCLUDE (taken slot → `slot_unavailable`),
audits (Phase 2 shape), broadcasts `notify_venue_change` + `notify_team_change`.
JS wrappers land with the consuming UI (Stages 5/6).

| SQL function | JS wrapper | Grant | Notes |
|---|---|---|---|
| `book_pitch_adhoc(p_team_id, p_playing_area_id, p_booking_date, p_kickoff_time, p_slot_minutes?)` | `bookPitchAdhoc(...)` (Stage 5) | **authenticated** | Casual one-off request. Auth via `auth.uid()` → `team_admins` (must administer `p_team_id`). Status `requested`, occupancy priority 3. Fires `booking_requested`. *Consumer: `apps/inorout` booking modal (Stage 5).* |
| `book_pitch_series(p_team_id, p_playing_area_id, p_kickoff_time, p_start_date, p_weeks, p_slot_minutes?)` | `bookPitchSeries(...)` (Stage 5) | **authenticated** | Casual block request. Creates `booking_series` + N weekly `pitch_bookings` (priority 2) atomically (any clash → `slot_unavailable`). `day_of_week` derived from `p_start_date`. Fires `booking_requested`. *Consumer: `apps/inorout` (Stage 5).* |
| `venue_create_booking(p_venue_token, p_playing_area_id, p_booking_date, p_kickoff_time, p_slot_minutes?, p_team_id?, p_booked_by_name?)` | `venueCreateBooking(...)` (Stage 6) | anon, authenticated | Walk-in/phone → status `confirmed` directly. Walk-in = `team_id` NULL + `booked_by_name`. Fires `booking_confirmed`. *Consumer: `apps/venue` walk-in (Stage 6).* |
| `venue_confirm_booking(p_venue_token, p_booking_id)` | `venueConfirmBooking(...)` (Stage 6) | anon, authenticated | `requested` → `confirmed` (refuses if not pending — e.g. superseded by a fixture). Fires `booking_confirmed`. *Consumer: `apps/venue` requests inbox (Stage 6).* |
| `venue_decline_booking(p_venue_token, p_booking_id)` | `venueDeclineBooking(...)` (Stage 6) | anon, authenticated | `requested` → `declined`, frees the slot. Fires `booking_declined`. *Consumer: `apps/venue` inbox (Stage 6).* |
| `cancel_booking(p_booking_id, p_venue_token?)` | `cancelBooking(...)` (Stage 5/6) | anon, authenticated | Dual auth: venue token OR team admin (`auth.uid()`). Walk-ins venue-only. `requested`/`confirmed` → `cancelled`, frees slot. Fires `booking_cancelled`. *Consumers: both apps.* |
| `cancel_booking_series(p_series_id, p_venue_token?)` | `cancelBookingSeries(...)` (Stage 5/6) | anon, authenticated | Dual auth (same as above). Cancels the series + its live weekly bookings, frees their slots. Fires `booking_cancelled`. *Consumers: both apps.* |
| `venue_update_booking_settings(p_venue_token, p_updates)` | `venueUpdateBookingSettings(...)` (Stage 6) | anon, authenticated | Venue settings write (mig 150; `default_prime_time_windows` mig 177; **`payment_link` mig 183**). Keys: `bookings_enabled` (bool), `cancellation_policy` (text, blank→NULL), `default_prime_time_windows` (jsonb), `payment_link` (text, validated `^https?://`, blank→NULL). Auth via `resolve_venue_caller`. Audit + `notify_venue_change('venue_updated')`. *Consumer: `apps/venue` BookingSettings + PaymentsView (pay-link editor).* |
| `venue_add_fixture_charge(p_venue_token, p_fixture_id, p_team_id, p_amount_pence DEFAULT NULL)` | `venueAddFixtureCharge(token, fixtureId, teamId, amountPence?)` | anon, authenticated | **WRITE** (mig 183, ephemeral-verify gated). Manual per-team fixture charge. Amount = arg or `league_config.fixture_fee_pence`. Validates fixture∈venue + team∈fixture; rejects `charge_exists` (active dup), reactivates a `refunded` charge (clears status→unpaid then `_recompute_charge_status`). Audit `charge_created`; `notify_venue_change('charge_updated')`. *Consumer: `apps/venue` PaymentsView Add-charge.* |
| `venue_void_charge(p_venue_token, p_charge_id)` | `venueVoidCharge(token, chargeId)` | anon, authenticated | **WRITE** (mig 183, ephemeral-verify gated). Sets charge `status='refunded'` (drops from owed/collected), payments kept; idempotent (`already:true`). Audit `charge_voided`; `notify_venue_change('charge_updated')`. *Consumer: `apps/venue` PaymentsView Void.* |
| `create_renewal_holds()` | *(none — cron only)* (Stage 7) | **service_role** | Reserves the next block for any series ending ≤21d (mirror original length; holds `pitch_bookings.status='hold'` + active occupancy priority 2; origin→`ending`). Skips if the slot's taken. Audit `system`/`booking_renewal_held`; notify both channels. mig 152. *Consumer: `apps/inorout/api/cron.js renewalHoldsJob`.* |
| `confirm_renewal(p_series_id)` | `confirmRenewal(seriesId)` (Stage 7) | **authenticated** | Team "keep my slot": `auth.uid()`→`team_admins`, flips held weeks `hold`→`requested` (venue re-approves via the inbox), origin→`cancelled`. Rejects `renewal_lapsed`/`not_team_admin`. Fires `booking_requested`. mig 152. *Consumer: `apps/inorout` ScheduleScreen.* |
| `expire_renewal_holds()` | *(none — cron only)* (Stage 7) | **service_role** | Releases holds past `hold_expires_at` (occupancy off, `hold`→`expired`, series→`cancelled`). Audit `system`/`booking_renewal_expired`; notify both. mig 152. *Consumer: `cron.js renewalHoldsJob`.* |
| `get_team_admin_player_ids(p_team_id)` | *(none — cron only)* (Stage 7) | **service_role** | Returns the team's active-admin player ids (`team_admins`→`players.user_id`) for push targeting. mig 152. *Consumer: `cron.js` push helpers.* |
| `venue_list_staff(p_venue_token)` | `venueListStaff(token)` | anon, authenticated | Read. Returns `{ ok, staff: [...] }` from `venue_staff` for the caller's venue (token→`resolve_venue_caller`). mig 195. *Consumer: `apps/venue` StaffView (Venue Staff section).* |
| `venue_add_staff(p_venue_token, p_staff)` | `venueAddStaff(token, staff)` | anon, authenticated | **WRITE** (mig 195, ephemeral-verify gated). Inserts a `venue_staff` row (role ∈ reception/manager/admin/groundstaff/coach/other). Validates name + role. Audit `staff_added`; `notify_venue_change('staff_added')`. *Consumer: `apps/venue` StaffMemberForm.* |
| `venue_update_staff(p_venue_token, p_staff_id, p_updates)` | `venueUpdateStaff(token, id, updates)` | anon, authenticated | **WRITE** (mig 195, ephemeral-verify gated). Patches a venue-owned `venue_staff` row (ownership-checked → `staff_not_found`). Audit `staff_updated`; `notify_venue_change('staff_updated')`. *Consumer: `apps/venue` StaffMemberForm.* |
| `venue_get_team_roster(p_venue_token, p_team_id)` | `venueGetTeamRoster(token, teamId)` | anon, authenticated | Read. Returns `{ ok, team, players[], competitions[] }` for a team that plays in one of the caller's competitions (ownership via competition_teams→competitions→seasons→leagues→venue_id → `team_not_in_venue`). Excludes token/user_id/phone. mig 196. *Consumer: `apps/venue` TeamDetail.* |
| `venue_get_standings(p_venue_token, p_competition_id)` | `venueGetStandings(token, compId)` | anon, authenticated | Read. League table for a round-robin competition, computed from completed/walkover/forfeit fixtures (walkover/forfeit = 3-0). Ranked pts→gd→gf→name. Ownership via competition→season→league→venue_id → `competition_not_in_venue`. mig 197. *Consumer: `apps/venue` LeagueTable.* |
| `venue_list_players(p_venue_token)` | `venueListPlayers(token)` | anon, authenticated | Read. Every player across all teams in the caller's competitions (one row per player·team), with team name/colour + stats. Excludes token/user_id/phone. mig 198. *Consumer: `apps/venue` PlayersView.* |
| `league_list_teams(p_league_token)` | `leagueListTeams(token)` | anon, authenticated | Read. Teams across the league's competitions (id/name/colours) — league_get_state has no teams map, so the league app uses this for fixture name resolution + Teams view. resolve_league_caller → `invalid_league_token`. mig 199. *Consumer: `apps/league`.* |
| `league_get_standings(p_league_token, p_competition_id)` | `leagueGetStandings(token, compId)` | anon, authenticated | Read. League table by league_admin_token (same maths as venue_get_standings); ownership via competition→season.league_id → `competition_not_in_league`. mig 200. *Consumer: `apps/league` LeagueTable.* |
| `league_update_fixture_result(p_league_token, p_fixture_id, p_home_score, p_away_score, p_reason)` | `leagueUpdateFixtureResult(token, fixtureId, h, a, reason)` | anon, authenticated | **WRITE** (mig 201, ephemeral-verify gated 8/8 + live UI round-trip). League-admin correction of a **completed** fixture's score (mirrors venue_update_fixture_result). Ownership via competition→season.league_id → `fixture_not_in_league`; rejects non-completed/negative/missing-reason. Audits prev+new; notifies both teams + league + venue. *Consumer: `apps/league` ResultModal.* |
| `league_update_fixture_status(p_league_token, p_fixture_id, p_new_status, p_metadata)` | `leagueUpdateFixtureStatus(token, fixtureId, status, meta)` | anon, authenticated | **WRITE** (mig 202, ephemeral-verify gated). Postpone/void/walkover/forfeit (mirrors venue_update_fixture_status mig 096); same transition rules + reason/winner validation. Ownership via competition→season.league_id. Audits; notifies league+venue+teams. *Consumer: `apps/league` FixtureManageModal.* |
| `league_reschedule_fixture(p_league_token, p_fixture_id, p_scheduled_date, p_kickoff_time, p_reason)` | `leagueRescheduleFixture(token, fixtureId, date, time, reason)` | anon, authenticated | **WRITE** (mig 203, ephemeral-verify gated). Moves a fixture's date/time (from scheduled/allocated/postponed → `cannot_reschedule` otherwise); rescheduling a postponed fixture revives it (→allocated if it has a pitch, else scheduled) and clears postpone_reason. Audits prev+new. *Consumer: `apps/league` FixtureManageModal.* |

---

## ADDING A NEW RPC — CHECKLIST

1. Write SQL in Supabase SQL editor first — never via Claude Code
2. Use `SECURITY DEFINER`
3. `REVOKE ALL` from anon if authenticated-only
4. `GRANT EXECUTE` to correct role
5. Authenticate via `auth.uid()` or token param — never trust passed user_id
6. Return `jsonb`
7. Add wrapper in `packages/core/storage/supabase.js`
8. Export from `packages/core/index.js` barrel
9. Import at call site
10. Verify: grep confirms RPC name appears in exactly ONE `supabase.rpc()` call in supabase.js
