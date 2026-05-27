# In or Out — RPC Inventory
*Last updated: May 24 2026 (session 39 — superadmin RPCs 045/046 + admin_save_teams scoping 048 + notify whitelist 049 + player_join_team token 044)*

All client writes go through these SECURITY DEFINER RPCs. Raw SQL names appear
only inside `supabase.rpc()` calls in `packages/core/storage/supabase.js`.

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

---

## PLAYER TOKEN RPCs (migration 011)

| SQL function | JS wrapper | Grant | Notes |
|---|---|---|---|
| `set_player_status` | `setPlayerStatus(token, status)` | anon | Sets status on players row. Refuses 'in' if `admin_locked_in=true` (raises `admin_locked_in`). Refuses 'in' if squad_size cap met (raises `squad_full`). Updated in migration 038. |
| `set_player_paid` | `handleCashPayment(token)` | anon | Sets self_paid; clears owes atomically if owes > 0 |
| `set_player_injured` | `insertPlayerInjury(token, injured)` | anon | Writes player_injuries row |
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
| `admin_confirm_payment` | `handleMarkPaid(adminToken, playerId, matchId)` (payments.js) / `confirmPayment(adminToken, playerId, matchId)` (supabase.js) | Sets paid=true; ledger cross-path promotion |
| `admin_reset_payment` | `handleResetPayment(adminToken, playerId, matchId)` | Resets all payment flags + ledger |
| `admin_waive_debt` | `handleWaiveDebt(adminToken, playerId, note)` | Zeros owes; writes waiver ledger entry; notify |
| `admin_save_match_result` | `saveMatchResult(matchId, teamId, adminToken, match)` | Writes result fields only; never touches motm/voting |
| `admin_save_teams` | `confirmTeams(adminToken, matchId, teamA, teamB, predictedWinner?, predictedConfidence?, balanceScore?)` | Sets matches.team_a/team_b on confirm + writes denormalised players.team (clears for all team_players, then sets 'A'/'B' on the confirmed ids) so PlayerView Live Board renders the team sheet. 3 trailing prediction params (Group Balancer, migration 031) write to matches.predicted_winner/confidence/balance_score. Migration 043 added players.team write; **migration 048 scoped the two SET statements via team_players join to close a cross-team write surface** (a legit admin for team X could previously pass team Y player_ids in p_team_a/p_team_b and flip their team value — foreign IDs now silently filtered). Migration 031 added prediction params. Old 5-arg signature dropped. |
| `admin_save_bib_holder` | `saveBibHolder(adminToken, matchId, playerId, name)` | 4-step atomic: match bib_holder, player bib_count++, bib_history upsert, had_bibs flag |
| `admin_cancel_match` | `adminCancelMatch(adminToken, reason)` | Atomic cancel — replaces 7-step cancelWeek() |
| `admin_reopen_week` | `reopenWeek(adminToken)` | Reopens a cancelled week: clears schedule.is_cancelled / cancel_reason, sets game_is_live=true, inserts a fresh matches row, points active_match_id at it. Previously cancelled match stays in history (cancelled=true). Migration 031 sibling. |
| `admin_upsert_schedule` | `upsertSchedule(adminToken, schedule)` | Includes p_game_is_live (added session 27) |
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
| `get_fixture_state_by_ref_token` | `getFixtureStateByRefToken(refToken)` | Migration 119. Single-fixture read for the ref pre-match + resume path. Returns `{fixture, competition, league, venue, pitch, official, home_team, away_team, home_squad, away_squad, events, caller}`. Migration 120 added `fixture.actual_kickoff_at` for the live-timer source. Squads derived from `player_registrations` joined to `players` filtered to `status='active'`. Events ordered by `(minute, created_at)` for offline-resume. Raises `invalid_ref_token`. |
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
- `get_player_competition_fixtures(p_token, p_filter)` — Cycle 5.3
- `get_player_fixture_detail(p_token, p_fixture_id)` — Cycle 5.4
- `get_fixture_opposition_intel(p_token, p_fixture_id)` — Cycle 5.4
- `player_set_fixture_availability(p_token, p_fixture_id, p_status)` — Cycle 5.5 (+ new `player_availability` table)
- `team_admin_submit_lineup(p_admin_token, p_fixture_id, p_lineup)` — Cycle 5.6 (+ new `fixture_lineups` table + update to `get_fixture_state_by_ref_token`)
- `team_admin_check_eligibility(p_admin_token, p_fixture_id, p_player_ids)` — Cycle 5.7

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

**Note:** Migrations 013–016 headers say "DO NOT EXECUTE" — stale from Phase B design phase.
All were deployed in Phase C via Supabase SQL editor.

---

## SUPABASE SCHEMA CACHE

PostgREST caches function signatures. After any RPC change, cache may serve stale version.

Symptoms: 404 on a function that exists, wrong parameter order error.

Fix: `SELECT pg_notify('pgrst', 'reload schema');` in Supabase SQL editor.

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
