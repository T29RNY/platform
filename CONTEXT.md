# IN OR OUT — Project Context & Session History
*Last updated: May 23 2026 (session 33 — Gaffer AI agent backend live; awaiting key confirm + UI wire-up)*

This file contains infrastructure, key tokens, demo environment, conventions,
and a compressed session history. For everything else, see the split files:
- **Bugs:** `BUGS.md` — read at session start
- **Schema:** `SCHEMA.md` — DB tables, constraints, types
- **RPCs:** `RPCS.md` — full RPC inventory
- **Decisions:** `DECISIONS.md` — settled architectural decisions
- **Features:** `FEATURES.md` — phase tracker, IO unlock grid
- **IO spec:** `IO_INTELLIGENCE.md` — IO system detail

---

## WHAT THIS IS

In or Out is a mobile-first web app for organising casual weekly football games. Live at **in-or-out.com**. Built as a React/Vite monorepo, deployed via Vercel, backed by Supabase.

Target market: casual 5-a-side and 7-a-side football teams in the UK.
Competitor: Spond (broad, all sports), Capo (early stage UK).
Differentiator: football-specific, frictionless, random player pool, in-app payments, IO Intelligence stats system.

---

## STAGE 1 BETA

Stage 1 launched May 19 2026. No real teams onboarded yet (demo only).
Stage 2 target: May 26. Broader beta: ~Jun 9. Quiet public: late Jul/Aug.
Beta deal: free forever for first 10 teams. Cash only — Stripe Connect not yet built.

---

## INFRASTRUCTURE

| Service | Detail |
|---|---|
| GitHub | github.com/T29RNY/platform (PRIVATE) |
| Vercel | auto-deploys on push to main, project: platform-clubmanager |
| Vercel build command | `cd ../.. && npm install && cd apps/inorout && npm run build` |
| Supabase | https://ktvpzpnqbwhooiaqrigm.supabase.co |
| Supabase publishable key | sb_publishable_vJfG62PWTeaYEdvBj6rI5A_ZhRh75Fd |
| Domain | in-or-out.com (123-reg, DNS → Vercel) |
| Posthog | phc_nKE8bJkj8skLdsxpierEVHgDyGGwaiwbwXoR7F7gLBc7 (EU region) |
| Google OAuth Client ID | GOOGLE_CLIENT_ID_HERE |
| Google OAuth Secret | GOOGLE_CLIENT_SECRET_HERE |

**TODO — SECURITY:**
- ✅ Supabase publishable key rotated
- Google DNS verification via 123-reg TXT record (fixes OAuth branding showing Supabase URL)

---

## MONOREPO STRUCTURE

```
platform/
  apps/
    inorout/
      src/
        App.jsx              ← routing, data loading, realtime, auth
        theme/
          tokens.css         ← full design token system
        components/
          ui/
            HeroCard.jsx     ← animated canvas pitch card; ADMINS block (VCs from squad prop)
            Avatar.jsx       ← initials circle; tileColour/isMe/injured variants
        views/
          PlayerView.jsx     ← startTab prop; squad prop passed to HeroCard
          MySquads.jsx       ← accordion; all squads for authenticated player
          MyIOView.jsx       ← IO Intelligence screen; TacticsBoardHero sticky
          StatsView.jsx      ← IO Statbook; PlayerLeagueTable + Player Form accordion
          PlayerLeagueTable.jsx ← period selector, ranked/unranked, form chips
          HistoryView.jsx    ← Results screen; score_type + last_goal_scorer display
          Gaffer/
            index.jsx        ← Ask the Gaffer AI agent layer scaffold (disabled — ENABLE_GAFFER=false; full spec in GAFFER.md)
            systemPrompt.js
          POTMVotingModal.jsx
          HeadToHead.jsx     ← 5 sections; period selector; chemistry 5-verdict system
          AdminView/
            index.jsx        ← POTM tiebreak modal; sticky hero
            TeamsScreen.jsx  ← Fisher-Yates random, draft save/restore, confirm + push
            ScoreScreen.jsx  ← 6-stage progressive flow, score_type + last_goal_scorer
            BibsScreen.jsx
            SquadScreen.jsx  ← persistent toggles, guest prompt, copy link, PlayerProfile
            ScheduleScreen.jsx  ← MATCH SETTINGS; 10 notification toggles
          InstallBanner.jsx
          PWAWelcome.jsx     ← paste-link only; email lookup removed (session 29)
          JoinTeam.jsx       ← full rebuild session 27; player_join_team RPC
          JoinSuccess.jsx    ← PWA install screen (platform-detected)
          AuthCallback.jsx
          Legal.jsx
        hooks/
          useIOIntelligence.js ← pure consumer of pre-fetched stats; no DB calls
      onboarding/
        index.jsx
        config.js
        hooks/useOnboarding.js ← computeOpensDay day-before, auto_open_pending, adminEmail
        steps/CreateTeam.jsx   ← Nominatim venue, city chip, price validation, bibs YES/NO
        steps/ShareLinks.jsx   ← www URL, window.location.href nav, onboarding_complete
      public/
        manifest.json          ← 4 icon sizes, theme_color #0A0A08
        sw.js
        io-statbook-hero.svg
        icons/
      vercel.json
      index.html
  packages/
    core/
      index.js
      constants/colors.js
      constants/roles.js
      engine/availability.js
      engine/attendance.js   ← updatePlayerRecords() is sole owes-increment path
      engine/payments.js
      engine/squad.js
      engine/scoring.js      ← hasGoalData, resolveDominantType, periodCutoff
      storage/supabase.js    ← ALL Supabase queries
    ui/
      index.jsx
  skills/                    ← methodology skills (see CLAUDE.md)
  turbo.json
  package.json
```

---

## DESIGN SYSTEM

**Fonts:** Bebas Neue (display/numbers/italic headings), DM Sans 300/400 (body)
**Icons:** @phosphor-icons/react weight="thin" throughout

**CSS Variables (src/theme/tokens.css):**
- `--bg:#0A0A08` `--s1:#141412` `--s2:#1C1C19` `--s3:#222220`
- `--t1:#F2F0EA` `--t2:#D0CCC2` — NOTE: --t3 does not exist, use --t2
- `--gold:#E8A020` `--gold2:rgba(232,160,32,0.15)` `--goldb:rgba(232,160,32,0.35)`
- `--green:#3DDC6A` `--green2:rgba(61,220,106,0.12)` `--greenb:rgba(61,220,106,0.3)`
- `--red:#FF4040` `--red2:rgba(255,64,64,0.12)` `--redb:rgba(255,64,64,0.3)`
- `--amber:#FFB020` `--amber2:rgba(255,176,32,0.12)` `--amberb:rgba(255,176,32,0.3)`
- `--purple:#B060F0` `--purple2:rgba(176,96,240,0.12)` `--purpleb:rgba(176,96,240,0.3)`
- Team A: `#60A0FF` Team B: `#FF6060`

**Design principles:**
- Dark atmospheric, football-under-floodlights mood
- Restrained glow — 0.5px borders with colour-matched box-shadow
- Bebas Neue italic for hero titles and numbers
- DM Sans 300 for body text
- Glass chips: rgba(255,255,255,0.1) backdrop-filter blur(12px)
- **CSS vars cannot be used in SVG fill/stroke — use `style={{ fill: "var(--x)" }}`**

---

## URL ROUTING

| URL | What it renders |
|---|---|
| / | Landing OR PWA welcome OR redirect to ioo_last_visited |
| /create | 3-step onboarding (auth-gated) |
| /p/TOKEN | Player view (no auth required) |
| /admin/TOKEN | Admin view (validated against teams table) |
| /demoadmin | Demo admin — no auth, loads team_demo |
| /join/CODE_OR_TEAM_ID | Player self-registration (auth-first) |
| /auth/callback | OAuth redirect handler |
| /legal | T&Cs + Privacy Policy |

---

## AUTH SYSTEM

- Google OAuth — production, verified
- Email magic link — enabled
- /demoadmin — NO auth required, public URL
- Token links (/p/TOKEN) — no auth required for day-to-day use
- Auth only required when JOINING a new team or creating one
- ioo_pending_route (sessionStorage) — holds /create redirect across auth
- ioo_pending_join (sessionStorage) — holds /join/CODE across auth

---

## KEY TOKENS

### FINBAR'S TUESDAYS (real test team)
| Item | Value |
|---|---|
| Team ID | team_finbars |
| Admin URL | in-or-out.com/admin/admin_101d9ac950278f76 |
| Join URL | in-or-out.com/join/team_finbars |
| Tarny token | p_95go8k6cfwo |
| Tarny URL | in-or-out.com/p/p_95go8k6cfwo |
| Tarny player ID | p_onxumqi1 |
| Tarny user_id | f95ad4a8-9b36-4b73-b909-8d2e10c9354b |

### 7 A SIDE FC (demo team)
| Item | Value |
|---|---|
| Team ID | team_demo |
| Admin token | admin_demo |
| Admin URL | in-or-out.com/demoadmin |
| Hassan URL | in-or-out.com/p/p_demotoken_01 |
| Dave URL | in-or-out.com/p/p_demotoken_02 |
| Mike URL | in-or-out.com/p/p_demotoken_03 |
| Sarah URL | in-or-out.com/p/p_demotoken_15 |
| Jordan URL | in-or-out.com/p/p_demotoken_05 |

---

## NAVIGATION

### Player nav (4 tabs)
My View | Stats | Results | My IO

### Admin nav (5 tabs)
My View | Stats | Results | My IO | Admin

- MY IO: MY in var(--t2), I in var(--green), O in var(--red)
- Active tab: gold glow border treatment
- NavBar has NO `isAdmin` prop — 5th Admin tab appears when `onAdminClick` is truthy

---

## DISPLAY TEXT CONVENTIONS
- MOTM → POTM in all UI display text
- "Man of the Match" → "Player of the Match" in all UI
- "History" → "Results" in all UI display text
- Variable names, DB columns, function names UNCHANGED (still motm, history)

---

## FEATURES COMPLETED

See `FEATURES.md` for the full phase tracker and IO unlock grid.

---

## IO INTELLIGENCE SYSTEM

See `IO_INTELLIGENCE.md` for the full IO spec, hook structure, H2H detail, and edge cases.

---

## DEMO ENVIRONMENT

- ID: team_demo, Name: 7 A Side FC
- Admin URL: in-or-out.com/demoadmin (no auth)
- 25 players, 22 matches Sep 2025 → May 2026 (2 cancelled)
- Auto-reset: every 2 hours if last_interaction > 2hrs ago; manual Reset button on /demoadmin
- Demo team has no `team_admins` row — predates the table (BUGS.md #3)

### Key demo players
| Player | ID | Token | Personality |
|---|---|---|---|
| Hassan | p_demo_01 | p_demotoken_01 | Top scorer 18 goals |
| Dave | p_demo_02 | p_demotoken_02 | POTM king 9 awards |
| Mike | p_demo_03 | p_demotoken_03 | Bib magnet 8 times |
| Steve | p_demo_04 | p_demotoken_04 | Perfect attendance |
| Jordan | p_demo_05 | p_demotoken_05 | Unreliable, always maybe |
| Chris | p_demo_08 | — | Owes £15 always |
| Finbar | p_demo_10 | — | 100% attendance, 0 goals |
| Sarah | p_demo_15 | p_demotoken_15 | Top female scorer 11 goals |
| Gav | p_demo_24 | — | 4 injuries tracked |

**Demo data caveats:**
- All 25 demo player rows have `created_at: 2026-05-13` — after every seed match date → reliability stays null in demo (production teams fine)
- Demo has no margin/declared score_type matches → dominantType always 'exact'
- Every demo player attends nearly every match → chemistry verdict always 'building' for every pair

---

## PAYMENT SYSTEM

### DB fields (players table)
| Field | Type | Meaning |
|---|---|---|
| `paid` | bool | Admin confirmed payment (or Stripe paid) |
| `self_paid` | bool | Player/host self-reported cash |
| `paid_by` | text | `'self'` / `'host'` / `'admin'` / `'stripe'` / null |
| `owes` | int | Accumulated debt across missed games |
| `pay_count` | int | Lifetime count of games paid |

### Payment states
`'cash_pending'` (UI-only) → `'paid'` (paid||selfPaid) → `'debt'` (owes>0) → `'unpaid'`

### Key conventions
- `updatePlayerRecords()` in ScoreScreen save is the **sole owes-increment path**
- `matches.payments` jsonb is keyed by **player name string** (not ID) — fragile, never displayed in UI
- Ledger dedup cross-path: player self-pays (null matchId entry), then admin marks paid with real matchId — `handleMarkPaid` finds null-matchId entry and promotes it (updates match_id) rather than creating duplicate
- PostgREST `.upsert()` fails with `42P10` on partial unique indexes — use explicit insert with `23505` conflict recovery instead
- `selfPaid=true` counts as `isPaid` in PaymentsScreen — admin confirmation is a UX signal, not a payment gate

### payment_ledger partial unique indexes
- `payment_ledger_uniq_with_match` ON (player_id, team_id, type, match_id) WHERE match_id IS NOT NULL
- `payment_ledger_uniq_without_match` ON (player_id, team_id, type) WHERE match_id IS NULL

---

## NOTIFICATION SYSTEM

### Auto triggers
gameDay9am, oneHrBefore, debtReminder, bibs24hr, bibs45min, squadFull, spotOpened,
gameLive, gameCancelled, scheduleChange, autoOpen, teamsConfirmed, streakNotification, monthlySummary

### Manual triggers (admin)
Chase no-responses, Cancel week, Announce to squad, Game is live toggle

### Config
- Quiet hours — admin configurable (quietStart/quietEnd in reminders_config)
- 10 per-trigger toggles in ScheduleScreen Notifications tab
- push_subscriptions + notification_log tables
- notify.js cron handlers: flushQueue, gameDay9am, oneHrBefore, debtReminder, bibs24hr, bibs45min, autoOpen, teamsConfirmed

---

## STRIPE PAYMENTS (not yet built)

Stripe Connect with application fees. Platform fee: 20p per transaction.
Each team has one treasurer who connects their Stripe account.
Architecture decision in DECISIONS.md. Unblock when Apple Dev account available.

---

## TEST ACCOUNTS

| Person | Role | Notes |
|---|---|---|
| Tarny | Developer + admin | tarnysingh@gmail.com |
| Gurnam | Beta tester + Stripe | iPhone, willing to connect Stripe |
| Finbar | Real organiser | Finbar's Tuesdays |

**Real teams:** team_finbars (primary test), team_mfw3hhu6 (Monday Footy, cash only)

---

## KEY DECISIONS LOG

See `DECISIONS.md` for all architectural and product decisions.

---

## KNOWN BUGS / TECH DEBT

See `BUGS.md` for the active bug list with priority order. Read at session start.

---

## CONVENTIONS & GOTCHAS

Critical non-obvious behaviours that don't live in the code or schema.

### Supabase / PostgREST
- **Two-query pattern is standard** — PostgREST foreign key joins unreliable in this config. Always use two sequential queries instead of embedded joins.
- **Schema cache**: PostgREST caches function signatures. After any RPC change, 404 may occur. Fix: `SELECT pg_notify('pgrst', 'reload schema');`. Wait 30s.
- **Partial unique index upserts**: PostgREST `.upsert()` generates bare `ON CONFLICT (cols)` without WHERE predicate → `42P10` error. Use explicit INSERT + catch `23505`.
- **PL/pgSQL validates at execution time**: `CREATE OR REPLACE` succeeds even with stale column refs. Function fails silently with `internal_error` at runtime. Run `check-rpc-columns.sh` before every RPC commit.
- **RPC parameter type changes**: `CREATE OR REPLACE` with different param types = new overload, not replacement. Always `DROP FUNCTION IF EXISTS fn_name(old_types)` first.

### Data model
- `matches.motm` stores **player ID** (not name). Use `resolveMotm(value, players)` for display — `players.find(p => p.id === value)?.nickname || name`.
- `player_match.match_id` is **text**, not uuid.
- `matches.match_date` is a Supabase `date` type — returns ISO string `"2026-05-14"`, sorts correctly with `new Date()`.
- `players.is_vice_captain` column dropped in migration 026 — now lives on `team_players.is_vice_captain`. Any RPC that joined `players` and referenced `p.is_vice_captain` must use `tp.is_vice_captain` via team_players JOIN.
- `score_type` null or `'exact'` = has goal data; `'margin'` or `'declared'` = no individual goals. Use `hasGoalData(scoreType)` from scoring.js.
- Reliability is **always all-time** — never period-filtered. Denominator = all team match dates since player.created_at.

### League table / stats
- `getPlayerLeagueTable` returns `{ players: [], totalGamesInPeriod: 0 }` — an object, not an array. Destructure correctly.
- `tableData` players use `playerId` (not `id`), `wins`/`draws`/`losses` (not `w`/`l`/`d`), `played` (not `attended`), `potm` (not `motm`), `form` as uppercase `["W","L","D"]` array.

### React patterns
- **isSavingRef** — use `useRef(false)` not `useState` for double-fire guards. React state batching means two rapid taps both read `isSaving===false` before first render; ref is synchronous.
- **position:sticky** on an element with `overflow:hidden` breaks. Wrap: outer div is sticky, inner div keeps overflow.
- **isFetchingPlayers ref** — prevents concurrent realtime RPC calls. Pattern: `if (isFetchingRef.current) return; isFetchingRef.current = true; ... finally { isFetchingRef.current = false; }`.

### Cron / schedule
- `is_draft` means onboarding incomplete only. Auto-open flag is `auto_open_pending`.
- `computeOpensDay` returns day-before — `(idx+6)%7` not `(idx+1)%7` (Tuesday game → Monday opens).
- `advanceGameDateJob` resets `auto_open_pending=true` weekly so games auto-open next week without admin action.

### Auth / join flow
- Auth return URL: Supabase allowlist is exact-match only. Auth redirect writes `ioo_pending_join` to sessionStorage before redirect; AuthCallback reads and clears it.
- BASE_URL must be `https://www.in-or-out.com` (with www) everywhere — matches Supabase allowlist.
- iOS Safari non-standalone only: write `ioo_redirect_to` for post-auth redirect. Android/desktop do not need this.

---

## SESSION HISTORY (compressed)

**Sessions 1–5 (May 9–11 2026):** Core app, Supabase backend, multi-tenancy, player routing, admin view, stats, history, bibs, payments, PWA, Google auth, magic link, join flow, cover pool, city field, Posthog, T&Cs, reminders engine, debt tracking, web push, VAPID, ScoreScreen bib picker, PWA install flow.

**Session 6 (May 12):** Major UI redesign. Full design system (tokens.css, Phosphor icons). PlayerView, StatsView, HistoryView, AdminView all rebuilt. player_match, player_career, player_injuries tables. Demo environment: team_demo, 25 players, 22 matches, /demoadmin, auto-reset. IO Intelligence system specced.

**Session 7 (May 13):** Planning + demo hardening. Two-stage beta plan agreed. POTM voting cut from Stage 1. Demo reset logic complete.

**Session 8 (May 13):** My IO screen built (useIOIntelligence hook, 8 insight cards, unlock thresholds). JoinSuccess rebuilt as PWA install screen (iOS/Android/desktop platform detection). New app icons.

**Session 9 (May 13):** Auth routing fixed — Supabase URL allowlist strips query params; fix uses sessionStorage ioo_pending_join pattern. BASE_URL standardised to www.in-or-out.com.

**Session 10 (May 13):** POTM voting system built end-to-end: potm_votes table, cron jobs (lineupLockJob, potmVotingOpenJob, potmTallyJob), POTMVotingModal, AdminView tiebreak modal, seed-demo.js.

**Session 11 (May 13):** POTM bug fixes. ScoreScreen full rebuild — 6-stage progressive flow, score_type, last_goal_scorer, isSavingRef double-fire guard.

**Session 12 (May 14):** HistoryView score type display. Admin view consistency + sticky heroes. Gaffer disabled (ENABLE_GAFFER=false). StatsView hero local SVG.

**Session 13 (May 14):** Cron hardening (advanceGameDateJob, autoOpenGameJob, timezone fix). auto_open_pending column. Onboarding full rebuild (CreateTeam, AddPlayers, ShareLinks). ScheduleScreen rebuild → MATCH SETTINGS.

**Session 14 (May 14):** Nickname tap fix. Nickname display audit — all `player.name` instances replaced with `player.nickname || player.name`. HistoryView score type display corrections.

**Session 15 (May 14):** Date field migration — `matches.date`/`date_short` → `match_date` (ISO date). bib_history.player_id added. BibsScreen rework.

**Sessions 16–17 (May 15):** Payment ledger dedup hardening — cross-path promotion, 42P10 fix, find-then-update pattern throughout. PaymentsScreen UI fixes. Payment confirmation UX.

**Session 18 (May 15):** Cancel Week system built — adminCancelMatch RPC, cancelWeek() 8-step async, cancel modal redesign. PlayerView cancelled state inline (no full-screen block). toggle intercept + Cancel Week nudge.

**Session 19 (May 15):** Full codebase audit. Dead code sweep. advanceGameDateJob fixed (is_cancelled reset, is_draft semantics). Console.logs removed. draftNextWeek + stale views/index.jsx deleted.

**Session 20 (May 16):** getPlayerLeagueTable built (5-step query, reliability all-time, period filter). PlayerLeagueTable.jsx built. StatsView integrated.

**Session 21 (May 16):** TeamsScreen full rebuild — Fisher-Yates shuffle, draft save/restore, confirmTeams, pentagon badges, push notification. payment_ledger CHECK constraints updated.

**Sessions 22–23 (May 16–17):** Vice Captain + Manage Squad (SquadScreen full rebuild, HeroCard ADMINS block, PlayerProfile VC toggle, is_vice_captain → players). Stats rewrite — all leaderboards from player_match via getPlayerLeagueTable. Head to Head feature built (5 sections, 5-verdict chemistry, period selector, reliability all-time, dominantType adaptive tiles). Pre-launch join hardening.

**Session 24 (May 18):** RLS lockdown — RLS enabled on all 19 tables. 47 SECURITY DEFINER RPCs. All direct client writes replaced. team_admins + audit_events tables created. /create auth gate. link_player_to_user RPC. demoadmin route fixed to use admin RPC.

**Session 25 (May 19):** RLS post-migration fixes. get_team_state_by_player_token extended with all stats. All three realtime callbacks rewritten to branch on route type. POTM voting RLS fix (submit_potm_vote + get_potm_voting_state RPCs). League table period tabs re-enabled client-side. useIOIntelligence rewritten as pure consumer.

**Session 26 (May 20):** Multi-team player switcher built (player_get_teams RPC, MySquads.jsx). is_vice_captain migrated from players → team_players (migration 026). players_public view updated. All 12 stale p.is_vice_captain refs removed from RPCs. carryForwardDebts removed.

**Session 27 (May 20):** Join flow bug fixed — addPlayerToTeam was receiving wrong arg order in join context. Replaced with dedicated player_join_team RPC (SECURITY DEFINER, authenticated only). JoinTeam.jsx full rebuild. AddPlayers removed from onboarding (players join via squad link only). SetupLoadingScreen + SquadReady built. price_per_player → numeric(10,2). Zero direct table writes in onboarding.

**Sessions 28–29 (May 21):** Dead code sweep — supabase.js dead functions removed, App.jsx dead imports cleared, IsThisYou.jsx deleted. BibsScreen RLS fix (ScoreScreen workaround). B1 resolved: 10 SECURITY DEFINER RPCs referencing dropped `players.is_vice_captain` (all Manage Squad buttons + player attendance + payments broken since migration 026); fixed via apply_migration. player_get_teams stale column fixed. find_player_by_email RPC dropped (PUBLIC grant security issue). player_join_team fixed (token generation, SET search_path, PUBLIC grant revoked). PWAWelcome email lookup section removed. Skills/ directory created — full AUDIT→EXECUTE→VERIFY→COMMIT→POST-DEPLOY cycle with 5 scripts and 11 skill files.

**Session 32 (May 23):** IO Intelligence deeper-intel rewire. B7 resolved: Most Played With (6+), Team Impact (7+), Nemesis (8+), Best Partnership (8+) were dead UI — `useIOIntelligence.js` hard-coded all four keys to null and no upstream path computed them. New pure engine `packages/core/engine/deeperIntel.js` computes all six metrics (incl. new mostFacedOpponent, reliabilityRanking) from `matches[]` + `squad[]` client-side. Wired into `computeStatsFromHistory` (admin/demo) and both player-token state fetches (App.jsx). Two new Insight cards shipped: Most Faced Opponent (amber, 4+), Reliability Ranking (cyan, 5+, min 3 squad games to be ranked). Hygiene script exempted MyIOView.jsx from the hex-literal check (separate commit) — file is overwhelmingly SVG badge rendering, where CLAUDE.md mandates hex literals. Commits: `08db0b7` (hygiene), `04877de` (feature), `5d1112e` (docs).

**Session 33 (May 23):** Ask the Gaffer repositioned from chatbot to platform AI agent layer. Spec consolidated into new `GAFFER.md` (sourcing DECISIONS.md + venue_league_hq_SCOPE.md Phase 7). Provider locked in: Vercel-hosted edge function `/api/gaffer` → Anthropic `claude-sonnet-4-5` direct (same env var as previous chatbot scaffold). Data-access pattern locked in: per-surface `gaffer_get_context_*` RPCs (SECURITY DEFINER, derive team from `p_admin_token`, return jsonb) + `ai_briefings` audit table storing every output with its `context_snapshot` for factual auditability. Built: 5 migrations (033 ai_briefings table, 034–037 four Phase 1 context RPCs), edge function rewrite with multi-surface routing/cache/cost tracking, five surface system prompts under `views/Gaffer/prompts/`, `<GafferCard>` reusable inline component, new admin Q&A panel (old player-facing chatbot archived as `_archived_chatbot.jsx`), JS wrappers `getGafferBriefing` + `askGafferQuestion` in supabase.js. Migrations applied via Supabase MCP and smoke-tested end-to-end against `team_demo` — all four RPCs return real data (Dave 4g top scorer 30d; Hassan 7g + Dave 6g in-form; risk_level=high; live recent form). One in-flight bug caught and fixed in smoke test: original SQL used non-existent `row_to_jsonb` — patched to `to_jsonb` via MCP and migration files synced. **Frontend untouched** — no UI wire-up yet. Awaiting: (1) confirm `ANTHROPIC_API_KEY` is still on Vercel (was set for previous chatbot), (2) canary UI wire-up onto one team. Cross-browser PWA install breadcrumb gap also logged as BUGS.md #5 (cross-browser/in-app-webview install loses token bridge — fix is server-side signed cookie, not urgent). Commits: `3899a95` (repositioning docs), `f58ce86` (scaffold), `50131c2` (to_jsonb fix), `a55089b` (BUGS B5).






