# In or Out — RPC Inventory
*Last updated: May 23 2026 (session 33 — Gaffer Phase 1 context RPCs)*

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

## PLAYER TOKEN RPCs (migration 011)

| SQL function | JS wrapper | Grant | Notes |
|---|---|---|---|
| `set_player_status` | `setPlayerStatus(token, status)` | anon | Sets status on players row. Refuses 'in' if `admin_locked_in=true` (raises `admin_locked_in`). Refuses 'in' if squad_size cap met (raises `squad_full`). Updated in migration 038. |
| `set_player_paid` | `handleCashPayment(token)` | anon | Sets self_paid; clears owes atomically if owes > 0 |
| `set_player_injured` | `insertPlayerInjury(token, injured)` | anon | Writes player_injuries row |
| `add_guest_player` | `addGuestPlayer(hostToken, guestName)` | anon | Creates guest player row |
| `save_push_subscription` | `savePushSubscription(token, sub)` | anon | Upserts push_subscriptions |

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
| `admin_save_teams` | `confirmTeams(adminToken, matchId, teamA, teamB, predictedWinner?, predictedConfidence?, balanceScore?)` | Sets team_a/team_b on confirm; 3 trailing prediction params (Group Balancer, migration 031) write to matches.predicted_winner/confidence/balance_score. Old 5-arg signature dropped. |
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
| `player_join_team` | `playerJoinTeam(teamId, name)` | authenticated only | Handles new + returning players; upserts team_players |
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
