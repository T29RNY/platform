# In or Out — Feature Tracker
*Last updated: May 23 2026 (session 31 — Smart Teams redesign + admin home polish + player tile rework)*

---

## PHASE 1 — COMPLETED

| Feature | Status | Notes |
|---|---|---|
| Rotate Supabase keys | ✅ | New key in CONTEXT.md INFRASTRUCTURE |
| PlayerView redesign | ✅ | Session 6 |
| StatsView rebuild | ✅ | IO Statbook |
| HistoryView rebuild | ✅ | Results screen |
| AdminView rebuild | ✅ | Session 6 |
| player_match + player_career tables | ✅ | Session 6 |
| player_injuries table | ✅ | Session 6 |
| Teams confirmed view | ✅ | Form dots, POTM trophy, bibs indicator |
| Demo environment | ✅ | team_demo, 25 players, 22 matches, /demoadmin, auto-reset |
| POTM + Results display text | ✅ | POTM not MOTM, Results not History in UI |
| My IO screen | ✅ | MyIOView.jsx, useIOIntelligence.js — session 8 |
| POTM voting system | ✅ | Modal, cron jobs, push, admin tiebreak — session 10 |
| ScoreScreen | ✅ | 6-stage progressive flow, score_type, last_goal_scorer — session 11 |
| Admin view consistency | ✅ | Sticky heroes, 5-tab admin nav, Gaffer disabled — session 12 |
| Player League Table | ✅ | PlayerLeagueTable.jsx + getPlayerLeagueTable — session 20 |
| Admin screens redesign | ✅ Done | ScheduleScreen ✅ (s13), TeamsScreen ✅ (s21), SquadScreen ✅ (s22), BibsScreen ✅ (s28) |
| Vice Captain system | ✅ | VC toggle, PlayerProfile ROLES, HeroCard ADMINS, access gating — sessions 22–23 |
| Payments admin screen | ✅ | PaymentsScreen.jsx — 4-section layout, ledger dedup — session 22 |
| Stats rewrite (player_match) | ✅ | All leaderboards from player_match via getPlayerLeagueTable — session 22 |
| Payment ledger dedup | ✅ | createLedgerEntry resilient insert, partial-index-aware — sessions 22–23 |
| Head to Head card | ✅ | 5-section, 5-verdict chemistry, period selector — sessions 22–23 |
| Pre-launch /create + /join audit | ✅ | user_id propagation, protocol fix, iOS-only redirect gate — session 23 |
| Onboarding redesign | ✅ | SetupLoadingScreen + SquadReady, AddPlayers removed — session 27 |
| JoinSuccess install screen | ✅ | Platform-detected (iOS/Android/desktop) — session 8 |
| RLS + security hardening | ✅ | 47 SECURITY DEFINER RPCs, all 19 tables locked — session 24 |
| /create auth gate | ✅ | Hard auth gate + ioo_pending_route sessionStorage — session 24 |
| team_admins table | ✅ | Written by create_team RPC — session 24 |
| link_player_to_user RPC | ✅ | Authenticated-only, migration 022 — session 24 |
| All player_match reads via RPC | ✅ | get_team_state_by_player_token extended — session 25 |
| Multi-team player switcher | ✅ | player_get_teams RPC, MySquads.jsx — session 26 |
| is_vice_captain cross-team fix | ✅ | Migrated to team_players, migration 026 — session 26 |
| Live board POTM + bibs + form dots | ✅ | lastMatchMeta + playerForm via RPC — session 25 |
| Teams confirmed realtime | ✅ | confirmedThisSession ref, teamsConfirmedRef — session 25 |
| POTM voting RLS fix | ✅ | submit_potm_vote + get_potm_voting_state RPCs — session 25 |
| Join/login redesign | ✅ | Full JoinTeam.jsx rebuild — session 27 |
| Dead code cleanup | ✅ | Pre-RLS direct writes removed — session 28 |

---

## PHASE 1 — BLOCKED

| Feature | Blocker |
|---|---|
| Stripe Connect | Needs Stripe platform account setup |
| Apple Sign In | Needs Apple Dev account £79 |

---

## PHASE 2 — TARGET MAY 26 (Stage 2)

| Feature | Status | Notes |
|---|---|---|
| **Bug fixes (Pre-UAT)** | ✅ All cleared session 28 | No Pre-UAT blockers remaining |
| **Mid-game team switches** | ✅ Done session 28 | ScoreScreen new stage, team_switches jsonb, final team → W/L/D. See DECISIONS.md for spec. |
| **Most Faced Opponent card** | 🔲 Not built | Unlocks at 4+ games. Fills unlock grid gap. |
| **Reliability Ranking card** | 🔲 Not built | Unlocks at 5+ games. Fills unlock grid gap. |
| **Monday Footy onboarding** | 🔲 Pending | Stage 2 addition — if Stage 1 week 1 clean |
| owes double-increment guard | ✅ Done session 26 | carryForwardDebts removed; updatePlayerRecords is sole path |
| Multi-team player switcher | ✅ Done session 26 | MySquads.jsx |

---

## PHASE 2 — BACKLOG (pre-broader-beta ~Jun 9)

| Feature | Notes |
|---|---|
| BibsScreen fix under RLS | See BUGS.md #1 |
| CreateTeam email pre-fill | ✅ Done session 29 |
| "Make game live" new admin hint | ✅ Done session 29 |
| Install screen on create flow (SquadReady) | ✅ Done session 30 — shared `InstallSection` extracted from JoinSuccess, inlined into SquadReady with sticky "Go to my team" CTA. Desktop copy-link targets admin URL. |
| Last goal scorer in IO Intelligence | `last_goal_scorer` field on matches — just wire into a card |
| Bib streak insight | Consecutive bib games — data in `bib_history` |
| WhatsApp share text update | Update share copy in HistoryView |
| BibsScreen RLS write fix | BibsScreen redesigned ✅; standalone write still broken — see BUGS.md #2 |
| **Smart Teams TeamsScreen redesign** | ✅ Session 31 — full live-board rewrite. Auto-Smart fires on entry when no teams set; LiveBoard mirrors PlayerView's confirmed-teams tile (Team A \| B grid with chips); tap-to-move between teams; SMART panel open from start with Group 1 + Group 2 seeded; BUILD TEAMS contextual CTA only when groups dirty; prediction recomputes on every manual move; prediction chip hides when one side is empty; PLAYERS row list removed entirely; bottom CONFIRM TEAMS button (was ambiguous "DONE"). |
| **Smart Teams adoption analytics** | ✅ Session 31 — `team_confirmed` PostHog event as analytical anchor + `team_drafted_auto` / `team_player_moved` / `team_regenerated` / `team_cleared`. Tracks manual_moves_before/after, regenerate_count, was_ai_picked_as_is, is_recommit. Single-filter answers to "is the algorithm being trusted?" |
| **Admin home polish** | ✅ Session 31 — cancel-then-relive bug fixed via new `admin_reopen_week` RPC (creates fresh match, cancelled stays in history). Game-live toggle: "Make this week's game live" when off; collapses to a "LIVE" badge when on (no toggle, admin uses Cancel This Week). This Week tiles moved up to immediately after the toggle. Notifications block removed from Match Settings (duplicate of Notifications tab, demo confusion). |
| **Player status tile rework** | ✅ Session 31 — weekday now derives from admin-configured `dayOfWeek` first (was deriving wrong day from drifted `gameDateTime`). Locked-in banner slide-fades after 5s. Pre-response prompt nudges with "Tap below ↓"; collapses to date+kickoff after response. Status row pulses gold while unresponded; flashes status-matched colour on tap (in→green, out→red, maybe→amber, reserve→purple). Haptic tap-tick (Android only — iOS Safari no-ops). Banners suppressed on page refresh. |
| **Smart Teams** (internal: Group Balancer) | ✅ Built + live session 30 (May 22). Schema + 2 new RPCs (`admin_set_player_group`, `admin_clear_all_groups`) + 3 modified RPCs applied via migration `031_group_balancer_stage_1b`. Pure algorithm `packages/core/engine/groupBalancer.js` (sample-200 for big groups, lower-headcount odd-extra rule, win-rate-nudged splits within 5% noise floor). UI: tap-to-move panels, inline labels, IO Prediction card, Needs Group amber banner, ADD/× empty panels (panel persists once populated — × dismisses only when empty). HistoryView prediction chip (null-safe, forward-only). Replaces Fisher-Yates; no feature flag — always on. PostHog `posthog.group('team', teamId)` identification added (enables per-team analytics + future flag targeting). Deferred to Phase 2: `teams_draft` group snapshot (predicted_winner is already saved at confirm so the accuracy stat works without it). |
| **Ask the Gaffer — Phase 1** | Read-only AI assistant: team summary, payment summary, attendance risk, suggested next actions, matchday briefing. See "Ask the Gaffer" section below. |
| **Marketing landing page** | Conditional render at root (Option A) for beta — unauth + no token → landing, else app shell. See DECISIONS.md. |

---

## PHASE 3 — MONTH 2+

| Feature | Notes |
|---|---|
| iOS + Android native | Capacitor |
| Apple Sign In native | After Dev account |
| Apple Watch goal logger | ~28h. Requires Capacitor iOS first + Apple Dev account |
| Venue white-label | After user numbers |
| Booking integration | Needs venue API |
| WhatsApp Business API | Phase 3 notifications |
| Club Manager | Second product, B2B |
| Grassroots app | Full stats: assists, cards, ratings |
| In or Out Ltd | Companies House £12 |
| Trademark | ~£170 UK |
| Super admin dashboard | Read-only, Tarny only. Required for PUBLIC launch. |
| IO Wrapped | End of season shareable card |
| Monthly summary notifications | End of month push |
| Streak notifications | 3/5/10 game streaks |
| Random player signup | Postcode, availability |
| Admin find a random | Radius search, ping system |
| Player profile cross-team | Career stats, player_career table |

---

## PHASE 4 — LEAGUE MODE (parked)

See full spec in `CONTEXT.md` (League Mode section) and `DECISIONS.md`.

---

## ASK THE GAFFER — AI football-operations agent

Repurposes the disabled Gaffer tab in AdminView as a football-operations agent
grounded in the team's actual data. **Not a generic chatbot.** Four-phase
trust-graduated rollout. See DECISIONS.md for the rationale.

| Phase | Capability | Status |
|---|---|---|
| 1 — Read-only assistant | Ask the Gaffer Q&A, team summary, payment summary, attendance risk, suggested next actions, matchday briefing | 🔲 Not built (Phase 2 backlog) |
| 2 — Recommendations | Fair team suggestions (calls `generateBalancedTeams`), reserve recs, payment chase drafts, weekly match summary, player insight explanations | 🔲 Not built (Phase 3) |
| 3 — Confirmed actions | "Send chase", "Notify reserves", "Use these teams", "Post match summary", "Confirm payment reminders" — admin one-tap approve | 🔲 Not built (Phase 3) |
| 4 — Semi-autonomous | Auto-detect short squads, auto-draft notifications, auto-suggest reserve pings, auto-produce weekly admin report. Player-visible actions still require approval. | 🔲 Not built (Phase 3) |

Sequencing: Phase 1 lands after Group Balancer (Group Balancer's
`generateBalancedTeams` becomes a building block for Gaffer Phase 2).

---

## IO INTELLIGENCE — UNLOCK GRID

| Games | Unlocks |
|---|---|
| 1+ | Goals, POTM, W/L/D, Attendance ring, Reliability, Form strip |
| 2+ | Win Rate card ✅ built |
| 3+ | Current Run card ✅ built |
| 4+ | Most Faced Opponent 🔲 NOT built |
| 5+ | Reliability Ranking 🔲 NOT built |
| 6+ | Most Played With card ✅ built |
| 7+ | Team Impact card ✅ built |
| 8+ | Nemesis, Best Partnership, Advanced Chemistry cards ✅ built |
| 16+ | Legacy Insights ✅ built |
