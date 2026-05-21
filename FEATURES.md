# In or Out — Feature Tracker
*Last updated: May 21 2026 (session 28)*

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
| **Bug fixes (Pre-UAT)** | 🔴 Must do | See BUGS.md #1 (POTM eligibility 401) |
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
| BibsScreen fix under RLS | See BUGS.md #4 |
| CreateTeam email pre-fill | See BUGS.md #10 |
| "Make game live" new admin hint | See BUGS.md #11 |
| Last goal scorer in IO Intelligence | `last_goal_scorer` field on matches — just wire into a card |
| Bib streak insight | Consecutive bib games — data in `bib_history` |
| WhatsApp share text update | Update share copy in HistoryView |
| BibsScreen RLS write fix | BibsScreen redesigned ✅; standalone write still broken — see BUGS.md #2 |

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
