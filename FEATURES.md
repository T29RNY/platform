# In or Out — Feature Tracker
*Last updated: May 26 2026 (session 48 — League Mode rename + Phase 2 Cycles 2.1–2.7a — foundations, reads, engines, season setup, fixture management, team registration, mid-season failures, refs+pitches CRUD, demo venue seed)*

---

## LEAGUE MODE — PHASE 2 CYCLE 2.7a SHIPPED (session 48, 2026-05-26)

End-to-end demo venue seed driving every Phase 2 RPC (migs 110–112).

- **mig 110 — demo venue seed.** Idempotent DO block: venue + league
  + 2 pitches (one with future MW) + 3 refs + season + competition
  + 4 teams + 6 round-robin fixtures (3 completed, 1 walkover, 2
  allocated upcoming) + 1 player. Dates are CURRENT_DATE-relative.
- **mig 111 — venue_get_state + league_get_state upcoming filter
  fix.** Latent bug surfaced by the seed: allocated fixtures were
  excluded from the upcoming bucket, so a pitched fixture would
  vanish until kickoff day. Fix: include 'allocated' alongside
  'scheduled' and 'postponed'.
- **mig 112 — date reshuffle.** One-off live-data fix for the
  initially seeded hardcoded dates (mig 110 source now uses
  current_date-relative arithmetic so future re-seeds are correct
  from the start).

Cycle 2.7 originally scoped as frontend + email + demo together;
split into sub-cycles 2.7a–2.7d. This is a.

**Phase 2 remaining:** Cycles 2.7b (email dispatcher), 2.7c/d (venue
dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.6 SHIPPED (session 48, 2026-05-26)

Refs + pitches CRUD plus the maintenance-window enforcement deferred
from Cycle 2.4 (migrations 105–109). Backend half of Phase 2 complete.

- **mig 105** — `venue_add_pitch` — create row with optional
  surface, capacity, sort_order, is_available, maintenance_windows.
- **mig 106** — `venue_update_pitch` — partial update via jsonb;
  soft-delete via active=false; broadcast switches to `pitch_closed`
  on the true→false flip.
- **mig 107** — `venue_add_ref` — create row; preferred_channel +
  employment_type defaulted; table CHECKs enforce enum values.
- **mig 108** — `venue_update_ref` — partial update mirror.
- **mig 109** — `venue_assign_pitch` rewrite — enforces
  `maintenance_windows` overlap against fixture's `scheduled_date`,
  rejects with `pitch_in_maintenance`. Skips check when no date set.

**Phase 2 remaining:** Cycles 2.7 (frontend + email dispatcher + demo
venue seed), 2.8 (wizard UI). All backend RPCs now live.

---

## LEAGUE MODE — PHASE 2 CYCLE 2.5b SHIPPED (session 48, 2026-05-26)

Mid-season team-exit flows + standings cascade for forfeit
(migrations 101–104).

- **mig 101** — `competition_teams.expulsion_reason` + extends
  `notify_venue_change` / `notify_league_change` whitelists with
  `team_expelled` and `fixtures_cascaded`.
- **mig 102 — `venue_withdraw_team`** — pending/active → withdrawn,
  cascade remaining fixtures (walkover to opposing team; void on
  phantom byes). Idempotent.
- **mig 103 — `venue_expel_team`** — active → expelled, same cascade.
  Distinguishable from withdrawal via `void_reason` / status.
- **mig 104 — `get_league_standings_for_player`** rewritten — now
  counts forfeit fixtures (3-0 to forfeit_winner_id, mirror of the
  existing walkover branch). Withdrawn/expelled teams stay in
  standings with accumulated pre-exit points.

Pitch close (maintenance windows) → Cycle 2.6. Ref no-show already
supported via Cycle 2.4's assign_ref(NULL)+reassign.

**Phase 2 remaining (post Cycle 2.7a):** Cycles 2.7b (email
dispatcher), 2.7c/d (venue dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.5a SHIPPED (session 48, 2026-05-26)

Self-serve team registration backend for `/join/CODE` — three RPCs +
one schema add (migrations 097–100).

- **mig 097** — `competition_teams.rejection_reason text` (additive).
- **mig 098 — `join_register_team`** — authenticated-only public RPC.
  Creates a competitive team OR promotes an existing casual one,
  claims caller as `team_admin`, inserts `competition_teams(status=
  'pending')`. Guards duplicate registration on same team_id.
- **mig 099 — `venue_approve_team_registration`** — pending→active,
  idempotent on already-active.
- **mig 100 — `venue_reject_team_registration`** — pending→rejected
  with required reason captured in `rejection_reason`.

Squad collection deferred: the team admin uses the existing
AdminView SquadScreen post-approval. Notification delivery to team
admin (push/email) deferred to Cycle 2.7 — RPCs emit audit + broadcast
hooks so the dispatcher can subscribe.

**Phase 2 remaining (post Cycle 2.7a):** Cycles 2.7b (email
dispatcher), 2.7c/d (venue dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.4 SHIPPED (session 48, 2026-05-26)

Fixture management RPCs for the operator dashboard. Three single-row
mutating RPCs + a forfeit-storage schema addition (migrations 093–096).

- **mig 093** — `fixtures.forfeit_winner_id` (text FK → teams ON
  DELETE SET NULL) + `fixtures.forfeit_reason`. `fixtures_status_check`
  expanded additively to include `'forfeit'`. Caught proactively by
  the new `pg_constraint` sweep mandate.
- **mig 094 — `venue_assign_pitch`** — sets/clears
  `fixtures.playing_area_id`. Auto-bumps scheduled↔allocated. Validates
  pitch is active + is_available + in caller's venue.
- **mig 095 — `venue_assign_ref`** — sets/clears `fixtures.official_id`.
  Audit/broadcast distinguishes assigned / changed / cleared.
- **mig 096 — `venue_update_fixture_status`** — drives the four
  operator-initiated terminal transitions (postpone, void, walkover,
  forfeit) with per-status validation + winner/reason metadata.

Standings update for forfeit (and the team-withdrawal cascade)
deferred to Cycle 2.5b, per the deferral already documented in mig 087.

**Phase 2 remaining:** Cycles 2.5a (team registration), 2.5b
(mid-season failures + standings cascade), 2.6 (refs+pitches CRUD),
2.7 (frontend + email + demo venue), 2.8 (wizard UI). ~3–4 days.

---

## LEAGUE MODE — PHASE 2 CYCLES 2.1–2.3 SHIPPED (session 48, 2026-05-26)

The first half of Phase 2 (League Mode customer-visible surfaces) is
live as DB + JS modules. Cycles 2.1, 2.2, 2.3 shipped end-to-end with
matching `_down.sql` files and proactive in-flight CHECK-constraint
hotfixes.

**Cycle 2.1 — Foundation + operator-led onboarding (commit `03bd4be`):**
- Migs 083–085: `venues.live_channel_key`, `leagues.league_code` (8-char
  alphanumeric) + `live_channel_key` + `squad_mode` + `squad_mode_locked_at`
  + `standings_visibility`, `match_officials.employment_type` +
  `overall_rating`, `playing_areas.is_available` + `maintenance_windows`,
  `competition_teams.status` DEFAULT flipped to `'pending'`.
- Resolver helpers: `resolve_venue_caller`, `resolve_league_caller`.
- Realtime publishers: `notify_venue_change` (25 reasons),
  `notify_league_change` (11 reasons) — separate
  `venue_live:`/`league_live:` channels from `team_live:`.
- **Primary onboarding tool**: `superadmin_create_venue` RPC +
  `/superadmin/venues/new` form on `apps/superadmin`. Self-serve
  signup (original Phase 8) deferred to year 2 per DECISIONS.md.

**Cycle 2.2 — Read RPCs (commit `f940c32`):**
- `venue_get_state` — full venue dashboard payload with fixtures
  bucketed tonight / this_week / upcoming / recent.
- `league_get_state` — narrower deep-link, falls back to league-pick
  prompt when caller is a venue admin.
- `join_get_league_by_code` — public `/join/CODE` landing.
- `get_league_standings_for_player` — W/D/L/GF/GA/GD/Pts across every
  competition the player is in; walkovers default to 3-0; top scorers
  stubbed until Phase 3 `match_events`.

**Cycle 2.3 — Engines + season setup (commit `71b8aab`):**
- `packages/core/engine/roundRobin.js` — circle method with home/away
  balance, pitch×slot allocation, doubleRound mirror, excludeWeeks.
- `packages/core/engine/cupBracket.js` — single elim (byes to top
  seeds + bracket placeholders) + group stage (snake-seeded).
- `venue_create_season` RPC — creates season + competitions, validates
  league ownership + date order + types.
- `venue_generate_fixtures` RPC — bulk-persists engine output, validates
  everything (competition ownership, no existing fixtures, every team
  active, every date in season, every pitch in venue), **one audit
  row** per generation.

**In-flight CHECK-constraint hotfixes** (migs 088/089/092 — full
detail in BUGS.md): `competition_teams.status` enum, RPC body
references to non-existent `incidents.status` + invalid
`'registration_open'`, `audit_events.actor_type` whitelist. Pattern
captured in DECISIONS.md "SCHEMA-SYNC MUST SWEEP `pg_constraint`".

**Customer-visible impact: zero (Phase 2 frontend lives in Cycle 2.7).**
Backend ready for the wizard UI; superadmin onboarding form ships
but pending the `apps/superadmin` env-var fix in BUGS.md.

**Decisions captured in DECISIONS.md (session 48):**
- Operator-led onboarding for year 1, Phase 8 deferred.
- `/league/TOKEN` merges into `/venue/TOKEN`.
- Existing casual teams stay venueless forever.
- Squad mode per-league, locked at first fixture.
- Bulk-RPCs audit one row, not N.

**Phase 2 remaining (post Cycle 2.7a):** Cycles 2.7b (email
dispatcher), 2.7c/d (venue dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASES 0 + 1 SHIPPED (session 40, 2026-05-25)

Two phases of `LEAGUE_MODE_SCOPE.md` landed end-to-end:

**Phase 0 — Foundation (migrations 050–054):**
- `league_config` table + `useLeagueConfig` hook + multi-sport posture
- `matches.match_type`, `teams.team_type`, `player_match.match_type` columns
- `notify.js` channel abstraction (dry-run by default; Phase 9 plugs Twilio)
- `company_domains` table + AuthCallback hook
- `create_team` RPC extended with `p_team_type` (default 'casual')
- `player_career` split into casual_*/competitive_*/total_* + `sync_player_career` RPC

**Phase 1 — Core data model (migrations 055–057):**
- 20 new tables: companies, company_admins, billing_events, clubs, venues,
  venue_admins, `playing_areas` (multi-sport rename of `pitches`),
  `match_officials` (multi-sport rename of `referees`), leagues, seasons,
  competitions, club_teams, competition_teams, team_name_history,
  cup_rounds, fixtures, match_events, player_registrations, incidents,
  hq_preview_tokens
- 13 new columns on existing tables (teams, matches, players, player_match)
- Phase-0 FK constraints retroactively added; `get_company_by_domain`
  extended to JOIN companies

**Multi-sport posture recorded in DECISIONS.md (session 40).** Zero
renames of existing identifiers; all new identifiers generic; future
sport-specific stats go into a `sport_stats jsonb` column when sport #2
lands.

**Customer-visible impact: zero.** Spine in place; Phase 2 will be the
first phase that builds customer-facing surfaces on top.

**Also this session:** MyView double-count hotfix (PlayerView.jsx — was
adding ledger balance + this-week's price for a phantom £10 instead of
the real £5). Commits `a8dd46d` + `ab6484f`.

---

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
| Manage Squad redesign | ✅ | Modern card-row, status-ring avatars, inline rename, per-row icon toggles, overflow ⋯ menu, filter chips, stagger fades — session 34 |
| Guest-only add bar | ✅ | Regulars self-onboard via invite link; admin add bar is now single-line guest-only — session 34 |
| Admin manual status (in/out/maybe/reserve) | ✅ | Status pills inside ⋯ menu; sets admin_locked_in so player can self-decline but not self-restore IN; server-side squad-cap gate on both admin and player paths; injury-override confirm modal. Migration 038. — session 34 |
| AdminView/index.jsx extraction | ✅ | PlayerProfile, POTMTiebreakModal, AnnounceModal split into own files; 1,544 → 976 LOC. Latent pendingTiebreak ReferenceError fixed in flight. — session 35 |
| PaymentsScreen redesign | ✅ | Inline £X PAY pill (1-tap mark paid), ⋯ overflow menu (Reset/Waive/Open Ledger), status-ring avatars, section glow, glass cards, pop-flash on just-paid, stagger fade-in. Backend untouched. — session 35 |
| ScheduleScreen + TeamsScreen polish | ✅ | Glass form sections, gold-glow titles, hardcoded radii (8/10/12/20) replaced with token vars. No interaction change. — session 35 |
| Player self-profile screen | ✅ | New unified PlayerProfile.jsx. Avatar overlay top-left on PageHeader (also recentred IN OR OUT logo). Three lazy-load sections: Stats / Payment History / Injuries. Migration 039 (get_my_payment_history + get_my_injuries). — session 35 (PROFILE_SCOPE A) |
| Leave squad (self) | ✅ | Two-tap confirm. Refuses with `debt_owed:<amount>` if owes > 0. Detaches team_players + push_subscriptions; preserves player row + history. Migration 040 (leave_squad RPC). — session 35 (PROFILE_SCOPE B) |
| Delete account (self) | ✅ | Typed-DELETE modal. Anonymises players row (name → "Deleted player") preserving FKs; detaches all teams; deletes push_subscriptions + player_career; revokes admin grants; calls auth.admin.deleteUser via /api/delete-account edge function. Refuses with `last_admin:<csv>` if user is sole admin of any team. Migration 040 (delete_my_account RPC). — session 35 (PROFILE_SCOPE B) |
| PlayerProfile admin mode merge | ✅ | Single file serves both modes behind isAdminView prop. Admin mode adds "Admin view" pill, branched RPCs (admin paths), ROLES with VC toggle, Admin Actions card (Rename/Copy/Reset link/Mark injury), Remove from squad with has_history guard surfaced. AdminView/PlayerProfile.jsx (374 LOC) deleted. — session 35 (PROFILE_SCOPE C) |
| First-time-use tooltips | ✅ | New `FirstTimeHint` primitive (framer-motion + localStorage, chained via `prerequisite` key, `ioo-hint-dismissed` event syncs duplicate mounts). 12 hints across AdminView (live-toggle global, key preserved), Squad invite link, Teams (tiles → SMART → CONFIRM chained), Payments unpaid section, Bibs holder, PlayerView status grid, StatsView league table (H2H discovery), HistoryView first match, PlayerProfile leave button. Pre-execute audit confirmed zero DB/RPC/auth/env touched. — session 38 |
| Pre-Beta launch fix: player_join_team token | ✅ | Migration 044. New-player INSERT branch now generates a player token. Pre-fix, first-time joiners landed with NULL token → JoinSuccess.jsx fell back to `/`. Caught and fixed in the audit before the real team's invite link went out. — session 39 |
| Super-admin dashboard Phase 1+2 (read-only) | ✅ | New `apps/superadmin` app at `https://platform-superadmin-djj9b1w8x-tarny-s-projects.vercel.app`, Vercel SSO-gated. Three tabs: Activity (audit_events tail), Teams (sortable list), Team Detail (drilldown). Migrations 045 (platform_admins + is_platform_admin + superadmin_whoami) + 046 (3 read RPCs). All RPCs gated by global cross-team auth helper. Phase 3 (token rescue) + Phase 4 (data fix) write tools deferred. — session 39 |
| Workspace-deps guard hook | ✅ | New `Skills/scripts/check-workspace-deps.sh`. Validates every `@platform/*` dep in every `apps/*/package.json` + `packages/*/package.json` maps to a real workspace package — wired into the pre-commit build gate. Sub-second jq check. Makes the "fake-alias-as-dep" bug class (which broke platform-clubmanager's CI when superadmin shipped) structurally impossible going forward. Plus `@platform/supabase` alias eliminated entirely; 22 source files migrated to import from `@platform/core/storage/supabase.js`. — session 39 |
| Push notification pipeline operational | ✅ | Three-layer fix: VAPID env vars set with real values (were stored as empty strings since the original platform-clubmanager deploy 13 days prior), all 6 pg_cron jobs rewritten apex → www (apex 307s strip the Authorization header at the redirect → 401), pg_cron job 5 syntax error fixed. Verified end-to-end at the 19:45 UTC cron tick: 4× HTTP 200 vs 4× HTTP 401 at 19:30 baseline. Migration 049 adds `player_account_deleted` to `notify_team_change` whitelist. **In-app subscribe flow not yet exercised on a real device** — proof-on-device deferred. — session 39 |
| Defense-in-depth: admin_save_teams scoping | ✅ | Migration 048. Adds `team_players` scope to the two `UPDATE players SET team='A'/'B'` statements in admin_save_teams (the CLEAR was already scoped). Closes a cross-team write surface where a legit admin for team X could pass team Y player_ids in p_team_a/p_team_b and flip their team column. Verified live with adversarial + happy-path tests inside rolled-back transactions. — session 39 |

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
| **Most Faced Opponent card** | ✅ Done session 32 | Unlocks at 4+ games. Amber badge, computed client-side via `computeDeeperIntel`. |
| **Reliability Ranking card** | ✅ Done session 32 | Unlocks at 5+ games. Cyan badge, shows top reliable + your rank, min 3 squad games to be ranked. |
| **IO deeper-intel cards rewired** | ✅ Done session 32 | Most Played With, Team Impact, Nemesis, Best Partnership were dead UI (hook nulled keys, no upstream computation). Now powered by `packages/core/engine/deeperIntel.js`. See BUGS.md B7. |
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
| **Ask the Gaffer — Phase 1 (AI agent layer)** | First production phase of the platform's AI agent layer — not a chatbot. Grounded football-operations agent (every output backed by a Supabase query, never invents facts). Phase 1 surfaces: team summary, payment summary, attendance risk, matchday briefing, Q&A panel. Provider locked in (Vercel AI Gateway → Anthropic `claude-sonnet-4-6`); data-access pattern locked in (`gaffer_get_context_*` RPCs + `ai_briefings` audit table); awaiting AI Gateway credits / Anthropic key signup before live build. Full spec: `GAFFER.md`. |
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

## PHASE 4 — LEAGUE MODE (superseded — now active)

Previously parked as a future sales pitch ("run your league free for one season"). Superseded by the active **League Mode** programme — Phases 0 + 1 already shipped (see top of file). Phase 2 onwards in `LEAGUE_MODE_SCOPE.md`.

---

## ASK THE GAFFER — AI AGENT LAYER

**This is the platform's AI agent layer, not a chatbot.** Grounded
football-operations agent. Every output backed by a Supabase query
(`context_snapshot` jsonb on every `ai_briefings` row). LLM narrates and
patterns — it never invents facts. Four-phase trust-graduated rollout.
Full spec lives in `GAFFER.md` — read that before any Gaffer work.

**Provider + data-access pattern (locked in):**
- LLM: Vercel AI Gateway → Anthropic `claude-sonnet-4-6`
- Context: per-surface `gaffer_get_context_*` RPCs (SECURITY DEFINER)
- Runtime: Vercel edge function `apps/inorout/api/gaffer.js`
- Audit: `ai_briefings` table — every output row links to its context snapshot
- Cost: ~£0.004 per briefing, £20/month covers ~5000 briefings

**Sequencing:** Phase 1 lands after Group Balancer (done s30). Group
Balancer's `generateBalancedTeams` becomes a building block for Phase 2
fair-team suggestions.

| Phase | Capability | Status |
|---|---|---|
| 1 — Read-only assistant | Q&A panel, team summary, payment summary, attendance risk, matchday briefing | 🟡 Scaffold + DB complete session 33. Migrations 033–037 applied to live DB via MCP and smoke-tested against `team_demo` (all four RPCs return real data). Edge function `/api/gaffer`, prompts, `GafferCard`, admin Q&A panel, JS wrappers all shipped. Awaiting: Anthropic key confirm on Vercel + AdminView wire-up (canary on one team first). See GAFFER.md "IMPLEMENTATION STATUS". |
| 2 — Recommendations | Fair team suggestions, reserve recs, payment chase drafts, weekly match summary, player insight explanations | 🔲 Not built |
| 3 — Confirmed actions | "Send chase", "Notify reserves", "Use these teams", "Post match summary", "Confirm payment reminders" — admin one-tap approve, all via existing SECURITY DEFINER RPCs | 🔲 Not built |
| 4 — Semi-autonomous | Auto-detect short squads, auto-draft notifications, auto-suggest reserve pings, auto-produce weekly admin report. Player-visible actions still require approval (hard rule). | 🔲 Not built |

---

## IO INTELLIGENCE — UNLOCK GRID

| Games | Unlocks |
|---|---|
| 1+ | Goals, POTM, W/L/D, Attendance ring, Reliability, Form strip |
| 2+ | Win Rate card ✅ built |
| 3+ | Current Run card ✅ built |
| 4+ | Most Faced Opponent ✅ built |
| 5+ | Reliability Ranking ✅ built |
| 6+ | Most Played With card ✅ built |
| 7+ | Team Impact card ✅ built |
| 8+ | Nemesis, Best Partnership, Advanced Chemistry cards ✅ built |
| 16+ | Legacy Insights ✅ built |
