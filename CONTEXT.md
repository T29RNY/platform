# IN OR OUT — Master Project Context
*Last updated: May 20 2026 (session 26)*
*Always paste this at the start of a new session, or keep in Claude Projects*

---

## WHAT THIS IS

In or Out is a mobile-first web app for organising casual weekly football games. Live at **in-or-out.com**. Built as a React/Vite monorepo, deployed via Vercel, backed by Supabase.

Target market: casual 5-a-side and 7-a-side football teams in the UK.
Competitor: Spond (broad, all sports), Capo (early stage UK).
Differentiator: football-specific, frictionless, random player pool, in-app payments, IO Intelligence stats system.

---

## STAGE 1 BETA — LIVE TUESDAY MAY 19 2026

**Beta held pending stability fixes. No real teams onboarded yet. Demo only (team_demo).**

**Payment model:** cash only (admin marks paid). Stripe slots in if it lands in time, not a blocker.

**Stage 1 ship blockers (must clear by May 19):**
1. Supabase publishable key rotated
2. Google DNS TXT record verified via 123-reg
3. /join/team_finbars tested end-to-end on clean iPhone
4. JoinSuccess.jsx install instruction screen (iOS/Android/desktop variants, soft-block with tiny skip link)
5. Polished install screenshots (iOS 3-frame, Android 2-frame)
6. Tuesday-night standby kit (Posthog + Supabase dashboards, error log review)
7. WhatsApp comms to Finbar's admin with welcome + expectations

**Aspirational for May 19 matchday:**
- My IO skeleton — locked cards + 1+ tier insights
- Ask the Gaffer opened to admin role

**Out of Stage 1:** admin screens redesign, onboarding redesign, Stripe Connect.

**Stage 2:** Tuesday May 26 — Monday Footy added if Stage 1 week 1 clean.
**Broader beta:** ~Jun 9 — anyone willing to mandate the app for their team.
**Quiet public availability:** late Jul / early Aug.

**Beta deal:** free forever for first 10 teams. Bank transfer or cash; if Stripe lands, beta teams only pay Stripe fees, no platform fee.

See `BETA_LAUNCH_CHECKLIST.md` for the full pre-flight checklist.

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
- ✅ Supabase publishable key rotated — current key: sb_publishable_vJfG62PWTeaYEdvBj6rI5A_ZhRh75Fd
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
            HeroCard.jsx     ← animated canvas pitch card; ADMINS block added session 22 (VCs from squad prop, capped at 4, sorted)
            Avatar.jsx       ← initials circle; tileColour/isMe/injured variants; name label below circle
        views/
          PlayerView.jsx     ← rebuilt session 6; startTab prop added session 12; squad prop passed to HeroCard session 22
          MySquads.jsx       ← new session 26; accordion showing all squads for authenticated player (current/other/disabled rows, empty + unauth states)
          MyIOView.jsx       ← built session 8, IO Intelligence screen; TacticsBoardHero sticky (session 12)
          StatsView.jsx      ← rebuilt session 6, IO Statbook; local SVG hero + sticky (session 12); PlayerLeagueTable integrated + Player Form accordion (session 20)
          PlayerLeagueTable.jsx ← new session 20; period selector (month/season/all), ranked/unranked split, form chips, bib-holder dot, reliability colour
          HistoryView.jsx    ← rebuilt session 6, Results screen; score_type + last_goal_scorer display corrected (session 14)
          Gaffer/
            index.jsx        ← Ask the Gaffer chatbot (disabled via ENABLE_GAFFER=false in App.jsx)
            systemPrompt.js  ← 820-word system prompt
          POTMVotingModal.jsx   ← built session 10
          AdminView/
            index.jsx        ← rebuilt session 6; POTM tiebreak modal (session 10); sticky hero + My IO nav (session 12)
            TeamsScreen.jsx  ← full rebuild session 21: Fisher-Yates random, draft save/restore, confirm + push, pentagon badges, split A/B card; design polished session 21
            ScoreScreen.jsx  ← rebuilt session 11, 6-stage progressive flow, score_type + last_goal_scorer
            BibsScreen.jsx
            SquadScreen.jsx  ← full rebuild session 22: persistent toggles (priority/VC/injured/disable), guest prompt on host injury, copy link per player, avatar taps open PlayerProfile, design system
            ScheduleScreen.jsx  ← rebuilt session 13: MATCH SETTINGS, pickers, computed next matchday, bibs, Nominatim, opens helper, upsert save; notification toggles (10 triggers incl. teamsConfirmed) added session 21
          InstallBanner.jsx
          PWAWelcome.jsx
          HeadToHead.jsx       ← session 22–23: head to head comparison modal; 5 sections; period selector wired + chemistry 5-verdict system + reliability null bar (session 23); wired to PlayerLeagueTable tap target
          JoinTeam.jsx
          JoinSuccess.jsx       ← rebuilt session 8, PWA install screen (platform-detected)
          AuthCallback.jsx
          Legal.jsx
          IsThisYou.jsx
        hooks/
          useIOIntelligence.js ← IO Intelligence data hook, unlock thresholds
      onboarding/
        index.jsx              ← teamId prop wired to ShareLinks (session 13)
        config.js
        hooks/useOnboarding.js ← computeOpensDay day-before fix, auto_open_pending, bibsEnabled, adminEmail (session 13)
        steps/CreateTeam.jsx   ← rebuilt session 13: Nominatim venue, city chip, price validation, bibs YES/NO, admin email
        steps/AddPlayers.jsx   ← rebuilt session 13: design system, brand header, numbered badges
        steps/ShareLinks.jsx   ← rebuilt session 13: www URL fix, window.location.href nav, onboarding_complete flag
      public/
        manifest.json          ← 4 icon sizes, theme_color #0A0A08
        sw.js
        io-statbook-hero.svg   ← local hero for StatsView (replaces Unsplash hot-link)
        icons/                 ← favicon.ico, favicon-96x96.png, favicon.svg, apple-touch-icon.png, web-app-manifest-192x192.png, web-app-manifest-512x512.png
      mockup/
        inorout-v4-mockup.html
        inorout-liveboard-mockup.html
        inorout-stats-mockup.html
        inorout-admin-mockup.html
      vercel.json
      index.html
  packages/
    core/
      index.js
      constants/colors.js
      constants/roles.js
      engine/availability.js
      engine/attendance.js
      engine/payments.js
      engine/squad.js
      engine/scoring.js      ← hasGoalData, resolveDominantType, periodCutoff (added session 23)
      storage/supabase.js    ← ALL Supabase queries
    ui/
      index.jsx
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
- Tile gradients: linear-gradient(135deg, coloured tint to transparent)

---

## SUPABASE SCHEMA

### teams
```
id, name, admin_token, join_code, onboarding_complete, admin_email, created_at
```

### players
```
id, name, token, user_id (uuid → auth.users),
type, disabled, priority,
status (none/in/out/maybe/reserve),
paid, owes, goals, motm, attended, total,
bib_count, team, w, l, d,
pay_count, late_dropouts, note, self_paid,
paid_by (self/host/admin/stripe),
is_guest, guest_of,
injured, injured_since,
nickname,
role_scope jsonb DEFAULT NULL,   ← dormant; future T2 RBAC (Phase 2)
disable_reason text DEFAULT NULL, ← dormant; future Club Manager audit (Phase 2)
created_at
```

### team_players
```
team_id, player_id,
is_vice_captain bool DEFAULT false   ← migrated from players session 26 (per-team VC)
```

### matches
```
id, team_id, match_date (date), score_a, score_b,
scorers (jsonb), motm, bib_holder,
team_a (jsonb array), team_b (jsonb array),
teams_draft jsonb,   ← { a: [playerIds], b: [playerIds] } — draft before confirmation; cleared on confirm
winner, cancelled, cancel_reason,
payments (jsonb),
score_type text CHECK (exact/margin/declared),
last_goal_scorer text,
voting_open bool DEFAULT false,
voting_closes_at timestamptz,
vote_count int DEFAULT 0,
total_voters int DEFAULT 0,
was_admin_decided bool DEFAULT false,
admin_decision_pending bool DEFAULT false,
tied_candidates jsonb,
created_at
```

### bib_history
```
id, team_id, name, player_id, match_date (date), returned
UNIQUE: bib_history_uniq_team_date (team_id, match_date)  ← one holder per team per match night
```
Both write paths (saveBibHolder + insertBib) use UPSERT with onConflict: "team_id,match_date".

### schedule
```
id, team_id, day_of_week, kickoff, venue, city,
opens_day, opens_time, priority_lead_mins,
price_per_player numeric(10,2), game_is_live, squad_size,
game_date_time,
is_draft bool,         ← ONLY means "onboarding not complete" now (NOT the auto-open flag)
is_cancelled, cancel_reason,
reminders_config (jsonb),
lineup_locked bool DEFAULT false,
active_match_id text,
voting_open bool DEFAULT false,
voting_closes_at timestamptz,
bibs_enabled bool DEFAULT true,
auto_open_pending bool DEFAULT true,  ← replaces is_draft as auto-open flag; reset to true by advanceGameDateJob
season_id text,
active bool DEFAULT true
```

### settings
```
id, team_id, group_name
```

### cover_pool
```
id, team_id, name, played, owes, created_at
```

### push_subscriptions
```
id text PK, player_id text, player_token text, team_id text,
subscription jsonb, created_at timestamptz default now()
UNIQUE on player_id
```

### notification_log
```
id text PK, team_id text, player_id text, type text, game_date text,
sent_at timestamptz, queued_for timestamptz, queued_payload jsonb,
created_at timestamptz default now()
```

### player_match
```
id uuid PK,
team_id text,
match_id text,
player_id text,
team_assignment text CHECK (A/B),
result text CHECK (w/l/d),
attended boolean DEFAULT false,
late_cancel boolean DEFAULT false,
injury_absence boolean DEFAULT false,
was_motm boolean DEFAULT false,
had_bibs boolean DEFAULT false,
is_guest boolean DEFAULT false,
goals int DEFAULT 0,
assists int DEFAULT NULL (Phase 3),
clean_sheet boolean DEFAULT NULL (Phase 3),
yellow_cards int DEFAULT NULL (Phase 3),
red_cards int DEFAULT NULL (Phase 3),
own_goals int DEFAULT NULL (Phase 3),
rating numeric(3,1) DEFAULT NULL (Phase 3),
created_at timestamptz
```

### player_career
```
player_id text PK,
total_teams int, total_games int,
total_wins int, total_losses int, total_draws int,
total_goals int, total_motm int,
career_win_rate numeric(5,2) DEFAULT NULL,
career_reliability numeric(5,2) DEFAULT NULL,
career_impact numeric(5,2) DEFAULT NULL,
best_team_id text,
created_at timestamptz, updated_at timestamptz
```

### player_injuries
```
id uuid PK,
player_id text,
team_id text,
injured_at timestamptz,
cleared_at timestamptz (NULL = current injury),
marked_by text (player/admin),
created_at timestamptz
```

### payment_ledger
```
id uuid PK,
team_id text,
player_id text,
match_id text (nullable — null when lineup lock hasn't run yet),
amount int,
type text CHECK (game_fee/guest_fee/debt_payment/waiver/refund),
status text CHECK (paid/unpaid/waived/disputed/refunded),
method text (cash/stripe/admin/waived),
paid_by text (self/host/admin/stripe),
paid_at timestamptz,
note text,
created_at timestamptz,
updated_at timestamptz
```
**Partial unique indexes (handles NULL match_id — standard UNIQUE won't work because NULL != NULL in PG):**
- `payment_ledger_uniq_with_match` ON (player_id, team_id, type, match_id) WHERE match_id IS NOT NULL
- `payment_ledger_uniq_without_match` ON (player_id, team_id, type) WHERE match_id IS NULL

### potm_votes
```
id uuid PK DEFAULT gen_random_uuid(),
match_id text,
team_id text,
voter_id text,
nominee_id text,
created_at timestamptz DEFAULT now(),
UNIQUE (match_id, voter_id)
```

### demo_sessions
```
id text PK default 'main',
last_reset timestamptz,
last_interaction timestamptz
```

### team_admins
```
team_id text, user_id uuid, created_at timestamptz
PRIMARY KEY (team_id, user_id)
```
Written by `create_team` RPC during onboarding. Seeded for `team_demo` via migration 020.

### audit_events
```
id uuid PK DEFAULT gen_random_uuid(),
team_id text, actor_id text, event_type text, payload jsonb,
created_at timestamptz DEFAULT now()
```
Written by SECURITY DEFINER RPCs for all admin mutations.

### RLS architecture (post session 24)
All 19 public schema tables have `rowsecurity=true`. Anon and authenticated roles have no direct write access. All client writes go through SECURITY DEFINER RPCs in `rls_migrations/` (47 functions total). Direct table reads also blocked — bulk state reads go through `admin_get_team_state` and `player_get_team_state` RPCs.

### RPC functions
`find_player_by_email(lookup_email text)` — SECURITY DEFINER, joins auth.users → players → team_players → teams

**Player token RPCs (011):** `set_player_status`, `set_player_paid` (clears debt atomically since session 24), `set_player_injured`, `add_guest_player`, `save_push_subscription`

**Admin token RPCs (012–018):** `admin_get_team_state`, `admin_add_player`, `admin_remove_player`, `admin_update_player_name`, `admin_set_vice_captain`, `admin_set_player_priority`, `admin_disable_player`, `admin_confirm_payment`, `admin_reset_payment`, `admin_waive_debt`, `admin_save_match_result`, `admin_save_teams`, `admin_save_bib_holder`, `admin_cancel_match`, `admin_upsert_schedule`, `admin_upsert_settings`, `admin_close_potm_voting`, `admin_reset_player_token`

**Onboarding RPCs (015):** `create_team` — atomic: team + players + schedule + settings + team_admins; fully rolls back on error

**Auth RPCs (022):** `link_player_to_user(p_token)` — authenticated only (uses `auth.uid()`); links player row to Supabase auth user; guards against double-linking
**Auth RPCs (028):** `player_join_team(p_team_id, p_name)` — authenticated only; handles both new and returning players; upserts team_players, creates players row if needed

**Realtime enabled on:** players, schedule, matches
**player_match UNIQUE constraint:** (match_id, player_id) — required for UPSERT in writePlayerMatchRows and lineupLockJob

---

## URL ROUTING

| URL | What it renders |
|---|---|
| / | Landing OR PWA welcome OR redirect to ioo_last_visited |
| /create | 3-step onboarding |
| /p/TOKEN | Player view (no auth required) |
| /admin/TOKEN | Admin view (validated against teams table) |
| /demoadmin | Demo admin — no auth, loads team_demo |
| /join/CODE_OR_TEAM_ID | Player self-registration (auth-first) |
| /auth/callback | OAuth redirect handler |
| /legal | T&Cs + Privacy Policy |
| /legal#privacy | Privacy Policy direct link |

---

## AUTH SYSTEM

- Google OAuth — production, verified
- Email magic link — enabled
- /demoadmin — NO auth required, public URL
- Token links (/p/TOKEN) — no auth required for day-to-day use
- Auth only required when JOINING a new team

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

### Tab branding
- MY IO: MY in var(--t2), I in var(--green), O in var(--red)
- Active tab: gold glow border treatment
- NavBar renders 5 tabs when `onAdminClick` prop is truthy, 4 tabs otherwise (no isAdmin prop)

---

## DISPLAY TEXT CONVENTIONS
- MOTM → POTM in all UI display text
- "Man of the Match" → "Player of the Match" in all UI
- "History" → "Results" in all UI display text
- Variable names, DB columns, function names UNCHANGED (still motm, history)

---

## FEATURES COMPLETED

### Player features
- Personal token URL — no auth required
- IN / OUT / MAYBE / RESERVE status with coloured glow buttons
- Status feedback row — centred, colour matched, above buttons
- Reserve queue with position number
- Add a note (only when game is live)
- Live board — real-time updates
- Teams confirmed tile — Team A/B columns, form dots, POTM trophy, bibs indicator
- Live board order: Teams/IN → Reserve → Maybe → Out → No response
- Payment — cash self-confirm two-step, Stripe stub, Clear Debt multi-step
- Guest payment row — inside response card, gold tint
- Plus One — add guest, independent payment, host or self pays
- Injured toggle — excludes from squad/notifications/stats
- Injury tracked in player_injuries table with duration
- Push notifications — VAPID, Android + installed iOS PWA
- Notification prompt — only after status set, game live, canPush true
- PWA install flow + welcome screen (email lookup + paste link)
- Ask the Gaffer chatbot (gated to Tarny/admin only)
- Stats screen — IO Statbook hero, player form table, leaderboards, locked shield cards
- Results screen — accordion month/year, match cards glow borders, drill-down, WhatsApp share
- My IO tab — shell ready, IO Intelligence screen to build

### Admin features
- Admin view rebuilt — changing room hero, glass chips, game live toggle
- Action rows — Chase No-Responses, Cancel Week, Announce to Squad
- Announce modal — recipient picker (In/Out/Maybe/Reserve/No Response/Injured)
- Live board collapsible sections — In/Reserve/Maybe/Out/Injured/No Response
- Player profile full screen — identity, stats, payment history, attendance, injury history
- Copy player link per row
- Outstanding debts summary in IN section
- Make Teams tile → TeamsScreen (full rebuild session 21: player pool, Fisher-Yates random, A/B assignment, draft save, confirm + teamsConfirmed push, clear, Done button, split live card)
- Input Result tile → ScoreScreen (writes player_match on save)
- Squad tile → SquadScreen
- Schedule tile → ScheduleScreen
- Notifications tile → reminders config
- Bibs tile → BibsScreen
- Cover Pool accordion
- Drag to reorder reserve list
- POTM tiebreak modal — detects adminDecisionPending matches, shows tied candidates only, no skip, calls closePOTMVoting + fires potmResult push

### Platform
- Multi-tenant — all queries filtered by team_id
- Realtime — players, schedule, matches (matchSub listens to event:"*" not just INSERT)
- player_match writes on every result save (UPSERT with onConflict: match_id,player_id)
- Demo environment — team_demo, 25 players, 22 matches, /demoadmin, auto-reset
- Design system — tokens.css, Phosphor icons thin, mockup reference files
- POTM voting system — full end-to-end: lineup lock cron → voting open cron → tally cron → modal → admin tiebreak

---

## IO INTELLIGENCE SYSTEM

### Branding
- Tab: MY IO (MY=var(--t2), I=green, O=red), Phosphor Brain icon weight=thin
- Screen heading: IO Intelligence (IO=branded colours, italic skew, sticky at top)
- Locked cards: pentagon crest SVG (path d="M27 2L52 12V30C52 43.5 41 54.5 27 58C13 54.5 2 43.5 2 30V12L27 2Z"), ghost shield opacity 0.15
- Season report: IO Wrapped (Phase 2)

### Progressive unlock thresholds (per player per team)
| Games | Unlocks |
|---|---|
| 1+ | Goals, POTM, W/L/D, Attendance ring, Reliability, Form strip |
| 2+ | Win Rate card |
| 3+ | Current Run card (unbeaten OR losing run) |
| 4+ | Most Faced Opponent (not yet built) |
| 5+ | Reliability Ranking (not yet built) |
| 6+ | Most Played With card |
| 7+ | Team Impact card |
| 8+ | Nemesis, Best Partnership, Advanced Chemistry cards |
| 16+ | Legacy Insights |

### MyIOView.jsx structure (built session 8, sticky updated session 12)
- IO brand header — sticky top:0 zIndex:20 background:var(--bg)
- TacticsBoardHero — sticky top:48 zIndex:15 (48px = IOBrandHeader height: 12+24+12), tactics board SVG pitch, YOUR GAME/YOUR STORY heading (40px Bebas Neue italic), attendance ring with glass tile
- StatsRow — 3 tiles: POTM (gold), Goals/Run (green), W/D/L (subtext=var(--t2))
- InsightsGrid — 2-col grid, 8 insight cards in unlock order
- UnlockBar — shows next unlock step
- DeeperIntelSection — ranked rows (partnerships, nemeses, played with, impact), unlocks at 6
- LegacySection — gold crest cards, unlocks at 16
- JourneyStartsHere — 0 games empty state
- GuestCard — guest player state

### Insight cards order (2-col grid)
1. Win Rate (2+) — gold, winRate% on badge
2. Current Run (3+) — dynamic green/red based on run type
3. Most Played With (6+) — blue
4. Team Impact (7+) — purple
5. Nemesis (8+) — red
6. Best Partnership (8+) — green
7. Advanced Chemistry (8+) — amber, "Coming soon"
8. Legacy Insights (16+) — gold

### useIOIntelligence.js hook
Parallel Promise.all queries gated by gamesPlayed threshold.
Returns: `{ stats, loading, error }` where stats contains keys:
matchStats, reliability, winRate, currentRun, mostPlayedWith, impact, nemesis, bestPartnership, potmVotes

### Supabase queries (all built in packages/core/storage/supabase.js)
- getPlayerMatchStats(playerId, teamId) → { goals, motm, wins, losses, draws, attended }
- getWinRate(playerId, teamId) → { winRate, wins, draws, losses }
- getCurrentRun(playerId, teamId) → { type: "unbeaten"|"losing", length }
- getReliabilityScore(playerId, teamId) → { score }
- getMostPlayedWith(playerId, teamId) → [{ playerId, name, games }]
- getPlayerImpact(playerId, teamId) → { withRate, withoutRate, diff }
- getNemesis(playerId, teamId) → [{ playerId, name, games, lossRate }]
- getBestPartnership(playerId, teamId) → [{ playerId, name, games, winRate }]
- getPOTMVoteStats(playerId, teamId) → wrapped in try/catch (table may not exist)
- getPlayerLeagueTable(teamId, period) → full ranked player table; period='month'|'season'|'all'; ranks by points(W×3+D)→goals→winRate→potm→name; reliability null if allTimePlayed<3; form = last 5 W/D/L; returns [{playerId, name, nickname, injured, played, wins, draws, losses, points, winRate, goals, potm, reliability, form, ranked, rank}]; guests/disabled excluded; reliability is fully period-independent: Step 3b runs a separate all-time attended query (playedAllTime map); both numerator (allTimePlayed) and denominator (totalTeamGames) are all-time counts — reliability is a player trait, not a period stat
- submitPOTMVote(matchId, teamId, voterId, nomineeId) → {ok} or {error:"already_voted"} on UNIQUE violation
- getPOTMVotes(matchId) → [{voter_id, nominee_id}]
- getPOTMEligiblePlayers(matchId, teamId) → [{id, name, team}] — two-query pattern (player_match then players)
- tallyPOTMVotes(matchId, teamId) → {winner, voteCount, totalVoters, isTie, tiedCandidates}
- closePOTMVoting(matchId, winnerId, wasAdminDecided) — updates matches + player_match
- openPOTMVoting(matchId, teamId, closesAt, totalVoters) — updates matches
- NOTE: PostgREST self-join workaround — getMostPlayedWith/getNemesis/getBestPartnership/getPlayerImpact/getPOTMEligiblePlayers all use two sequential queries + JS computation
- toggleViceCaptain(playerId, value, changedBy=null) → guards is_guest (returns {error:'guests_cannot_be_vc'}), upserts is_vice_captain; changedBy stub for Phase 2 audit log
- disablePlayer(playerId, teamId, disabled, changedBy=null) → upserts disabled boolean; teamId + changedBy stubs for Phase 2 audit log

### Hero card — attendance ring
- SVG 56×56, viewBox "0 0 38 38", R=16, progress ring stroke #3DDC6A strokeWidth 3
- Glass tile wrapper: rgba(255,255,255,0.07), blur(12px), 0.5px border rgba(255,255,255,0.18), borderRadius 14px, padding 10px, minWidth/minHeight 80px
- Ring text (HTML spans, not SVG): number 16px/600/#fff, "/X" 9px/#fff, "games" 7px/rgba(255,255,255,0.6)

### Edge cases
- 0 games: "YOUR IO JOURNEY STARTS HERE" empty state
- Guest player: "Join the squad properly to unlock IO Intelligence"
- POTM zero state: "yet to win one" (not "0% of wins")
- position:sticky breaks with CSS transform on parent — TacticsBoardHero is a sibling above .io-section divs (which have translateY), NOT inside them; sticky at top:48 works
- CSS vars can't be used in SVG fill/stroke — use hex literals inside SVG

---

## DEMO ENVIRONMENT

### Team details
- ID: team_demo, Name: 7 A Side FC
- Admin URL: in-or-out.com/demoadmin (no auth)
- 25 players, 22 matches Sep 2025 → May 2026 (2 cancelled)

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
| Kieran | p_demo_13 | — | Injury prone |
| Declan | p_demo_14 | — | No response king |

### Auto-reset
- Cron: every 2 hours if last_interaction > 2hrs ago
- Manual: Reset button on /demoadmin
- Scope: full restore — status, payments, injuries, notes,
  nicknames, stats, player_match rows, guest players removed,
  added matches removed, Chris always owes £15

---

## PAYMENT SYSTEM

### DB fields (players table)
| Field | Type | Meaning |
|---|---|---|
| `paid` | bool | Admin has confirmed payment (or Stripe paid) |
| `self_paid` | bool | Player/host self-reported cash — may await admin confirm |
| `paid_by` | text | `'self'` / `'host'` / `'admin'` / `'stripe'` / null |
| `owes` | int | Accumulated debt across missed games (no per-game breakdown) |
| `pay_count` | int | Lifetime count of games paid — used in payRate() for IO stats |

### Payment states (getPaymentState)
`'cash_pending'` (UI-only, never persisted) → `'paid'` (paid||selfPaid) → `'debt'` (owes>0) → `'unpaid'`

### Guest payment states (getGuestPaymentState)
`'cash_pending'` → `'paid_stripe'` (paid===true) → `'paid_cash'` (self_paid===true) → `'unpaid'`

### payments.js functions
- `getPaymentState(player, cashPending)` — reads paid, selfPaid, owes
- `getGuestPaymentState(guest, guestCashPending)` — reads paid, selfPaid, paidBy
- `getPaymentMode(schedule)` — reads schedule.payment_mode (column doesn't exist yet; always returns 'both')
- `handleCashPayment(playerId, teamId, paidBy='self')` — writes self_paid=true, paid_by=paidBy; creates game_fee ledger entry
- `handleGuestCashPayment(guestId, teamId, paidBy='host')` — identical write, different default paidBy; creates guest_fee ledger entry
- `handleMarkPaid(playerId, teamId, matchId, amount)` — writes paid=true; calls `findMatchLedgerEntry` for the real matchId first, then for null matchId (cross-path promotion), then upserts if neither found
- `handleResetPayment(playerId, teamId, matchId)` — writes paid/self_paid/paid_by/paid_at reset; always resets ledger entry to 'unpaid' (both null and non-null matchId); player_match cleared only when matchId is known
- `handleClearDebt(playerId, teamId)` — writes owes=0; creates debt_payment ledger entry
- `handleWaiveDebt(playerId, teamId, amount, note)` — writes owes=0; creates waiver ledger entry
- `handleStripePayment(playerId, teamId, amount)` — writes paid=true; creates game_fee/stripe ledger entry
- `getUnpaidPlayers(players, payments)` — pure filter; orphaned
- `getSelfPaidPending(players)` — pure filter; orphaned
- `generateMatchReport(match, groupName)` — text formatter; orphaned

### paid_by values
self | host | admin | stripe | null

### payment_ledger — supabase.js functions
- `createLedgerEntry(entry)` — inserts; supports `entry.upsert=true` for conflict-safe write using partial-index-aware `onConflict` columns
- `updateLedgerEntry(id, updates)` — patches status/method/paidBy/paidAt/note/matchId
- `getLedgerForPlayer(playerId, teamId, limit=20)` — returns rows newest-first
- `getLedgerForTeam(teamId)` — returns all team rows newest-first
- `findMatchLedgerEntry(playerId, teamId, matchId, type)` — targeted dedup lookup; uses `.eq("match_id", matchId)` or `.is("match_id", null)` depending on matchId; `.limit(1)` + `data?.[0]` (safe vs maybeSingle when duplicates may exist); logs `console.error` on query failure to distinguish RLS/network error from genuine empty result
- `getOutstandingBalance(playerId, teamId)` — sums unpaid ledger amounts

### Ledger dedup — cross-path scenario
Player self-pays before lineup lock (matchId=null entry created). Lineup lock then runs, admin marks paid with real matchId:
- `handleMarkPaid` checks for real-matchId entry first (not found)
- Then checks for null-matchId entry (`existingNull`) — found
- Updates that entry: sets match_id = real matchId (promotes it), status = 'paid'
- No duplicate created

### matches.payments jsonb
- Format: `{ "PlayerName": true/false, ... }` — keyed by **player name string** (not ID)
- Written by `saveMatchResult`; read back by `dbToMatch`; used by `updatePlayerRecords` for payCount/owes
- **Never displayed in UI** — purely an accounting artifact; name-keyed = fragile

### owes recalculation
`updatePlayerRecords()` in ScoreScreen save is the sole owes-increment path — adds price to unpaid in-players at result entry time. `carryForwardDebts` removed session 26. `draftNextWeek` removed session 19.

### Payment confirmation flow
`handleCashPayment` sets `self_paid=true` (not `paid=true`). Player sees amber "Awaiting confirmation" chip (`selfPaid=true, paid=false`). Admin sees player in the gold pulsing banner → taps "CONFIRM ✓" → `handleMarkPaid` sets `paid=true` → player sees green "✓ Paid" chip.
- `selfPaid=true` still counts as `isPaid` in PaymentsScreen (player appears in PAID UP section) — admin confirmation is a UX signal, not a payment gate
- `handleCashPayment` now uses find-then-update pattern: calls `findMatchLedgerEntry` first; if existing row found, calls `updateLedgerEntry`; otherwise `createLedgerEntry`. Wrapped in try/catch with `console.error` + re-throw.

---

## NOTIFICATION SYSTEM

### Auto triggers
- gameDay9am, oneHrBefore, debtReminder
- bibs24hr, bibs45min, squadFull, spotOpened
- gameLive, gameCancelled, scheduleChange
- autoOpen (game goes live — notify all active players)
- teamsConfirmed (teams picked — notify all IN players)
- streakNotification (3/5/10 games)
- monthlySummary (end of month)

### Manual triggers (admin)
- Chase no-responses
- Cancel week
- Announce to squad (recipient picker)
- Game is live toggle

### Config
- Quiet hours — admin configurable per team (quietStart/quietEnd in reminders_config)
- 10 per-trigger toggles in ScheduleScreen Notifications tab: gameLive, squadFull, spotOpened, gameCancelled, gameDay9am, oneHrBefore, debtReminder, bibs24hr, bibs45min, teamsConfirmed
- push_subscriptions + notification_log tables
- notify.js cron handlers: flushQueue, gameDay9am, oneHrBefore, debtReminder, bibs24hr, bibs45min, autoOpen, teamsConfirmed

---

## STRIPE PAYMENTS (not yet built)

### Architecture
- Stripe Connect with application fees
- Each team has one treasurer who connects Stripe account
- Platform fee: 20p per transaction
- Stripe fee: 1.5% + 20p (EU cards)

### Refund policy
- Non-refundable by default
- Game cancelled → automatic full refund
- Admin manual refund → one tap
- Platform fee always non-refundable

### Test case
- Gurnam (treasurer, iPhone) — Finbar's Tuesdays
- Needs: full name, DOB, address, sort code, account number

---

## PHASE 1 — CURRENT

| Feature | Status | Notes |
|---|---|---|
| Rotate Supabase keys | ✅ Done | New key in INFRASTRUCTURE section |
| PlayerView redesign | ✅ Done | |
| StatsView rebuild | ✅ Done | IO Statbook |
| HistoryView rebuild | ✅ Done | Results screen |
| AdminView rebuild | ✅ Done | |
| player_match + player_career tables | ✅ Done | |
| player_injuries table | ✅ Done | |
| Teams confirmed view | ✅ Done | |
| Demo environment | ✅ Done | team_demo, seed script at scripts/seed-demo.js |
| POTM + Results display text | ✅ Done | |
| My IO screen | ✅ Done | MyIOView.jsx, useIOIntelligence.js |
| POTM voting system | ✅ Done | Modal, cron jobs, push, admin tiebreak |
| ScoreScreen Part A | ✅ Done | 6-stage progressive flow, score_type, last_goal_scorer |
| ScoreScreen Part B | ✅ Done | HistoryView: score type badges, won-by display, last goal scorer |
| Admin view consistency | ✅ Done | Sticky heroes, 5-tab admin nav, My IO handler, Gaffer disabled |
| Player League Table | ✅ Done | PlayerLeagueTable.jsx + getPlayerLeagueTable; integrated in StatsView session 20 |
| Admin screens redesign | 🔲 Partial | ScheduleScreen ✅ session 13, TeamsScreen ✅ session 21, SquadScreen ✅ session 22; BibsScreen + others still default |
| Vice Captain system | ✅ Done | Session 22–23: VC toggle, PlayerProfile ROLES section, HeroCard ADMINS block, access gating |
| Payments admin screen | ✅ Done | PaymentsScreen.jsx — 4-section layout, ledger dedup, inline Reset/Mark Paid |
| Stats rewrite (player_match) | ✅ Done | Session 22: all player leaderboards read from player_match via getPlayerLeagueTable; period-filtered insight tiles |
| Payment ledger dedup | ✅ Done | Session 22: createLedgerEntry resilient insert + 23505 conflict recovery; PostgREST upsert partial-index limitation |
| Head to Head card | ✅ Done | Session 22: initial build. Session 23: feature-complete rewrite (score_type gating, 5-verdict chemistry, period selector wired up, adaptive tiles by dominantType, sample-size floors, reliability decoupled, null bar fix) |
| Pre-launch /create + /join audit | ✅ Done | Session 23 commit 9: user_id propagation, joinUrl protocol fix, iOS-only redirect gate, onboarding_complete timing |
| Onboarding redesign | ✅ Done | CreateTeam, AddPlayers, ShareLinks rebuilt session 13 |
| JoinSuccess install screen | ✅ Done | Platform-detected, placeholder screenshot slots |
| RLS + security hardening | ✅ Done | Session 24: 47 SECURITY DEFINER RPCs, all 19 tables locked, anon key safe |
| /create auth gate | ✅ Done | Session 24: hard auth gate + ioo_pending_route sessionStorage round-trip |
| team_admins table | ✅ Done | Session 24: migration 002, written by create_team RPC, seeded for team_demo |
| link_player_to_user RPC | ✅ Done | Session 24: migration 022, authenticated-only, replaces direct table write |
| All player_match reads moved to RPC | ✅ Done session 25 | `get_team_state_by_player_token` extended: match_stats, win_rate, reliability, ledger, last_match_meta, player_form |
| Multi-team player switcher | ✅ Done session 26 | player_get_teams RPC; getPlayerTeams rewritten; MySquads.jsx accordion wired into PlayerView my-view tab |
| is_vice_captain cross-team fix | ✅ Done session 26 | Migrated from players to team_players; 5 migration files updated; supabase.js write paths cleaned |
| Live board POTM + bibs + form dots | ✅ Done session 25 | `lastMatchMeta` + `playerForm` computed via RPC (player route) and `computeStatsFromHistory` (admin route); camelCase mapping fixed in supabase.js |
| Teams confirmed realtime | ✅ Done session 25 | `confirmedThisSession` ref guards squad sync; `teamsConfirmedRef` prevents stale closures; `handleClearConfirm` calls `confirmTeams` to clear `players.team` server-side |
| POTM voting RLS fix | ✅ Done session 25 | `submit_potm_vote` + `get_potm_voting_state` RPCs; voterToken threaded to modal; no-votes tally fix; attendee-scoped notify |
| Join/login redesign | ✅ Done session 27 | |
| Stripe Connect | 🔒 Blocked | Needs platform account |
| Apple Sign In | 🔒 Blocked | Needs Dev account £79 |
| Undo last action | 🔲 Backlog | |
| Super admin dashboard | 🔲 Backlog | Read-only, Tarny only |
| Last goal scorer in IO Intelligence | 🔲 Backlog | Use last_goal_scorer field on matches |
| Bib streak in IO Intelligence | 🔲 Backlog | Consecutive bib games insight |
| WhatsApp share text update | 🔲 Backlog | Update share copy in HistoryView |
| bibs_enabled boolean on schedule | ✅ Done | Column added session 13; ScheduleScreen + ScoreScreen to use it |

---

## PHASE 2 — WEEKS 2-4

| Feature | Notes |
|---|---|
| IO Wrapped | End of season shareable card |
| POTM voting | ✅ Done (session 10) — full system built |
| Monthly summary notifications | End of month push |
| Streak notifications | 3/5/10 game streaks |
| Random player signup | Postcode, availability |
| Admin find a random | Radius search, ping system |
| Vice Captain access | ✅ Done (session 22–23) — VC toggle, PlayerProfile ROLES section, HeroCard ADMINS block, full admin access gating |
| Player profile cross-team | Career stats, player_career table |
| Multi-team player switcher | ✅ Done session 26 | player_get_teams RPC + MySquads.jsx accordion |
| is_vice_captain per-team migration | ✅ Done session 26 | Migrated to team_players; migration 026 |
| owes double-increment guard | ✅ Done session 26 | carryForwardDebts removed; updatePlayerRecords guarded |
| Mid-game team switches | Phase 2 — tomorrow | ScoreScreen switches stage, team_switches jsonb, final team determines W/L/D |

---

## PHASE 3 — MONTH 2+

| Feature | Notes |
|---|---|
| iOS + Android native | Capacitor |
| Apple Sign In native | After Dev account |
| Venue white-label | After user numbers |
| Booking integration | Needs venue API |
| WhatsApp Business API | Phase 3 notifications |
| Club Manager | Second product, B2B |
| Grassroots app | Full stats: assists, cards, ratings |
| In or Out Ltd | Companies House £12 |
| Trademark | ~£170 UK |
| Apple Watch goal logger | Phase 3 | tap team → scroll to player → confirm; Swift/SwiftUI watchOS extension; ~28h total; requires Capacitor iOS first |

---

## PHASE 4 — LEAGUE MODE (parked, revisit post-launch)

### Concept
Extend In or Out from a team coordination app into a league management platform.
Sell B2B to 5/7-a-side venues (Goals, Powerleague, independents). Each venue
runs leagues, each league has teams, teams play fixtures, results build a live
league table. Players in those teams use the same /p/TOKEN flow they always did.

### Why this is feasible
~50-60% of the data model and UI primitives are already in place from the
team app. The atomic unit (player_match row) is already correct. matches table
already tracks score, scorers, POTM, winner. Realtime already enabled. Squad
confirmation, score entry, form dots, results accordion, stats screen patterns
all reusable. Multi-tenancy by team_id extends cleanly to league_id.

### Estimate
8-11 sessions to viable v1 (one pilot venue). +4-6 sessions to productionise
(multi-season, transfers, archiving). Build difficulty is moderate. Selling
and supporting venues is the harder problem.

### Why parked until Phase 4
- Pre-launch on core product; pivoting now delays beta and dilutes focus
- B2B sales motion is different from indie self-serve
- Easier to sell to a venue once we already have players from that venue using
  the team app organically — "I have 200 of your players already, want to run
  your league free for one season" is a much stronger pitch than cold prototype
- Validates IO Intelligence as the differentiator first

### Schema decisions to make BEFORE league mode build
Capture these in the schema as we go so league mode is unblocked later
rather than requiring painful migration:
- New tables to plan for: venues, leagues, fixtures, referees
- matches: consider nullable home_team_id, away_team_id columns now even if unused
- player_match.team_assignment: consider allowing team_id reference, not just 'A'/'B'
- matches.motm: consider allowing array (one POTM per side) — currently single value
- players: consider venue_id, league_id nullable refs for future
- Hierarchy shift: today is team → players. Future is venue → league → team → players

NOTE: do NOT make these schema changes pre-emptively. Just keep them in mind
when designing new tables in Phase 1-3 so we don't paint ourselves into a corner.

### New build scope (when revisited)
- venues, leagues, fixtures tables + relationships
- Fixture generator (round robin, home/away balance) — solved problem, libraries exist
- League table view — sortable, live, expandable per team
- Two-admin fixture confirmation flow (both squad admins confirm matchday team)
- Referee role + neutral score entry mode
- Venue admin dashboard (manage leagues, teams, fixtures, disputes)
- Dispute resolution workflow — v1: venue admin wins
- Suspensions across fixtures (yellow/red cards already in player_match Phase 3 spec)
- League archiving + multi-season support
- Onboarding flow for venue importing existing teams/players mid-season

### Pricing model (provisional)
- Venue licence: £50/month per venue (vs LeagueRepublic, Spawtz, GameDay)
- Free pilot season for first venue to validate
- B2C side (players) remains free; venue licence is the revenue

### Competitors in this space
LeagueRepublic, TeamStats, GameDay (Aus), Spawtz. All entrenched, all dated UI,
all have venue contracts. Sticky but beatable on product quality.

### Sales path
- Don't approach Goals/Powerleague corporate until we have proof points
- Start with independent venues — single decision-maker
- Lead with player numbers already at their venue from team app usage
- Free first season; convert in season 2 on proven retention

---

## BUSINESS MODEL

| Revenue | Amount | When |
|---|---|---|
| Team subscription | £5/year | Phase 2 |
| Transaction fee | 20p per player per game | Phase 2 |
| Venue white-label | TBD | Phase 3 |
| Venue league licence | ~£50/month per venue | Phase 4 |

**Projections:**
- 500 teams + payments: ~£50,000/year
- 5,000 teams + payments: ~£505,000/year

---

## KEY DECISIONS LOG

- Token links always work — no auth for day-to-day use
- Auth only required when JOINING a new team
- Email is the identity — not the name
- Cover pool players never need the app
- Reserve list always visible
- Less than 24hrs — all reserves notified simultaneously
- Refunds non-refundable by default
- Platform fee (20p) always non-refundable
- Plus one spot independent once paid
- No performance ratings — reliability only
- Three player tiers: plus one / cover pool / random pool
- Stripe Connect with application fees architecture
- POTM in UI, motm in DB/code — never change DB column
- Results in UI, History in filenames/functions — never change
- player_match.match_id is text not uuid — app generates IDs
- iOS localStorage does NOT bridge Safari to PWA
- ioo_last_visited permanent, ioo_redirect_to one-time 7-day
- Injuries tracked in player_injuries table
- Demo reset = full restore to baseline
- Multi-team admin: Phase 2, team switcher already exists
- Onboarding + join/login redesign: pre-launch, not now
- My IO tab: 4 tabs for players, 5 tabs for admins
- postcodes.io for postcode to lat/lng (free, no key)
- Returning player joining a second team: REUSES the existing players row — new team_players entry only, no new players record created
- Flat stat columns (goals, motm, bib_count, w, l, d, attended etc.) are cross-team totals on one row, not per-team — player_match rows support per-team breakdowns but denormalised columns don't
- **Known bug**: NameStep asks returning player "what should we call you?" but the typed name is silently discarded — handleJoin uses existing.name from DB, ignores the input
- `is_vice_captain` lives on `team_players` (per-team), not `players` (global) — migrated session 26; a player can be VC in one team but not another
- Multi-team switcher uses `player_get_teams` RPC keyed on `auth.uid()` — token-only players (no `user_id`) see the empty "Sign in to see all your squads" state
- `carryForwardDebts` removed — `updatePlayerRecords` is the sole owes-increment path; guard comment in attendance.js
- VC access = full AdminView minus Rotate Admin Link (which doesn't exist yet); scoping is done via `isViceCaptain` prop throughout, not `role_scope` (dormant for Phase 2 RBAC)

**Mid-game team switches:**
- New stage in ScoreScreen between score entry and bibs
- Admin marks any player who switched teams during the game using a swap icon (⇄) next to their name
- `team_switches jsonb` column to add to matches table: `[{player_id, from: "A", to: "B"}]`
- `team_a`/`team_b` on match updated to reflect FINAL team assignments after switches
- `player_match.team_assignment` records the final team the player finished on — W/L/D derived from that
- Match history shows ⇄ icon next to any player who switched teams
- Switch time not recorded — binary only (switched or not)
- Stage is optional — if no switches, admin skips through

**Apple Watch goal logger (Phase 3):**
- Requires native iOS app (Capacitor) as container first
- watchOS extension written in Swift/SwiftUI alongside Capacitor — not possible via Capacitor alone
- Interaction: tap team A/B → crown scroll to player → tap confirm → goal logged to Supabase via companion app
- Haptic confirmation on goal log
- Realistic effort: ~20h Capacitor iOS + ~8h watchOS = ~28h
- Prerequisite: Apple Dev account £79 (same as Apple Sign In)
- Phase 3 — revisit when iOS native app is being built
- `bib_history` has a UNIQUE constraint on `(team_id, match_date)` — one holder per team per match night; both write paths (`saveBibHolder` + `insertBib`) use UPSERT with `onConflict: "team_id,match_date"`
- StatsView reads ALL player stats from `player_match` via `getPlayerLeagueTable` — `players` flat columns (`goals`, `motm`, `w`, `l`, `d`, `attended`) are write-only convenience fields, not used for display; Payment Reliability and The Core are intentionally exempt (no `player_match` equivalent / current headcount)
- PostgREST `.upsert()` cannot target partial unique indexes — the `onConflict` parameter generates bare `ON CONFLICT (cols)` without the `WHERE` predicate PostgreSQL requires; use INSERT + catch `23505` in application code instead
- Period filtering in StatsView: `getPlayerLeagueTable` handles player stats; `matchHistory` is filtered client-side by `periodCutoff` date string for insight tiles; both cutoffs must use the same date format (`YYYY-MM-DD`)
- `addPlayerToTeam` is the correct function for admin-adding players from SquadScreen — writes both `players` row and `team_players` link, generates token; `upsertPlayer` does NOT write `team_players` and must not be used for this purpose
- Returning player join: auto-link via upsert on `team_players` (`onConflict: team_id,player_id`), skip NameStep, preserve existing name from DB; NameStep only shown for brand new players (no existing `user_id` in DB)
- Head to Head data: all derived from `player_match` via 2 queries + JS computation, no new tables; `getHeadToHead` returns `null` on error; verdict thresholds: `> 55%` win rate = `better_together`, `> 1.5x` wins = `nemesis`/`you_own_them`, `> 10%` delta = chemistry effect
- League table tap target activates H2H for v1; IO Intelligence cards and teams tile deferred to Phase 2
- `myId` is required for H2H — league table rows are non-tappable when viewer has no player identity (pure admin without squad account); `!!myId` guard in PlayerLeagueTable; `me &&` guard in StatsView before mounting HeadToHead; `myId` must be passed to BOTH the top-level `<StatsView>` render AND PlayerView's internal `<StatsView>` (the admin stats-tab route uses PlayerView's internal render)
- `getHeadToHead` uses two-query pattern for dominantType: Query 1a all-time feeds `resolveDominantType`, Query 1b period-filtered feeds all stats via `matchMap`; dominantType must see all matches to be stable across periods — if it used only period data it would flip between 'exact' and 'margin' as the period changed
- `meRows`/`themRows` in `getHeadToHead` are filtered by `matchMap` membership immediately after Query 2 (the all-time `player_match` fetch); `matchMap` contains only period-filtered match IDs and is the single period-gating point — all downstream computation (sharedMatchIds, partition, chemistry baselines, verdicts, recentShared) inherits period scope automatically
- Reliability in `getPlayerLeagueTable` is period-independent: numerator (`allTimePlayed`) and denominator (`totalTeamGames`) both use all-time queries; Step 3b separate all-time attended query added to support this; makes reliability a player trait not a period stat
- **H2H** `dominantType` is always team-wide all-time, regardless of period selector — it's a UI presentation decision ("which tile to show"), not a stat. Team's scoring style is stable; UI shouldn't thrash on period change
- **Stats + H2H** Reliability is intrinsically all-time, ignores period selector — answers "is this player reliable" which is a long-term question. Numerator + denominator + gate all use all-time data
- **H2H chemistry verdict** requires `gamesTogether >= 3 AND meNonShared >= 3 AND themNonShared >= 3` — otherwise returns `'building'`. Five-verdict system: `good_luck_charm` / `bad_influence` / `asymmetric` / `no_effect` / `building`
- **H2H period filter** implementation: filter `meRows`/`themRows` (player_match results) by `matchMap` membership IMMEDIATELY after Query 2, before any downstream computation. This propagates period scope naturally to `sharedMatchIds`, `meNonShared`, partition loop, chemistry — no per-call gating needed
- **H2H runs TWO matches queries**: Query 1a (all-time, for `dominantType`) and Query 1b (period-filtered, for stats). Cost is one extra small query per H2H open in 'all' mode; clarity wins over optimisation
- **Sample size matters for verdicts**: chemistry refuses to fire with < 3 games of each baseline; main verdict requires `>= 3 totalShared`; Section 2 streak softens "1 in a row" to "won the last meeting" copy
- **Score type gating pattern**: use `hasGoalData(scoreType)` helper for any goal-related computation. Filter the data set first, then run reductions over the filtered set, AND divide by the filtered set's count (not the unfiltered count) so averages are honest about sample size
- **Section 4 nullability pattern**: when a metric is null for either side, suppress the bar visual but keep the label "—". Maintains layout stability without misleading visual
- **`addPlayerToTeam` options**: accepts `{ type, priority, isViceCaptain, userId }`. All optional, all defaulting safely. user_id propagation is critical for returning-player detection
- **`ioo_redirect_to` is iOS-only**: write site MUST be gated by `isIOS && !isStandalone`. Pattern repeats in App.jsx getRoute and JoinTeam.jsx useEffect. Writing on Android/desktop causes disorienting forced redirects
- **`onboarding_complete=true`** is written exactly once, at step 3 (ShareLinks.jsx handleGoAdmin), when the user taps the final "go to team" button. Step 2 (submitPlayers) leaves it false

---

## KNOWN BUGS / TECH DEBT

| Item | Detail | Priority |
|---|---|---|
| ~~NameStep discards returning player name~~ | ✅ Fixed (session 22) — Part A detects returning player, upserts `team_players`, sets `joinedPlayer` directly; NameStep skipped | Pre-launch |
| ~~`handleAddPlayer` missing `teamId`~~ | ✅ Fixed (session 22) — `handleAddPlayer` now calls `addPlayerToTeam` which writes both `players` + `team_players` rows | Pre-launch |
| ~~`addPlayerToTeam` not in core barrel~~ | ✅ Fixed (session 22) — exported from `packages/core/index.js` | Low |
| ~~`players.deputy` DB column~~ | ✅ Resolved (verified session 23) — `deputy` column not present in current schema; rename completed in DB | Done |
| `player_career` mostly empty | Only `total_bib_count` ever written; 11 other career fields permanently empty | Phase 2 |
| `owes` double-increment risk | ✅ Resolved session 26 — `carryForwardDebts` removed; `draftNextWeek` already dead (session 19); `updatePlayerRecords` has guard comment as sole write path | Done |
| `packages/core/engine/scoring.js` file name | Hosts `periodCutoff` (non-scoring helper) alongside scoring helpers. Rename to broader name (e.g. `stats-helpers.js`) when file grows further | Low |
| `team_demo` has no `team_admins` row | Demo team predates the table. Switcher won't show it for Tarny until backfilled. | Low |
| ~~`App.jsx:639` `addPlayerToTeam` call signature mismatch~~ | ✅ Fixed session 27 — dedicated `playerJoinTeam` SECURITY DEFINER RPC added; join flow no longer requires admin token; `player_join_team` SQL written, wrapper in supabase.js, barrel-exported, call site in App.jsx corrected | Done |
| ~~getPlayerTeams RLS bypass~~ | ✅ Fixed (session 25) — `teamId` now derived from `getTeamStateByPlayerToken` state directly; `getPlayerTeams` removed from player route | Fixed session 25 |
| ~~Stats + My IO showing no data~~ | ✅ Fixed (session 25) — `get_team_state_by_player_token` RPC extended with full stats block (match_stats, win_rate, reliability, ledger, last_match_meta, player_form); `computeStatsFromHistory` extended with `lastMatchMeta` + `playerForm` for admin routes | Fixed session 25 |
| ~~Realtime callbacks using direct table reads~~ | ✅ Fixed (session 25) — all three realtime callbacks (players, schedule, matches) branch on `route.type`; player/admin/demoadmin routes use RPCs; direct reads remain only for authenticated fallback path | Fixed session 25 |
| BibsScreen `insertBib` broken under RLS | BibsScreen lacks `matchId` + `adminToken` in scope — standalone bib assignment fails post-RLS lockdown. Low priority: bibs can be set via ScoreScreen result save which has both. | Low |
| Dead write functions in `supabase.js` | `bulkCancelLedgerEntries`, `bulkResetPlayerStatuses`, `deletePlayerMatchRows`, `insertMatch`, `loadTeamData`, `findPlayerByUserId` are unreferenced post-RLS rewrite. Safe to remove in any future cleanup pass. | Low |
| Admin Decide button in ScoreScreen POTM stage | `onAdminDecide` prop not wired — button currently calls `onBack()`, exiting ScoreScreen instead of opening tiebreak modal. Fix: wire to new `onAdminDecide` prop from AdminView. | Pre-UAT |
| ScoreScreen POTM stage: `GET /rest/v1/player_match 401` | Direct table read in POTM eligibility fetch not yet migrated to RPC. | Low |
| Dead write path: `POST /rest/v1/matches 401` | Direct table write somewhere in client code. Likely a legacy path superseded by `admin_save_match_result` RPC. | Low |

---

## WORKING PROCESS

All code changes follow a 3-step workflow via Claude Code:

### Step 1 — AUDIT
Prompt Claude Code to read the target files and report findings.
No code is edited. Audit covers: current state, imports, existing
patterns, risk flags, legacy references, integration points.
Developer reviews audit output and approves before proceeding.

### Step 2 — EXECUTE
Prompt Claude Code with the approved changes. Describe WHAT and
WHY, not exact code — Claude Code writes the implementation.
Keep prompts focused: one file or one logical unit per prompt.
Large stages split into sub-prompts (e.g. 5B-part1, 5B-part2).

### Step 3 — VERIFY
Prompt Claude Code to run checks: grep for removed terms, presence
checks for new code, build verification (vite build), git diff
for scope confirmation, audit checklist sign-off.
Developer reviews verification before moving to next stage.

### Conventions
- All async functions: try/catch, console.error on error paths
- No console.log anywhere
- Optimistic UI with revert on error for all Supabase-calling handlers
- CSS variables from tokens.css only (no hardcoded colours except
  #60A0FF Team A, #FF6060 Team B)
- Phosphor icons weight="thin" throughout
- Bebas Neue headings/numbers, DM Sans 400 body
- Commit and push after each verified stage

---

## TEST ACCOUNTS

| Person | Role | Notes |
|---|---|---|
| Tarny | Developer + admin | tarnysingh@gmail.com |
| Gurnam | Beta tester + Stripe | iPhone, willing to connect Stripe |
| Finbar | Real organiser | Finbar's Tuesdays |

**Real teams:**
- team_finbars — Finbar's Tuesdays (primary test)
- team_mfw3hhu6 — Monday Footy (cash only)

**Demo team:**
- team_demo — 7 A Side FC (demoadmin)

---

## SESSION NOTES

**Session 1 (May 9 2026):**
Built core app, Supabase backend, multi-tenancy, player routing, admin view, stats, history, bibs, payments, PWA.

**Session 2 (May 10 2026):**
Built Google auth, email magic link, auth-first join flow, returning user recognition, cover pool, Mark All Paid, Clear Debt, city field, Posthog, T&Cs, Google Search Console, GitHub private.

**Session 3 (May 11 2026):**
Built admin link reset, reserve list with draggable reorder.

**Session 4 (May 11 2026):**
Built reminders engine, debt tracking, web push notifications, VAPID, quiet hours, per-trigger toggles, ScoreScreen bib picker, debt auto-calc.

**Session 5 (May 11 2026):**
Built PWA install flow, notification subscriptions, PWA welcome screen, find_player_by_email RPC.

**Session 6 (May 12 2026):**
Major UI redesign + new features.
- Full design system (tokens.css, Phosphor icons)
- PlayerView, StatsView, HistoryView, AdminView all rebuilt
- Plus One, Injured player, Ask the Gaffer
- Payment logic full rewrite (payments.js)
- player_match, player_career, player_injuries tables
- players: paid_by, is_guest, guest_of, injured, injured_since, nickname
- matches: venue, kickoff_time
- Demo environment: team_demo, 25 players, 22 matches, /demoadmin, auto-reset
- POTM and Results display text throughout
- Teams confirmed view with form dots, POTM trophy, bibs indicator
- IO Intelligence system fully specced

**Session 7 (May 13 2026):**
Planning + demo environment hardening. No major new UI.
- Phase 4 — League Mode logged with full spec (parked post-launch)
- Two-stage beta plan agreed: Stage 1 Tue May 19 (Finbar's Tuesdays),
  Stage 2 Tue May 26 (+ Monday Footy), broader beta from ~Jun 9,
  quiet public availability late Jul / early Aug
- Stage 1 payment model: cash only (Stripe in if it lands, not a blocker)
- POTM voting cut from Stage 1 — admin picks POTM on ScoreScreen
- Install instructions decision: JoinSuccess.jsx hosts install screen,
  platform-detected (iOS/Android/desktop), soft-block with tiny skip link
- Screenshot production: Tarny captures raw, Claude wraps + annotates
- Demo environment fully restorable:
  - 22 matches + 280 player_match rows hydrated
  - Gav's stats + 4 injury stints correct
  - Kieran injured:false baseline (injury-prone persona, not currently out)
  - resetDemoData() rewritten — restores player_match, injuries,
    removes guests, removes added matches, resets all 25 baselines
  - App.jsx tracks last_interaction on /p/p_demotoken_* visits
  - cron.js synced with manual reset behaviour
- DEMO_MATCH_DATA stored as compact numeric arrays in supabase.js
  (source of truth in code, not DB — survives any Supabase manual edits)
- Beta launch checklist drafted (separate doc: BETA_LAUNCH_CHECKLIST.md)

**Session 8 (May 13 2026):**
Built the complete My IO screen, rebuilt JoinSuccess, and shipped new app icons.
- NavBar.jsx — Brain icon (Phosphor), MY IO tab with green I + red O label, admin tab order fixed (My IO before Admin)
- supabase.js — 10 new IO Intelligence query functions added (getPlayerMatchStats, getWinRate, getCurrentRun, getReliabilityScore, getMostPlayedWith, getOpponentStats, getNemesis, getBestPartnership, getPlayerImpact, getPOTMVoteStats)
- useIOIntelligence.js — new hook, parallel queries gated by gamesPlayed unlock thresholds
- MyIOView.jsx — full screen built:
  - Sticky IO brand header (zIndex 20)
  - TacticsBoardHero — tactics board SVG, YOUR GAME/YOUR STORY 40px italic, attendance ring with glass tile
  - StatsRow — 3 tiles (POTM, Goals/Run, W/D/L with win rate subtext)
  - InsightsGrid — 8 insight cards in 2-col grid, ordered by unlock threshold
  - Win Rate card (unlocks 2+) and Current Run card (unlocks 3+) built with data
  - Unlock bar showing next unlock step
  - DeeperIntelSection (partnerships, nemeses, played with, team impact)
  - LegacySection (16+ games)
  - 0-game and guest empty states
  - Scroll reveal via IntersectionObserver, unlock animation via localStorage
- PlayerView.jsx — wired my-io tab to MyIOView
- Key gotchas: position:sticky breaks inside transform parent (io-section uses translateY); CSS vars can't be used in SVG fill attributes; PostgREST can't self-join so partner/nemesis queries use two-step JS
- New app icons shipped — favicon package from realfavicongenerator.net:
  - public/icons/: favicon.ico, favicon-96x96.png, favicon.svg, apple-touch-icon.png, web-app-manifest-192x192.png, web-app-manifest-512x512.png
  - index.html: full 5-tag icon set, theme-color corrected to #0A0A08
  - manifest.json: 4 icon sizes, background_color + theme_color = #0A0A08
  - sw.js: notification icon + badge updated to new filenames
- JoinSuccess.jsx fully rebuilt as PWA install instruction screen:
  - Platform detection: iOS Safari, Android Chrome, desktop, already-installed (standalone → redirect)
  - iOS: 3-step instructions (Share → Add to Home Screen → Tap Add), gold info row
  - Android: 2-step instructions (menu ⋮ → Install app), gold info row
  - Desktop: join URL copy pill with Copied! feedback
  - PlaceholderScreenshot component (140×240, dashed border) — swap in real screenshots later
  - Green CTA button + muted "skip for now" link, both navigate to /p/[token]
  - Posthog events: install_screen_cta_tapped, install_screen_skipped (both include { platform })
  - App.jsx call site updated: player={joinedPlayer} team={joinTeam}

**Session 9 (May 13 2026):**
Auth routing fixed + join/success UI polish.
- Root cause identified: Supabase URL allowlist (exact match only, no wildcard) was stripping the `?returnTo=` query param from magic link redirects. AuthCallback fell back to `auth_return_to` in localStorage — never set — and redirected to `/`, so JoinSuccess never appeared.
- Fix 1: App.jsx join route useEffect now writes `ioo_pending_join` to sessionStorage (`{ returnTo: "/join/CODE" }`) before any auth redirect. AuthCallback reads this first, clears it, redirects to `/join/CODE`. URL param remains as secondary fallback.
- Fix 2: BASE_URL fallback in JoinTeam.jsx and SignIn.jsx changed from `https://in-or-out.com` → `https://www.in-or-out.com` to match production domain used in Supabase allowlist.
- JoinTeam.jsx UI: "IN OR OUT" header → IO brand treatment (green I, white "n or ", red O, white "ut") in Bebas Neue. NameStep join button: gold (var(--gold)) when name typed, muted (var(--s3)) when empty. Sub-text: "No account needed · Takes 5 seconds" → "Takes 10 seconds — no password needed".
- JoinSuccess.jsx UI: Section headings (IOSInstructions, AndroidInstructions, DesktopInstructions) — `var(--font-display)` replaced with `'Bebas Neue', sans-serif` + letterSpacing 0.05em (was rendering as system font). "In or Out" app name → IO brand span treatment. InstallStep marginBottom 24 → 32 (8px more breathing room).

**Session 10 (May 13 2026):**
Built complete POTM voting system end-to-end.
- **Schema additions:** `potm_votes` table (UNIQUE match_id,voter_id); new columns on `matches` (voting_open, voting_closes_at, vote_count, total_voters, was_admin_decided, admin_decision_pending, tied_candidates); new columns on `schedule` (lineup_locked, active_match_id, voting_open, voting_closes_at)
- **supabase.js:** matchToDb/dbToMatch + scheduleToDb/dbToSchedule updated for new columns; writePlayerMatchRows changed INSERT→UPSERT (onConflict: match_id,player_id); 6 new POTM query functions added; getPOTMEligiblePlayers uses two-query pattern (no join)
- **cron.js:** lineupLockJob (triggers when `now >= game_date_time` — first cron tick at or after kickoff, so real-world window is kickoff → kickoff+15min depending on cron cadence; requires game_is_live=true and lineup_locked=false; generates matchId, writes player_match stubs, sets lineup_locked + active_match_id); potmVotingOpenJob (kickoff+60min — opens voting if ≥3 players, denormalizes to schedule for realtime, sends potmVotingOpen push); potmTallyJob (when voting_closes_at passes — tallies, announces winner or sets admin_decision_pending on tie)
- **POTMVotingModal.jsx:** new file — full-screen overlay (rgba(0,0,0,0.75) + blur(12px)), gold glow card (maxWidth 380px), Team A/B sections, 4-state machine (idle→selected→confirming→locked), pulse animation on Vote buttons, skip link, already-voted read-only state, 3s auto-dismiss on lock-in
- **AdminView/index.jsx:** POTMTiebreakModal component added — detects adminDecisionPending on any match, shows tied candidates only, no skip, calls closePOTMVoting(matchId, winnerId, true) + fires potmResult push on lock-in
- **PlayerView.jsx:** POTM modal wired up (shows when schedule.votingOpen transitions true + player is eligible); gold result banner (5s auto-dismiss); getPOTMEligiblePlayers + getPOTMVotes imported
- **App.jsx:** matchSub changed from event:"INSERT" to event:"*" to catch voting_open UPDATEs in realtime
- **ScoreScreen.jsx:** uses schedule.activeMatchId if set (lineup lock integration)
- **scripts/seed-demo.js:** standalone Node.js full demo seed script — team, 25 players, 22 matches, player_match rows, injuries, schedule, settings, demo_sessions; run with `SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/seed-demo.js`
- **Architectural decisions:** schedule.voting_open denormalized (not just matches) so existing realtime schedule subscription drives PlayerView modal; schedule.active_match_id solves match_id chicken-and-egg between lineup lock and ScoreScreen; UPSERT on player_match prevents duplicate rows when both cron and ScoreScreen write

**Key gotchas from session 10:**
- PostgREST 400 error on `players(id, name)` embedded join from player_match — PostgREST foreign key join not supported in this configuration; use two sequential queries instead
- isResult condition must check `!votingOpen && !!motm` not just `!!motm` — motm can be set on a previous match while current voting is open
- `votingClosesAt` is NOT cleared when voting closes (cron only sets voting_open=false) — cannot use timestamp presence/staleness to detect open state; must pass `votingOpen` boolean explicitly as prop

**Session 11 (May 13 2026):**
POTM bug fixes + ScoreScreen full rebuild + UI polish.

**POTM bug fixes:**
- `cron.js` `potmVotingOpenJob`: removed broken PostgREST embedded join `players(id,name,token)` — now selects only `player_id` from `potm_votes` then does a separate players lookup for tokens
- `supabase.js` `closePOTMVoting` + `cron.js` `potmTallyJob`: both correctly store `winnerId` (player_id) in `matches.motm`. Fixed broken `rpc("increment_motm")` → replaced with read-then-increment pattern on `players` table
- `PlayerView.jsx`: POTM winner banner uses `resolveMotm(activeMatch.motm, squad)` for display name; `activeMatch.motm === me.id` for isWinner check (ID comparison)

**ScoreScreen full rebuild:**
- `ScoreScreen.jsx`: complete rewrite — 6-stage progressive reveal:
  1. Mode selection: Exact Score / Won By / Declare (glow tiles)
  2. Score entry: mode-specific (scoreline + optional scorers / winner + margin / who won dropdown)
  3. Last goal winner: YES/NO → player picker if YES
  4. Bibs: dropdown picker
  5. POTM status: informational (voting open countdown / winner / admin decide)
  6. Save: green CTA with isSaving guard + error message
- Peek-scroll: after each stage completes, next card scrolls to 80px from viewport bottom
- `score_type`: 'exact'|'margin'|'declared' stored on match and passed through
- `last_goal_scorer`: player ID stored on match
- Double-fire save guard: `isSavingRef = useRef(false)` synchronous check before any async work

**supabase.js additions:**
- `saveMatchResult(matchId, teamId, match)`: UPDATEs result fields only — never touches motm/voting columns (safe after lineup lock stub row already exists)
- `saveBibHolder(matchId, teamId, playerId, playerName)`: 4-step atomic write (bib_holder on match, bib_count++ on player, bib_history insert, had_bibs flags)
- `matchToDb`/`dbToMatch`: added `score_type` + `last_goal_scorer`
- `insertMatch`: changed to upsert with `ignoreDuplicates:true` — no-ops cleanly if stub match already created by lineup lock
- `getPlayerMatchStats`: second query for score_type per match; goals only counted for exact/null score_type matches

**squad.js:** `newMatch()` now includes `scoreType` + `lastGoalScorer` fields.

**Five ScoreScreen UI fixes:**
- Mode tile titles: fontSize 14→16, letterSpacing 0.06em→0.1em
- DRAW button in Declare mode: always shows `1px solid var(--t2)` border (even unselected)
- NO button in Last Goal stage: selected state now bg `var(--s3)`, border `var(--t2)`, color `var(--t1)`
- Bibs label: "BIBS 👕" → "WHO TOOK THE BIBS? 👕"
- Removed "Draft Next Week" button from saved screen entirely

**Key gotchas from session 11:**
- motm field convention: ALWAYS store player **ID** (never name string) — `matches.motm` stores player_id; `resolveMotm(motmValue, players)` handles display via `players.find(p => p.id === motmValue)` → `nickname || name`; isWinner checks use ID comparison (`activeMatch.motm === me.id`)
- Two-query pattern is standard for any Supabase join — PostgREST foreign key joins unreliable in this config
- `isSavingRef` (useRef) required for double-fire guard — React state batching means two rapid taps both read `isSaving===false` before first render; ref is synchronous

**Session 12 (May 14 2026):**
HistoryView score display + admin view consistency + StatsView hero fix.

**HistoryView Part B — score type display:**
- Score type aware rendering per match card: exact (legacy scoreline), margin ("Won by N" + WON BY pill), declared (DECLARED pill on winner row; centered badge on draw)
- `ScoreTypePill` component: 9px Bebas Neue, pill style using gold (margin) or amber (declared) tokens
- `lastGoalScorerPlayer` derived by ID lookup against players array — silent fail if not found
- Last goal scorer shown in collapsed info row: `⚽ Last: [name]`

**HistoryView Part C — consolidated info row:**
- Collapsed card bottom row: shows only POTM / bibs / last goal scorer, separated by opacity 0.4 `·` dividers. Handles all 7 presence/absence combos correctly.
- Removed duplicate chip row (venue/time/bibs pills) from expanded card — share button follows directly after teamsheet grid.

**Admin view consistency + sticky heroes (4 scopes):**
- **Scope 1** — Old admin Header chrome removed from App.jsx entirely (sticky tab strip + status bar). `Header.jsx` import removed.
- **Scope 2** — AdminView NavBar 5-tab: `onGoMyIO` prop threaded from App.jsx → AdminView; NavBar `onTabChange` now handles `"my-io"`. All 4 non-admin tabs navigate to PlayerView via `startTab` prop — Stats/Results/My IO land on the correct PlayerView tab directly. `startTab` prop added to PlayerView; `useState(startTab || "my-view")` sets initial tab on mount.
- **Scope 3** — Sticky heroes: StatsView SeasonHeroCard extracted to `position:sticky, top:0` wrapper outside the padding div; HistoryView hero wrapper made sticky; AdminView hero wrapped in `position:sticky, top:0` outer div (inner keeps `overflow:hidden`); MyIOView TacticsBoardHero in `position:sticky, top:48` wrapper (stacks below IOBrandHeader).
- **Scope 4** — Gaffer disabled: `ENABLE_GAFFER = false` const in App.jsx; `<Gaffer/>` wrapped in `{ENABLE_GAFFER && ...}`.

**StatsView hero image fix:**
- `HERO_IMG` constant changed from Unsplash hot-link to `"/io-statbook-hero.svg"` (local public asset)
- `filter: "brightness(0.55) saturate(0.8)"` removed from `<img>` — SVG has darkening baked in; double-darkening removed

**Key gotchas from session 12:**
- `position:sticky` on AdminView hero required outer wrapper div — the hero div itself has `overflow:hidden` which would prevent sticky on the same element; wrapper is separate, inner keeps overflow
- NavBar does NOT have an `isAdmin` prop — the 5th Admin tab appears when `onAdminClick` is truthy
- `startTab` prop only works correctly because PlayerView remounts on every `view` switch (conditional render in App.jsx) — no need to reset state manually
- IOBrandHeader height is exactly 48px: `padding:"12px 16px"` + `fontSize:24, lineHeight:1` = 12+24+12

**Session 13 (May 14 2026):**
Cron infrastructure hardening + full onboarding + ScheduleScreen rebuild (Stages 2–5).

**Cron infrastructure (Stage 2):**
- `advanceGameDateJob` — midnight-only guard (`getHours()===0 && getMinutes()<15`); finds schedules where game_date_time kickoff was >3hrs ago; adds 7 days via `setDate`; resets: lineup_locked=false, active_match_id=null, game_is_live=false, is_draft=true, voting_open=false, voting_closes_at=null, auto_open_pending=true
- `autoOpenGameJob` — every 15-min cron; filters `auto_open_pending=true, active=true, is_cancelled=false`; checks opens_day matches today and current time is in the 15-min window after opens_time; sets game_is_live=true, auto_open_pending=false; fires autoOpen push notification to all active players
- Null guards added to `lineupLockJob` and `potmVotingOpenJob` (skip schedules with null game_date_time or null active_match_id)
- **Timezone fix**: `computeNextGameDateTime` and `nextWeekDateTime` now return `date.toISOString()` (UTC). Previously returned local-time string without Z, causing 1hr offset in BST when Node.js cron parsed as UTC.
- **computeOpensDay fix**: was `(idx+1)%7` (day-after); corrected to `(idx+6)%7` (day-before) — Tuesday game → Monday opens
- `notify.js`: added `autoOpen` cronType handler — fires "are you in?" push to all active (non-injured) players

**auto_open_pending column (Stage 2.5):**
- New `auto_open_pending bool DEFAULT true` column on schedule
- `is_draft` semantics clarified: now ONLY means "onboarding not complete" — never used as auto-open flag again
- `autoOpenGameJob` filters on `auto_open_pending` not `is_draft`
- `advanceGameDateJob` resets `auto_open_pending=true` on weekly advance
- `scheduleToDb`/`dbToSchedule` in supabase.js updated; `useOnboarding.js` schedule insert includes `auto_open_pending:true`

**Schema additions:**
- `teams`: added `admin_email` column
- `schedule`: added `bibs_enabled bool DEFAULT true`, `auto_open_pending bool DEFAULT true`, `season_id text`, `active bool DEFAULT true`

**Onboarding rebuild (Stages 3–4):**
- `CreateTeam.jsx` — full design system rewrite: brand header (IN/OR/OUT), progress bar 1/3, Nominatim venue autocomplete (400ms debounce, 3-char min, AbortController, silent fallback), city auto-chip "📍 city · change", price validation (empty→error, 0→confirm ack), bibs YES/NO pills, admin email field, gold CTA disabled until name entered
- `AddPlayers.jsx` — design system rewrite: brand header, progress bar 2/3, gold focus input, numbered gold badge per player, × remove, gold/muted CTA, skip link
- `ShareLinks.jsx` — full rewrite: progress bar 3/3 (all gold), admin goldb card + AdminCopyButton, per-player rows with PlayerCopyButton + WHATSAPP green button; **critical fixes**: BASE_URL=`https://www.in-or-out.com` (was missing www); `window.location.href` navigation (replaces `<a href>`); `onboarding_complete=true` written to teams before admin redirect; `teamId` prop wired from index.jsx
- `useOnboarding.js`: `computeOpensDay` fixed (day-before), `computeNextGameDateTime` returns `date.toISOString()`, `bibsEnabled`/`adminEmail` state added, `auto_open_pending:true` in schedule insert

**ScheduleScreen rebuild (Stage 5):**
- Renamed from "SETTINGS & SCHEDULE" → "MATCH SETTINGS"; tabs "SCHEDULE/REMINDERS" → "MATCHDAY/NOTIFICATIONS"
- Removed `datetime-local` input; replaced with read-only **NEXT MATCHDAY** card (`"Tuesday 19 May 2026 at 20:00"` format)
- **ONE-OFF DATE CHANGE**: date picker + UPDATE THIS WEEK button; builds UTC-correct ISO string (local Date constructor + `.toISOString()`); immediately upserts to Supabase; shows "UPDATED ✓"
- All fields as typed pickers: kickoff (15-min steps 06:00–23:45), game day (select), players needed (select), invites open day/time (30-min steps), priority lead (30/45/60/90/120 mins)
- Nominatim venue autocomplete (same as CreateTeam) with city chip
- **Bibs YES/NO pills** — reads `schedule.bibsEnabled ?? true`, saves on main save
- **Game Day helper**: "Invites auto-open [day] at [time]" — live-updates via `computeOpensDay`
- **Invites open helper**: "Game auto-opens for players on [day] at [time]" in gold
- Save button: "SAVE MATCH SETTINGS" — async `upsertSchedule` + `upsertSettings` → "SAVED ✓" → `onBack()`; pass-through fields: `autoOpenPending`, `seasonId`, `active` (never reset on manual save)
- `teamId` prop added to ScheduleScreen; AdminView now passes `teamId={teamId}` to it
- All old imports (`@platform/core` colours, `FieldRow`, `BackBtn`, `Btn`) removed

**Key decisions from session 13:**
- `is_draft` is NOT the auto-open flag — `auto_open_pending` is. `is_draft=true` means onboarding incomplete only.
- `advanceGameDateJob` resets `auto_open_pending=true` weekly so games auto-open next week without admin action
- Onboarding `computeOpensDay` (day-before) matches `autoOpenGameJob` filter — they must agree or games won't auto-open

**Returning player join flow audit (session 13):**
- `handleJoin` in App.jsx calls `findPlayerByUserId(authUser.id)` first; if found, inserts a `team_players` row only — no new `players` record
- `findPlayerByEmail` RPC returns one row per team `[{ token, player_id, player_name, team_id, team_name }]` — multiple rows for multi-team players
- `findPlayerByUserId` uses `.single()` — returns one `players` row; `team_players?.[0]?.teams?.name` only resolves the first team
- Stat columns are shared/accumulated across all teams — no per-team reset on join
- **Bug**: NameStep name input is silently discarded for returning players — `handleJoin` sets `joinedPlayer.name = existing.name`, ignores what was typed; fix = skip NameStep entirely for users with `user_id` match, or show their existing name pre-filled

**Session 14 (May 14 2026):**
Nickname display audit + HistoryView score type display corrections.

**Nickname tap fix (AdminView PlayerProfile):**
- `AdminView/index.jsx` PlayerProfile — `onClick={() => setEditingNick(true)}` moved from 12px `PencilSimple` icon to outer div wrapper; entire nickname row (text + icon) is now tappable

**Nickname display audit — all remaining `player.name` display instances fixed:**
- `StatsView.jsx` — 8 lines: avatar initials (Player Form), LeaderRow `name` prop in Top Scorers, Clinical, Win Rate Leaders, Relegation Zone, Attendance, Bib Duty; InsightTile Most Consistent value
- `PlayerView.jsx` — 3 lines: teams tile avatar `ini` variable (2 uses: `p.name` → `p.nickname || p.name`), teams tile guest host label (`host.name` → `host.nickname || host.name`)
- `Avatar.jsx` (`src/components/ui/Avatar.jsx`) — 2 lines: initials circle (`player?.name` → `player?.nickname || player?.name`), name label below circle (same); fixes all IN/Reserve/Maybe/Out/No Response chips

**HistoryView score type display — corrected from session 12 partial implementation:**
- `SCORE_TYPE_PILL.margin` badge: color gold → amber, bg gold2 → amber2, border 1px goldb → 0.5px amberb
- `ScoreTypePill` fontSize: 9 → 10
- Collapsed **declared** display: replaced `ScoreTypePill type="declared"` with W/L/D Bebas Neue 22px spans; loser gets `var(--t2)` L; removed absolute-positioned draw badge
- Collapsed **margin** winner display: removed "Won by N" text; now `[WON BY amber pill] [N number]` only; margin draw shows D span (consistent)
- Expanded drill-down: added score display header before lineup grid — exact shows `scoreA — scoreB`, margin shows `[WON BY] N`, declared shows 36px W/L/D letter; below it, `lastGoalScorerPlayer` shows "⚽ Last: [nickname || name]" if set, nothing if null

**Key convention note (HistoryView):**
- `lastGoalScorerPlayer` is derived by `players.find(p => p.id === m.lastGoalScorer)` — silent null if player not found (e.g. guest or deleted player)
- Last goal scorer shown in two places: collapsed info row (Row 2) AND expanded score header — intentional, gives context before and during drill-down

**Session 15 (May 14 2026):**
Date field migration + BibsScreen rework + bib holder display fixes.

**ScoreScreen bibs gate:**
- `ScoreScreen.jsx`: Stage 4 (bibs picker) hidden when `schedule.bibsEnabled === false`
- `stage4Done` auto-completes immediately when `!bibsEnabled`; peek chain fixed to avoid double-scroll to s5

**Date field migration — `matches.date`/`date_short` → `match_date` (ISO date), `bib_history.date` → `match_date`:**
- `packages/core/engine/squad.js` `newMatch()`: removed `date`/`dateShort`, added `matchDate`
- `packages/core/storage/supabase.js`: `matchToDb`/`dbToMatch`/`saveMatchResult` use `match_date`; `getBibHistory`/`insertBib`/`saveBibHolder` use `match_date`; `getLastMatchMeta` sorts by `match_date`
- `packages/core/engine/payments.js` `generateMatchReport`: derives display date from `match.matchDate`
- `packages/core/engine/attendance.js` `topSingleGame`/`getHatTricks`: `m.dateShort` → `m.matchDate`
- `apps/inorout/src/views/StatsView.jsx`: removed `MONTHS`/`parseMatchDate`, sort uses `new Date(b.matchDate)`
- `apps/inorout/src/views/HistoryView.jsx`: removed `parseMatchDate`/`MONTHS_IDX`, all display/sort/share uses `m.matchDate` ISO string
- `apps/inorout/src/views/AdminView/index.jsx`: removed `parseMatchDate`/`MONTHS`, `pendingResults` and `cancelWeek()` use `matchDate`
- `apps/inorout/api/cron.js` `lineupLockJob`: stub match insert uses `match_date`
- `scripts/seed-demo.js`: removed `fmtLong`/`fmtShort`, all writes use `.toISOString().split('T')[0]`

**Bib holder display fix (HistoryView.jsx):**
- `resolveBibHolder(bibHolder, players)` used at match card display and WhatsApp share text
- `packages/core/index.js`: `resolveBibHolder` added to barrel export from `./storage/supabase.js`

**bib_history schema — `player_id` column added:**
- `saveBibHolder`: inserts `player_id: playerId` alongside `name`
- `getBibHistory`: returns `playerId: b.player_id` in mapped result
- New `getBibStats(teamId, squadPlayers)`: queries all bib_history rows, counts per player in discrete 3-month buckets (0–3M, 3–6M, 6–9M, 9–12M) + allTime; matches by `player_id` falling back to name string
- `getBibHistory`: reordered from `created_at DESC` → `match_date DESC`

**BibsScreen.jsx full rework:**
- Imports: `TShirt, CaretDown, CaretUp` Phosphor thin; CSS vars throughout (no `colors as C`)
- Sections: header (28px gold Bebas Neue + TShirt icon + entry count), current holder card (amber glow, name, date, days since), hidden dropdown (display:none — all old picker logic preserved), history (5 entries, "View N more" expand), bib stats accordion (collapsed by default, discrete bucket table)
- Stats computed from `bibHistory` + `squad` props; player_id → name fallback match
- History rows resolve nickname via squad lookup

**Key conventions:**
- `matches.match_date` is a Supabase `date` type — returns ISO string `"2026-05-14"`, sorts/compares correctly with `new Date()`
- `bib_history.match_date` same type; `bib_history.player_id` is a text player ID (nullable for legacy rows)
- `resolveBibHolder(value, players)` does `players.find(p => p.id === value)` → `nickname || name`; falls back to raw string for legacy name values

**Session 16 (May 15 2026):**
Payment ledger dedup hardening + PaymentsScreen/PlayerView UI fixes.

**Payment ledger dedup (4-fix pass):**
- `findMatchLedgerEntry` (supabase.js): added `console.error` on query failure — distinguishes RLS/network error from genuine empty result (was silently returning null on any failure, masking dedup)
- `handleResetPayment` (payments.js): removed `if (matchId)` gate from ledger update — always resets ledger to 'unpaid' using `findMatchLedgerEntry` with IS NULL handling; player_match still only cleared when matchId known
- `createLedgerEntry` (supabase.js): added `entry.upsert` option — uses partial-index-aware `onConflict` columns (null matchId: `player_id,team_id,type`; non-null: `player_id,team_id,type,match_id`) to match the two partial unique indexes
- `handleMarkPaid` (payments.js): added cross-path `existingNull` lookup — when real-matchId entry not found, checks for null-matchId entry and promotes it (updates match_id to real matchId via updateLedgerEntry) rather than creating a duplicate; upsert as final backstop
- `updateLedgerEntry` (supabase.js): added `matchId` to patch map — enables match_id promotion in the cross-path case

**Two partial unique indexes added to payment_ledger in Supabase:**
- `payment_ledger_uniq_with_match` ON (player_id, team_id, type, match_id) WHERE match_id IS NOT NULL
- `payment_ledger_uniq_without_match` ON (player_id, team_id, type) WHERE match_id IS NULL
(Standard UNIQUE won't work because NULL != NULL in PG)

**PaymentsScreen.jsx UI fixes:**
- Ledger refresh: after Mark Paid or Reset, now calls `getLedgerForPlayer(...).then(...)` inline rather than `setLedger(null)` — user sees updated history immediately without reopening
- Summary chips (OUTSTANDING / PLAYERS PAID): added `background: var(--red2/green2)`, `border: 0.5px solid var(--redb/greenb)`, `color: var(--t1)` — was near-invisible on dark bg
- "✓ This week" label in OWES MONEY section: when player has debt but paid this week, shows "✓ This week" instead of "✓ Paid" (checked via `owes > 0` inline)

**PlayerView.jsx fixes:**
- Removed StatusBadge pill block above 4-button grid (was duplicating locked/live state info)
- Removed 👊 locked-in confirmation row for IN players specifically — 🔒 row already covers it; maybe/reserve/out confirmation rows preserved

**Session 17 (May 15 2026):**
Payment confirmation UX + handleCashPayment hardening.

**handleCashPayment (payments.js) — find-then-update pattern:**
- Replaced upsert call with explicit `findMatchLedgerEntry` → `updateLedgerEntry` (if exists) / `createLedgerEntry` (if not) — same pattern as `handleMarkPaid`
- Entire function body wrapped in try/catch: `console.error('handleCashPayment error:', error)` + re-throw
- Debug `console.log` statements added: logs `existing` object + `playerId/teamId/matchId` after find; logs "updated ledger entry" or "created ledger entry" after each branch

**PlayerView.jsx — Confirm button error handling:**
- `const [payError, setPayError] = useState(null)` added
- All three "Confirm — You've Paid?" onClick handlers wrapped in try/catch: `setPayError(null)` on each tap, `setPayError("Something went wrong — try again")` on catch
- Error message shown inline below button in red 10px text; clears on next tap

**PlayerView.jsx — post-confirm payment state display:**
- New branch BEFORE `paymentState === 'debt'`: when `selfPaid === true && paid !== true && !cashPending` → pushes amber "Awaiting confirmation" span to btns (amber2 bg, amberb border, amber color, 12px DM Sans 400, minHeight 36)
- New second branch: when `paid === true` → pushes green "✓ Paid" span to btns (green2/greenb/green)
- Previously both states showed nothing in the button area (just "Nothing owed 👊" as amountText)

**AdminView/index.jsx — payment confirmation banner redesign:**
- `@keyframes ioo-gold-pulse` injected inline: box-shadow 0→16px→0 on var(--goldb), 2s ease-in-out infinite
- Outer div: gold2 bg, 0.5px goldb border, 3px solid gold left border, animated glow
- Header: Bebas Neue 15px gold — "💰 PAYMENT CONFIRMATIONS · {count}" (was 11px green uppercase "Payment Confirmations Needed")
- Per-row: `{nickname||name} · £{price} cash` + red `+ £{owes} debt` span when owes > 0; `"Host paid for {name}"` when paidBy==='host'
- Rows separated by `0.5px solid rgba(232,160,32,0.2)` divider
- Confirm button: Bebas Neue 13px, gold bg, "CONFIRM ✓" (was DM Sans 11px green)

**Session 18 (May 15 2026):**
Cancel Week system — full implementation (Stages 7A–7D) + PlayerView cancelled state + toggle intercept.

**Stage 7A — New supabase.js functions:**
- `bulkResetPlayerStatuses(teamId)` — two-step (team_players join → players update); resets status/paid/self_paid/paid_by/paid_at for all non-disabled players; returns `{ count }`
- `bulkCancelLedgerEntries(teamId, matchId, affectedPlayerIds, pricePerPlayer)` — per-player loop: issues `refund` ledger entry + clears player payment flags if `status='paid'`; same if `status='unpaid' && self_paid=true`; always writes `type:'cancelled'` audit row; returns `{ refunded, cancelled }`
- `deletePlayerMatchRows(matchId, teamId)` — DELETE from player_match by match+team; returns `{ count }`
- All three exported from `packages/core/index.js`
- **IMPORTANT:** `type:'cancelled'` and `status:'cancelled'` require Supabase CHECK constraint updates before `bulkCancelLedgerEntries` will work in production. SQL:
  ```sql
  ALTER TABLE payment_ledger DROP CONSTRAINT payment_ledger_type_check;
  ALTER TABLE payment_ledger ADD CONSTRAINT payment_ledger_type_check
    CHECK (type IN ('game_fee','guest_fee','debt_payment','waiver','refund','cancelled'));
  ALTER TABLE payment_ledger DROP CONSTRAINT payment_ledger_status_check;
  ALTER TABLE payment_ledger ADD CONSTRAINT payment_ledger_status_check
    CHECK (status IN ('paid','unpaid','waived','disputed','refunded','cancelled'));
  ```

**Stage 7B — Display label additions:**
- `PaymentsScreen.jsx` TYPE_LABEL: `cancelled: 'Cancelled'`; STATUS_STYLE: `cancelled: { bg:"var(--s3)", border:"0.5px solid var(--t2)", color:"var(--t2)" }`
- `PlayerView.jsx` TYPE_LABEL: `cancelled: 'Match cancelled'`; same STATUS_STYLE entry

**Stage 7C — cancelWeek() full async rewrite (AdminView/index.jsx):**
- 8-step async function replacing synchronous 11-line original
- Step 1: persist cancelled match to DB via `insertMatch` (uses `schedule.activeMatchId` or generates `cancel_${Date.now()}`)
- Step 2: `bulkCancelLedgerEntries` for all inPlayers
- Step 3: `bulkResetPlayerStatuses` — all players
- Step 4: `deletePlayerMatchRows` if lineup was locked (schedule.activeMatchId exists)
- Step 5: `upsertSchedule` with isCancelled=true, gameIsLive=false, lineupLocked=false, activeMatchId=null, votingOpen=false, autoOpenPending=true
- Step 6: push notification to in+maybe+reserve (not injured/disabled); body includes cancelReason if set
- Step 7: local state updates — setSquad (reset all), setMatchHistory (prepend stub), setSchedule
- Step 8: close modal
- `cancelLoading` state drives button disabled + "CANCELLING…" label
- New imports added to AdminView: `insertMatch`, `upsertSchedule`, `bulkCancelLedgerEntries`, `bulkResetPlayerStatuses`, `deletePlayerMatchRows`

**Stage 7D — Cancel Week modal redesign:**
- Replaced inline expand-below form with `position:fixed` overlay (`rgba(0,0,0,0.7)` + `blur(8px)`, zIndex:300)
- Card: `var(--s2)` bg, red border, 16px radius, maxWidth 380px
- Contents: Bebas Neue 28px red title "CANCEL THIS WEEK?", DM Sans 300 warning text, reason input with onFocus border, "CANCEL THIS WEEK" red pill (Bebas Neue 18px), "Keep it on" muted pill
- Both buttons disabled + `opacity:0.6` during `cancelLoading`
- Action row trigger changed from toggle (`setShowCancel(s => !s)`) to open-only (`setShowCancel(true)`)

**PlayerView.jsx — cancelled state rework:**
- Removed full-screen early return block (was blocking entire view when `isCancelled`)
- Added inline amber-red banner "❌ This week's match is cancelled" (red2 bg, redb border, centred, 8px radius) above status buttons
- Status buttons still render when cancelled but with `opacity:0.4, pointerEvents:'none'`
- Plus One tile, Injured tile, expanded Plus One form hidden when `isCancelled`

**AdminView/index.jsx — toggle intercept + loading:**
- `toggleGameLive` OFF path: no longer calls `setSchedule`; instead shows nudge + scrolls to Cancel Week tile
- `showCancelNudge` state: amber2 banner "To cancel this week's game, use Cancel Week ↓" (centred, no tappable link); auto-dismisses after 4s
- `pulseCancelTile` state: when nudge fires, Cancel Week tile gets `ioo-cancel-pulse` animation (red glow 0→20px→0, 0.8s × 3) + `border:0.5px solid var(--red)` for 3s
- `@keyframes ioo-cancel-pulse` injected via `<style>` tag above actions section
- `cancelWeekRef` (useRef) on the actions card container; scrollIntoView after 100ms delay on nudge show
- `openNextWeek` rewritten async: `gameOpenLoading` state; `await upsertSchedule(...)` before notifications; toggle card gets `opacity:0.6, pointerEvents:none` during load — prevents double-tap push

**Session 19 (May 15 2026):**
Full codebase audit + dead code sweep + critical cron bug fixes.

**Audit delivered (18-area, grouped by severity):**
- CRITICAL: `advanceGameDateJob` did not reset `is_cancelled` on advance (fixed this session)
- CRITICAL: `advanceGameDateJob` set `is_draft: true` every week (wrong semantics, fixed this session)
- CRITICAL: `payment_ledger` CHECK constraints block `bulkCancelLedgerEntries` (SQL still needed)
- MEDIUM: `players` realtime subscription has no `team_id` filter (fires cross-team, low impact at Stage 1)
- MEDIUM: `player_career` table — only `total_bib_count` ever written; 11 other fields permanently empty
- MEDIUM: `owes` double-increment — audited and found NOT a live bug; `draftNextWeek` is dead code
- LOW: Dead exports, console.logs, missing sw.js, getPaymentMode stub — all fixed this session

**Fixes shipped this session:**
- `cron.js advanceGameDateJob`: added `is_cancelled: false, cancel_reason: null`; removed `is_draft: true`
- `sw.js` and `index.html`: restored from HEAD (both had been deleted from working tree)
- Debug `console.log` removed: 4+2 from payments.js handleCashPayment/handleMarkPaid; 8-line block from ScoreScreen.jsx; 12 routing logs from App.jsx `getRoute()`; all `console.error` preserved
- Dead code removed: `draftNextWeek` function + `onDraftNext` prop + 4 now-unused imports from AdminView/index.jsx; `onDraftNext` from ScoreScreen prop destructuring; stale `src/views/index.jsx` deleted (294 lines, pre-session-6 file not imported anywhere)
- Dead exports removed from payments.js: `getUnpaidPlayers`, `getSelfPaidPending`, `generateMatchReport`, `getPaymentMode` (reads nonexistent `schedule.payment_mode`, always returned 'both'); PlayerView.jsx updated to inline `'both'` at both call sites

**STILL OPEN — fix before first match:**
1. Supabase CHECK constraint SQL — must run before `bulkCancelLedgerEntries` works in production:
   ```sql
   ALTER TABLE payment_ledger DROP CONSTRAINT payment_ledger_type_check;
   ALTER TABLE payment_ledger ADD CONSTRAINT payment_ledger_type_check
     CHECK (type IN ('game_fee','guest_fee','debt_payment','waiver','refund','cancelled'));
   ALTER TABLE payment_ledger DROP CONSTRAINT payment_ledger_status_check;
   ALTER TABLE payment_ledger ADD CONSTRAINT payment_ledger_status_check
     CHECK (status IN ('paid','unpaid','waived','disputed','refunded','cancelled'));
   ```

**Session 20 (May 16 2026):**
HistoryView glass chip sizing + Player League Table build + StatsView integration.

**HistoryView glass chip (from prior session context):**
- `.heroGlassStatTile`: width:80px, height:56px (removed auto/padding)
- `.heroGlassStatValue`: font-size:26px
- `.heroGlassStatLabel`: font-size:9px, margin-top:4px

**getPlayerLeagueTable (packages/core/storage/supabase.js):**
- Period filter: month=start of calendar month, season=Jan 1 current year, all=no cutoff
- 5-step query: matches → player_match → all-team-dates (reliability denom, skipped for 'all') → players → compute
- Ranking: points(W×3+D)→goals→winRate→potm→name; tied players share rank, next rank skips
- Reliability denominator: ALL team match dates since player.created_at, not period-filtered
- Goals only counted where score_type=null or 'exact' (same as getPlayerMatchStats)
- Guests and disabled players excluded
- Exported from packages/core/index.js

**PlayerLeagueTable.jsx (apps/inorout/src/views/PlayerLeagueTable.jsx) — new file:**
- Props: `{ teamId, squad = [], bibHistory = [] }`
- Period selector: pill tabs (This Month / Season / All Time), active=gold2+goldb+gold, default='all'
- Loading: 3 skeleton bars 44px, ioo-plt-pulse animation, staggered 0.15s delay
- Empty state: "Play a few more matches to unlock the player table." (catches errors too — no separate error state)
- Table: minWidth:580, overflowX:auto wrapper, sticky Player column (position:sticky, left:0)
- Columns: Rank | Player | P | W | D | L | Win% | Goals | POTM | Rely | Form
- Rank colors: gold #E8A020 (1), silver #A0A0A0 (2), bronze #CD7F32 (3); "New" label for unranked
- Avatar: 28px circle, 🤕 if injured; amber 8px dot bottom-right if current bib holder
- Form chips: 18px circles, W=green/D=amber/L=red
- Reliability color: ≥80=green, ≥60=amber, <60=red, null=t2
- UNRANKED section: Bebas Neue 10px label with count
- `currentBibHolder` derived from `bibHistory.find(b => !b.returned)?.playerId`

**StatsView.jsx integration:**
- `teamId` added to props; `useState` uncommented; `CaretRight` added to Phosphor import
- `PlayerLeagueTable` imported from `./PlayerLeagueTable.jsx`
- `<PlayerLeagueTable teamId={teamId} squad={squad} bibHistory={bibHistory} />` rendered as FIRST section after hero (before Player Form)
- Player Form section wrapped in accordion: `showPlayerForm` state (default false), CaretRight rotation toggle, collapsed by default
- App.jsx: `teamId={teamId}` added to StatsView render line

**Key gotchas from session 20:**
- No early return in PlayerLeagueTable — component always renders outer div regardless of teamId; `if (!teamId) return;` is inside useEffect callback only
- Error state not visually rendered — on fetch error, loading becomes false, tableData stays [], empty state renders
- team_players has no created_at column — reliability join date uses players.created_at instead
- @platform/supabase does not exist as a package — getPlayerLeagueTable must be imported from @platform/core
- **Bug found and fixed:** PlayerView.jsx stats tab was rendering `<StatsView>` WITHOUT `teamId` prop — so players accessing Stats via tab never passed teamId to PlayerLeagueTable. Fix: `teamId={teamId}` added to StatsView in PlayerView.jsx line 1269. PlayerView already receives teamId from App.jsx (line 659); the prop was simply not forwarded.

**Session 21 (May 16 2026):**
Team Selection feature — full 5-stage build + design polish.

**Stage 1 — SQL (manual execution in Supabase):**
- `matches.teams_draft jsonb` column added
- `payment_ledger` CHECK constraints updated to include `'cancelled'` type and status
- 3 performance indexes: `idx_player_match_team_attended`, `idx_player_match_team_player`, `idx_matches_team_date`

**Stage 2 — Data layer (packages/core/storage/supabase.js + packages/core/index.js):**
- `matchToDb`: added `teams_draft: m.teamsDraft ?? null`
- `dbToMatch`: added `teamsDraft: r.teams_draft ?? null`
- New `saveTeamsDraft(matchId, teamId, draft, changedBy)` — updates `teams_draft` on matches row
- New `confirmTeams(matchId, teamId, teamA, teamB, changedBy)` — sets `team_a`/`team_b`, clears `teams_draft`
- Both exported from `packages/core/index.js`

**Stage 3 — TeamsScreen.jsx full rebuild:**
- Props: `{ teamId, squad, schedule, matchHistory, onBack }`
- `matchId` = `schedule.activeMatchId || matchHistory[0].id`
- Player pool: `status=in && !injured && !disabled`, sorted alphabetically by nickname||name
- Fisher-Yates shuffle, odd player goes to Team A
- On mount: hydrates from `teamsDraft.a/.b` first, then `team_a/team_b` (sets `teamsConfirmed=true`)
- `handleConfirm`: saves to DB, fires `teamsConfirmed` push fire-and-forget to all IN players
- `handleClearConfirm`: clears assignments; calls `saveTeamsDraft(matchId, teamId, { a:[], b:[] })` only if draft was previously saved
- Pentagon badge: path `"M27 2L52 12V30C52 43.5 41 54.5 27 58C13 54.5 2 43.5 2 30V12L27 2Z"`, `style={{ fill: "var(--s3)" }}`
- Team colours: `#60A0FF` (A), `#FF6060` (B) — only hardcoded hex values allowed

**Stage 4 — notify.js + ScheduleScreen.jsx:**
- `notify.js`: `teamsConfirmed` cron handler added — checks `active_match_id`, verifies `team_a/team_b` populated, deduplicates via `alreadySent()`, notifies all `status=in && !injured && !disabled` players
- `ScheduleScreen.jsx`: 10 notification toggles added (gameLive, squadFull, spotOpened, gameCancelled, gameDay9am, oneHrBefore, debtReminder, bibs24hr, bibs45min, teamsConfirmed); quiet hours FROM/TO selects; all saved to `reminders_config` in schedule

**Stage 5 — AdminView/index.jsx wiring:**
- TeamsScreen render: added `teamId={teamId}` and `matchHistory={matchHistory}` props; removed stale `setSquad` prop

**Design polish (2 rounds):**
- Round 1: action buttons 40px/15px Bebas, `#5B21B6` random, `#16A34A` confirm, Clear Teams `#3B0A0A` + `#FF4040`, split A/B live card (72px), slim player rows, A/B buttons 44×28
- Round 2: split card redesigned (48px, horizontal layout, white count numbers `#F2F0EA`, moved below Clear Teams); all `fontWeight:300→400`; player name DM Sans 500 15px; A/B buttons 36×26 Bebas 15px; PLAYERS heading DM Sans 500 11px; Done button (full width, 48px, `var(--goldb)` border, calls `onBack()`)

**Icon fix:** `Dice5` (not in installed @phosphor-icons/react) → `Shuffle`

**Key gotchas from session 21:**
- CSS vars cannot be used in SVG `fill`/`stroke` attributes — must use `style={{ fill: "var(--x)" }}`
- Shuffle not Dice5 in installed version of @phosphor-icons/react
- `borderRadius: "6px 0 0 6px"` / `"0 6px 6px 0"` on halves for joined card edges; VS centre has no radius

**Session 22–23 (May 16 2026):**
Vice Captain + Manage Squad feature — full 8-stage build.

- Stage 1 SQL: `players.deputy` renamed to `is_vice_captain`; `role_scope` jsonb + `disable_reason` text columns added (dormant)
- Stage 2: `dbToPlayer`/`playerToDb` mappings updated; `addPlayerToTeam` + `addGuestPlayer` INSERT literals fixed; `newPlayer()` factory updated; `toggleViceCaptain` + `disablePlayer` functions added to core barrel
- Stage 3: `App.jsx` — VCs get 5-tab admin nav + AdminView access via `isViceCaptain` derived from `_me`; `me={_me}` passed to AdminView
- Stage 4: AdminView — `isViceCaptain` + `me` props threaded to SquadScreen
- Stage 5: `SquadScreen.jsx` full rebuild — new design system, persistent Supabase toggles (priority, VC, injured, disable), guest prompt on host injury, injury auto-out, error toasts, copy link per player, avatar taps open PlayerProfile, IN/OUT buttons built but hidden
- Stage 6: `HeroCard.jsx` — ADMINS section showing VCs (capped at 4, alphabetical, nickname priority); `squad` prop added to HeroCard in PlayerView
- Stage 7: `PlayerProfile` modal — ROLES section with VC gold toggle (optimistic + revert), guest/self/VC caller guards, delete disabled when `attended > 0` (directs to Disable instead), SquadScreen avatar taps open PlayerProfile via `onPlayerTap` callback
- Stage 8: Display text sweep (`deputy` → `isViceCaptain`/`is_vice_captain` in seeds.js, seed-demo.js, useOnboarding.js), demo reset updated (`is_vice_captain: false, nickname: null` added to baseline restore), WORKING PROCESS section added to CONTEXT.md

**Key gotchas:**
- `addPlayerToTeam` exists in `supabase.js` but is NOT exported from `@platform/core` barrel — accessed via `@platform/supabase` Vite alias
- `players.deputy` DB column still exists (not yet renamed in Supabase) — JS layer fully maps to `isViceCaptain`; all seed/onboarding JS now uses `is_vice_captain`
- Avatar component (`Avatar.jsx`) renders column with name below — not usable in horizontal card layout; circle styles copied directly into SquadScreen
- `me` prop in SquadScreen wired from `App.jsx _me` → AdminView → SquadScreen; VC self-toggle guard (`player.id === me?.id`) is live
- No admin name in data model — `settings` only has `groupName`; ADMINS block in HeroCard shows VCs only

**Stats rewrite (session 22):**
- League table quick fixes: default tab season, row highlight opacity increased, both Rank + Player columns sticky (solid opaque `STICKY_BG` for top 3 rows to prevent bleed-through), form chips reversed (oldest→newest L→R), border wrapper + period selector around table
- Stats rewrite: ALL player leaderboard sections (Top Scorers, Clinical, POTM, Win Rate, Relegation, Attendance, Bib Duty, Player Form, Most Consistent) now read from `player_match` via `getPlayerLeagueTable` instead of `players` flat columns; `getPlayerLeagueTable` extended with `bibCount`, `lateDropouts`, `totalGamesInPeriod`; `PlayerLeagueTable` refactored to pure presenter (no internal state/fetch); `StatsView` owns period state + data fetch; all insight tiles (Avg Goals, Thrillers, Team A vs B, Cancelled Rate) period-filtered via `matchHistory` date cutoff; dead code removed (`scoredInCount`, `getPlayerForm`, `getStreak`)
- Payment ledger fix: `createLedgerEntry` upsert branch replaced with resilient insert + `23505` conflict recovery — PostgREST cannot target partial unique indexes via `.upsert()`; `upsert: true` flag removed from `handleMarkPaid`
- Sticky column bleed-through fix: solid opaque `STICKY_BG` colours for ranked rows on sticky Rank + Player cells (`#2A2114` gold, `#1D1D1B` silver, `#261E15` bronze)
- Bug fix: `SquadScreen` `handleAddPlayer` now uses `addPlayerToTeam` (writes both `players` row and `team_players` link, generates token) instead of `upsertPlayer`; `addPlayerToTeam` extended with `options` parameter (`type`, `priority`, `isViceCaptain`); exported from core barrel; `newPlayer` import removed from SquadScreen entirely
- Bug fix: Returning players joining a new team via `/join/CODE` now skip NameStep entirely — Part A `useEffect` detects existing player via `findPlayerByEmail`, upserts `team_players` link (`onConflict: team_id,player_id`), sets `joinedPlayer` directly, JoinSuccess renders immediately; no cross-team name change risk; new players still see NameStep
- Bug fix: `addPlayerToTeam` now returns `dbToPlayer(row)` — callers receive a squad-ready JS object with real DB `id` and `token`

**Head to Head feature (session 22):**
- Backend: `getHeadToHead(meId, themId, teamId)` — Query 1: all matches (with `score_a`, `score_b`, `match_date`); Query 2: all attended `player_match` rows for both players; partitions into `togetherMatches` + `againstMatches` + non-shared solo rows; all stats computed in JS
- Section 1 — When You Play Together: games/W/D/L/winRate, combined goals per player, goal threat (avg total goals together vs apart), bib magnet count; zero-state when no together games
- Section 2 — When You Face Each Other: games/results/goals/current streak (sorted by match_date descending), insight callout; zero-state when never opposed
- Section 3 — You Make Them Better: win rate with vs without (both directions), POTM rivalry in shared games, chemistry verdict pill; hidden entirely when `totalSharedGames < 3`
- Section 4 — Overall Comparison: mirrored bar chart (green left, red right) for win rate / goals per game / POTM / reliability; data from `tableData` (no extra query); skipped silently if either player absent from current period
- Section 5 — Recent Shared Matches: horizontal scroll row of up to 5 cards; date, score, together/opposed emoji label, W/D/L result chip
- Verdicts: `better_together` / `nemesis` / `you_own_them` / `dead_even` / `early_days` (main); `good_luck_charm` / `bad_influence` / `no_effect` (chemistry)
- myId prop chain bug: `onGoStats` in AdminView NavBar calls `setView("player")` not `setView("stats")` — stats render through PlayerView's internal `<StatsView>`, not the top-level one; both must receive `myId`

**Key gotchas (session 22 stats rewrite):**
- `tableData` players use `playerId` (not `id`), `wins`/`draws`/`losses` (not `w`/`l`/`d`), `played` (not `attended`), `potm` (not `motm`), `form` as uppercase `["W","L","D"]` array
- `getPlayerLeagueTable` line 1701 early return was `return []` (bare array) — fixed to `return { players: [], totalGamesInPeriod: 0 }` to match destructuring in StatsView
- PostgREST upsert with partial unique indexes: fails with `42P10`; indexes exist in DB but PostgREST generates bare `ON CONFLICT (cols)` without the required `WHERE` predicate

**Session 23 (May 17 2026):**
H2H feature-complete rewrite + pre-launch onboarding/join hardening. 9 commits.

**Shared infrastructure (Part 1) — `packages/core/engine/scoring.js`:**
- `hasGoalData(scoreType)` — canonical filter; returns true for null/undefined/'exact', false for 'margin'/'declared'. Replaces inline pattern at supabase.js:943-944
- `resolveDominantType(matches, opts = { window: 20, threshold: 0.7 })` — pure function detecting dominant scoring style team-wide; cancelled-defensive; ISO date string sort
- `periodCutoff(period)` — returns 'YYYY-MM-DD' for 'month'/'season', null for 'all'/other. Extracted from getPlayerLeagueTable's Step 1
- Barrel-exported via packages/core/index.js's existing `export *` from `./engine/scoring.js`
- Filename note: scoring.js now hosts non-scoring helpers (periodCutoff). Tech debt — rename to broader name in Session 24 if file grows

**H2H Section 1 — adaptive tiles + score_type gating (Parts 2A + 2B):**
- Backend (getHeadToHead):
  - Query 1 select extended with `score_type` and `cancelled`
  - matchMap entries gain `scoreType`
  - `dominantType = resolveDominantType(matchData)` called after Query 1; exposed top-level in return
  - `combinedGoals`, `goalThreatTogether`, `goalThreatApart` all filtered through `exactTogetherMatches`/`exactMeOnlyMatchIds` (hasGoalData-gated). Both numerator AND denominator now use filtered sets
  - New `together.potmMe`/`together.potmThem` — POTM counts scoped to together-matches only (distinct from `chemistry.myPotm`/`theirPotm` which span all shared)
  - New `together.outcomeAvg` — average match outcome (signed score differential from me's team perspective) across scored together-matches. Always computed regardless of dominantType
  - New `together.gamesBothPlayed` = `gamesTogether + gamesAgainst`
  - New `together.goalThreatTogetherCount` / `goalThreatApartCount` — exposed sample sizes
- Frontend Section 1:
  - Tile 4 replaced: Combined goals → Together ratio (`{games} / {gamesBothPlayed}`, e.g. `1 / 20`)
  - Row 1 conditional on dominantType:
    - 'exact' → Goal threat with sample size — `3.0 together (2 games) vs 1.5 apart (4 games)`. Together number coloured green/red; rest muted
    - 'margin' → Match outcome — `+1.8 average` with Lightning icon; signed; coloured green/red/var(--t1)
    - 'declared' → row hidden entirely
  - Row 2 replaced: Bib magnet → Combined POTM — `3 (Hassan 2, Sarah 1)` with gold count + muted breakdown; zero state `0 — no POTMs together yet`
  - Pluralisation: `1 game` / `N games`

**H2H Section 2 — goals gating + streak softening:**
- Backend: `exactAgainstMatches` filter added; goal reductions over filtered set; new `against.goalsCount` exposed
- Frontend:
  - Goals scored row, three states: `goalsCount === 0` → muted `—`; `goalsCount < games` → values + `(in N tracked games)`; `goalsCount === games` → values without parenthetical
  - Current streak row: `length === 1` → `X won the last meeting`; `length >= 2` → `X has won N in a row`; null → `No active streak`
- The `insightText` IIFE in Section 2 (5 variants: dominates / owns / has the edge / dead even) — already locally computed and works correctly. NOT the main verdict. Left untouched

**H2H Section 3 — five-verdict chemistry system (Parts 3A + 3B):**
- Backend:
  - `chemistry.myEffectDelta = theirWinRateWithMe - theirWinRateWithoutMe` (positive = me boosts them)
  - `chemistry.themEffectDelta = myWinRateWithThem - myWinRateWithoutThem` (positive = them boosts me)
  - Both null when either operand is null
  - Chemistry verdict rewritten with sample floor (`gamesTogether >= 3 && meNonShared.length >= 3 && themNonShared.length >= 3`) and two-direction logic:
    - Floor fails → `'building'`
    - Both deltas >= +10 → `'good_luck_charm'`
    - Both deltas <= -10 → `'bad_influence'`
    - Signs differ AND |max| >= 10 → `'asymmetric'`
    - Otherwise → `'no_effect'`
- Frontend:
  - Two new delta rows: `{meName}'s effect on {themName}` → `fmtDelta(myEffectDelta)` and inverse. Lightning icon, sign-coloured value or `—` if null
  - CHEM_STYLE + CHEM_LABEL extended for 5 values: good_luck_charm (gold ⭐), bad_influence (red 👎), asymmetric (amber ↕), no_effect (muted ➖), building (muted 🌱)
  - Section 3 outer gate stays `totalSharedGames >= 3`. Building verdict can fire inside that gate when sample sub-conditions fail
- Two redundant-looking win-rate rows (audit confirmed: identical "with" values, different "without" baselines) preserved per UX call. Could collapse into delta block in Session 24 if visual feedback warrants

**H2H Section 4 — reliability + period selector (Parts 4A + 4B):**
- 4A: Reliability decoupled from period entirely
  - New Step 3b query in getPlayerLeagueTable: all-time attended player_match rows, grouped client-side into `playedAllTime[playerId]`
  - Reliability gate AND numerator both use `playedAllTime`. Denominator stays `totalTeamGames`
  - Period-filtered `played` still used for everything else (winRate, form, ranked)
  - Side effect: Stats league table reliability now shows for short periods where it previously showed `—`. Intended improvement
  - Frontend: `noBar` flag added to Reliability row. When either side's reliability is null, the inner coloured `<div>` is suppressed (outer var(--s3) track still renders for layout stability). Label still shows `—`
- 4B: Period selector now drives data
  - `getHeadToHead(meId, themId, teamId, period = 'all')` — new 4th param
  - Two matches queries: 1a all-time (drives dominantType, stays team-wide), 1b period-filtered (drives every stat)
  - `meRows` and `themRows` reassigned to filter by matchMap membership immediately after Query 2 — so all downstream computations inherit period scope without per-call gating
  - Frontend: new `initialPeriod` prop (StatsView passes its own `period` state); existing `period` useState wired to useEffect deps and as 4th arg to getHeadToHead. New `modalTableData` state with refetch on period change drives Section 4
  - Empty state copy made period-aware:
    - Section 1: 'all' → "You've never been teammates yet."; else → "You haven't been on the same team this {month/season}"
    - Section 2: same pattern with "opposite teams"

**Pre-launch onboarding/join hardening (Commit 9):**
Audit of /create + /join code revealed four issues. All fixed in one commit:
- `addPlayerToTeam` extended: row.user_id now reads `options.userId || null` instead of hardcoded null. App.jsx handleJoin call site updated to pass `{ userId: authUser.id }` as options object. Previously authUser.id was passed positionally as a string that ended up in options.type slot (falsy fallback) and user_id was null on the row — breaking findPlayerByUserId returning-player detection
- JoinSuccess.jsx joinUrl now `https://www.in-or-out.com/join/...` (was missing protocol). Matches every other URL construction in the codebase
- JoinTeam.jsx ioo_redirect_to write gated to iOS Safari non-standalone only. Matches App.jsx getRoute pattern. Previously fired on every platform, causing one-time forced redirects on Android/desktop
- useOnboarding.js submitPlayers: removed premature `onboarding_complete=true` write at step 2. ShareLinks.jsx handleGoAdmin is now the sole write site at step 3

**Demo data caveats encountered:**
- All 25 demo player rows have `created_at: 2026-05-13` — after every seed match date. `totalTeamGames = allTeamMatchDates.filter(d => new Date(d) >= joinDate)` returns 0 → reliability stays null in /demoadmin regardless of period. Production teams won't hit this
- Demo seed has no margin or declared score_type matches → dominantType always resolves to 'exact' in demo → can't see Match outcome row firing. Session 24 demo rebuild should mix score_types
- Every demo player attends nearly every match → no solo games → chemistry verdict always 'building' for every pair on demo. Production teams with realistic attendance will exercise the other 4 verdicts

**Working process improvements logged:**
- AUDIT → REVIEW → EXECUTE → REVIEW → VERIFY → REVIEW → COMMIT pattern works reliably for 5+-prompt chains
- Splitting larger features into A/B parts (backend then frontend) gives clean intermediate commits and easier revert points
- "Spec adjustments based on audit findings" review step caught real bugs before they shipped (meRows all-time bug in 4B, chemistry one-direction bug in 3A, addPlayerToTeam positional-string bug in audit)
- Long prompts truncate when pasted into Claude Code — shorter prompts paste reliably

**Supabase schema state at end of session 23 (verified live):**
- `matches.teams_draft` jsonb present ✓
- `payment_ledger` type CHECK includes 'cancelled' ✓
- `payment_ledger` status CHECK includes 'cancelled' ✓
- 3 performance indexes present: idx_player_match_team_attended, idx_player_match_team_player, idx_matches_team_date ✓
- `players.is_vice_captain`, `role_scope`, `disable_reason` present; `deputy` column NOT present (was renamed in DB, not just JS — earlier KNOWN BUGS entry stale) ✓

**Commits shipped (in order):**
1. `feat(scoring): add hasGoalData + resolveDominantType helpers` (Part 1)
2. `feat(h2h): gate goal stats by score_type, expose dominantType + together-scoped POTM` (Part 2A)
3. `feat(h2h): Section 1 UI consumes adaptive backend fields` (Part 2B)
4. `feat(h2h): gate Section 2 goals by score_type, soften trivial streaks`
5. `feat(h2h): two-direction chemistry deltas + 5-verdict system` (Part 3A — f2185dd)
6. `feat(h2h): Section 3B — asymmetric/building verdicts + delta rows in chemistry UI` (cc1e2b5)
7. `feat(h2h): reliability always all-time + null bar fix` (Part 4A)
8. `feat(h2h): wire up period selector — month/season/all-time filtering` (Part 4B)
9. `fix(join): pre-launch hardening for /create + /join` (4 fixes)
10. `fix(myio): guard InsightCard body renderer against non-React-element children` (d387c58) — affects any player with 8+ games; numbers passed as bare JSX fragment children threw TypeError on .props.children; fix extends primitive guard to include !child?.props
11. `fix(myio): guard InsightCard body renderer` — already noted as d387c58
12. `fix(demo): rename demo team to 5-a-Side FC` — 878898e

**Session 24 — RLS lockdown + full client rewrite (2026-05-18):**

**Goal:** Complete RLS migration across all 19 Supabase tables. Replace every direct client-side table write with SECURITY DEFINER RPC calls. No direct table access permitted from the client post-migration.

**RLS migration applied (migration 006):**
- Row Level Security enabled on all 19 tables
- All `SELECT` policies: `anon` + `authenticated` can read their own team's data via `team_id` membership check
- All `INSERT`/`UPDATE`/`DELETE`: blocked for `anon` and `authenticated` — SECURITY DEFINER RPCs are the sole write path
- `SECURITY DEFINER` functions run as table owner, bypass RLS; admin RPCs resolve `p_admin_token` → `team_id` via `teams.admin_token`

**GROUP 1 — Token write RPCs (migration 011, pre-session 24):**
All player-facing writes already rewired: `handleMarkPaid`, `handleResetPayment`, `handleWaiveDebt`, `setPlayerNickname`, `insertPlayerInjury`, `clearPlayerInjury`, `resetPlayerToken`, `deletePlayer`, `toggleViceCaptain`, `saveTeamsDraft`, `closePOTMVoting`, `addPlayerToTeam`

**GROUP 2 — Admin write RPCs (sessions 23–24):**
Rewired all 7 admin view files:
- `TeamsScreen.jsx`: `saveTeamsDraft(matchId, teamId, ...)` → `saveTeamsDraft(adminToken, matchId, [], [])`
- `ScheduleScreen.jsx`: `upsertSchedule` + `upsertSettings` both take `adminToken` as first arg; `adminToken` prop added
- `PaymentsScreen.jsx`: `handleMarkPaid`, `handleResetPayment`, `handleWaiveDebt` all drop `teamId`/`price`/`waiverAmount`; `adminToken` threaded through `PlayerRow`
- `AdminView/index.jsx`: `cancelWeek` collapsed from 7-step client sequence to single `adminCancelMatch(adminToken, reason)` call; `openNextWeek`, `handleClearInjury`, `markPaid`, `removeGuest`, cover-pool guest add all updated; `POTMTiebreakModal` + `PlayerProfile` sub-components take `adminToken` prop; `ScheduleScreen` + `PaymentsScreen` render sites pass `adminToken`
- Imports: removed `insertMatch`, `bulkCancelLedgerEntries`, `bulkResetPlayerStatuses`, `addGuestPlayer`; added `adminCancelMatch`, `addPlayerToTeam`

**GROUP 3 — Fold debt clearing into `set_player_paid` (migration 011 update):**
- `set_player_paid` RPC updated: before marking `self_paid`, reads `owes`; if > 0, inserts `debt_payment` ledger row and zeros `owes` — all in same transaction
- `PlayerView.jsx`: removed `handleClearDebt` call and import; `handleCashPayment(me.token)` unchanged

**Migration 022 — `link_player_to_user` RPC:**
- New authenticated-only RPC: derives user from `auth.uid()`, links player token → user_id
- Guards: null token, unauthenticated caller, duplicate user→player link
- `GRANT EXECUTE` to `authenticated` only (not `anon`)
- `supabase.js` `linkPlayerToUser(playerId, userId)` → `linkPlayerToUser(token)` — signature simplified
- `App.jsx` call site: `linkPlayerToUser(player.id, session.user.id)` → `linkPlayerToUser(route.token)`

**demoadmin route fix:**
- `/demoadmin` previously called `loadTeamData("team_demo")` — multi-query direct table reads, blocked by RLS post-migration-006
- Replaced with `getTeamStateByAdminToken("admin_demo")` — bulk-state RPC, bypasses RLS correctly
- `admin_demo` token seeded in `scripts/seed-demo.js:127`
- `onResetDemo` callback updated to use same pattern

**team_admins table:**
```sql
CREATE TABLE team_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
```
- RLS: `SELECT` open to `authenticated`; all writes via SECURITY DEFINER RPC only
- Populated at team creation (onboarding step 2, `submitTeam`) and via `admin_create_team` RPC
- `/create` auth gate added: unauthenticated users redirected to sign-in first (migration 021)

**audit_events table:**
```sql
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id text REFERENCES teams(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Commits shipped (in order):**
1. Continuation of session 23 FILE 4 TeamsScreen — `saveTeamsDraft` rewire
2. FILE 5 ScheduleScreen — `upsertSchedule` + `upsertSettings` rewire (3b9dd53)
3. FILE 6 PaymentsScreen — three write calls + PlayerRow `adminToken` (b9f0ac1)
4. FILE 7 AdminView/index — all remaining write sites, 7→1 cancelWeek (cbe5740)
5. GROUP 3 — `set_player_paid` debt clearing + PlayerView cleanup (b43202d)
6. Migration 022 + supabase.js + App.jsx `linkPlayerToUser` (cbd53eb)
7. App.jsx demoadmin route fix → `getTeamStateByAdminToken` (f691ffe)
8. docs: session 24 complete

**Supabase SQL still to run manually:**
- Migration 006: RLS enable on all tables (if not yet applied)
- Migration 011 update: updated `set_player_paid` with debt-clearing logic
- Migration 022: `link_player_to_user` RPC

**Remaining for Stage 2 beta (target: May 26):**
- Finbar's team creation + onboarding end-to-end test
- Android install screenshots
- WhatsApp comms to Finbar's admin
- `team_demo` `team_admins` backfill (low priority)

**Session 25 (May 19 2026):**
Full day of RLS post-migration fixes + live board hardening.
Root cause: session 24 RLS lockdown blocked all direct table
reads for anon sessions. Client code not updated to match.

Fixes shipped:
- getPlayerTeams() removed from player route — teamId now
  derived from RPC state directly
- get_team_state_by_player_token RPC extended: match_stats,
  win_rate, current_run, reliability, league_raw, ledger,
  outstanding_balance, last_match_meta (bib_holder from
  bib_history not match row), player_form (last 5, newest first)
- All three realtime callbacks (players, schedule, matches)
  rewritten to branch on route.type — player route uses
  getTeamStateByPlayerToken, admin/demoadmin uses
  getTeamStateByAdminToken, fallback uses direct reads
  (authenticated only)
- computeStatsFromHistory extended with lastMatchMeta +
  playerForm for admin routes
- lastMatchMeta fields explicitly camelCased in supabase.js
  (bib_holder → bibHolder, match_date → matchDate)
- Stats hero games count reads from stats.matchStats.attended
  not stale player.attended flat column
- Email capture suppressed for p_demotoken_* tokens
- League table period tabs re-enabled — computed client-side
  from matchHistory + squad; getPlayerLeagueTable import removed
- useIOIntelligence hook rewritten as pure consumer of
  pre-fetched stats (no DB calls)
- admin_save_teams RPC updated to write players.team = A/B/null
  on confirm/clear
- TeamsScreen hydration: confirmedThisSession ref guards squad
  sync effect; teamsConfirmedRef prevents stale closures; mount
  hydration filters legacy name strings via p_ prefix check
- handleClearConfirm now calls confirmTeams([],[]) to clear
  players.team server-side
- matchId fallback: finds upcoming match before falling back to
  most recent played
- p_confirm parameter name fix (was p_confirmed) in
  confirmTeams/saveTeamsDraft
- demoadmin route passes "admin_demo" token to all admin RPCs
- isFetchingPlayers ref prevents concurrent realtime RPC calls
- Form dots: last 5, oldest→newest left→right (.slice(0,5)
  .reverse())
- POTM trophy (🏆) and bibs dot (amber) working in teams tile
- POTM voting full RLS fix: submit_potm_vote +
  get_potm_voting_state SECURITY DEFINER RPCs added;
  submitPOTMVote + getPOTMVotingState in supabase.js now
  use RPCs instead of direct table reads; voterToken
  threaded from PlayerView through to POTMVotingModal;
  getPOTMVotingState replaces getPOTMEligiblePlayers +
  getPOTMVotes (both deprecated)
- potmTallyJob no-votes limbo fixed: tied_candidates now
  set to all attendees when no votes cast; admin tiebreak
  modal guard relaxed from > 1 to > 0
- potmResult notification now targets attendees only via
  tiedCandidates array (previously sent to all subscribers)
- Dead exports removed from supabase.js: openPOTMVoting,
  tallyPOTMVotes
- Dead import removed from AdminView: getPOTMEligiblePlayers
- formMap crash fixed: computeStatsFromHistory returns
  playerForm as array of {player_id, form} objects not
  plain object

Known remaining:
- BibsScreen standalone write broken under RLS (low priority)
- player_career table mostly empty (Phase 2)
- Multi-team player switcher: playerTeams disabled, needs player_get_teams RPC (Phase 2, tomorrow)
- is_vice_captain cross-team: lives on players table not team_players — per-team migration needed (Phase 2, tomorrow)
- Join/login redesign: needed before broader beta Jun 9 (Phase 2, tomorrow)
- owes double-increment: draftNextWeek dead code risk, remove or guard (Phase 2, tomorrow)
- Mid-game team switches: new ScoreScreen stage, team_switches jsonb on matches, final team determines W/L/D, switch icon in match history (Phase 2, tomorrow)

**Session 26 (May 20 2026):**
Multi-team player switcher built + is_vice_captain migrated to team_players + carryForwardDebts removed.

**Priority D — Codebase hygiene:**
- `carryForwardDebts` removed from `packages/core/engine/payments.js` — was orphaned dead code; `draftNextWeek` had already been removed session 19
- Guard comment added above `updatePlayerRecords` in `packages/core/engine/attendance.js`: sole owes-increment path — do not add a second call site without guarding against double-increment

**Priority A — Multi-team player switcher:**
- `player_get_teams` SECURITY DEFINER RPC added (authenticated role only; anon revoked); returns all squads for `auth.uid()` with team_name, player_name, player_nickname, token, disabled, is_vice_captain
- `getPlayerTeams()` in `supabase.js` rewritten to `supabase.rpc("player_get_teams")` — no parameters (uses auth.uid() server-side); was previously a broken direct table read
- `MySquads.jsx` new component: accordion (collapsed by default); three row types — CURRENT (gold bg, pointerEvents:none, "CURRENT" chip), DISABLED (opacity 0.4, "NO LONGER ACTIVE" chip, pointerEvents:none), ACTIVE OTHER (tappable, hover state, navigates to `/p/${token}`, shows "ADMIN" chip if is_vice_captain); loading skeleton (44px bar); empty state ("Not part of any other squads yet"); unauthenticated state ("Sign in to see all your squads"); uses snake_case `squad.is_vice_captain` directly from RPC response
- Wired into `PlayerView.jsx` my-view tab below payment history section; `<MySquads currentTeamId={teamId} currentToken={...} userId={me?.userId || null} />`
- `getPlayerTeams` added to `packages/core/index.js` barrel export (was causing build error)

**Priority B — is_vice_captain migrated from players to team_players:**
- Migration 026: `ALTER TABLE team_players ADD COLUMN is_vice_captain bool NOT NULL DEFAULT false`; data backfilled from `players.is_vice_captain`; `players_public` view dropped and recreated with team_players JOIN; `players.is_vice_captain` column dropped
- `players_public` view (migration 005) updated to `LEFT JOIN team_players tp ON tp.player_id = p.id` and `COALESCE(tp.is_vice_captain, false) AS is_vice_captain`
- `admin_set_vice_captain` (migration 012): writes `team_players.is_vice_captain`; return SELECT JOINs `team_players tp ON tp.player_id = p.id AND tp.team_id = v_team_id`; already updated session 26
- `get_team_state_by_player_token` (migration 010): `v_is_vc boolean` added to DECLARE; after step 2 (team_id derivation), fetches `is_vice_captain` from team_players and merges into `v_player` via `||`; `p.is_vice_captain` removed from step 1 self-row build; squad query switches `p.is_vice_captain` → `tp.is_vice_captain`
- `get_team_state_by_admin_token` (migration 010): squad query switches `p.is_vice_captain` → `tp.is_vice_captain` (tp already in scope via JOIN)
- `get_player_by_token` (migration 010): `is_vice_captain` removed from return (function has no team context)
- All 12 remaining `p.is_vice_captain` SELECT references across migrations 011 (5 functions) and 012 (7 functions) removed — those response SELECTs have no team_players join in scope, so field dropped from response entirely
- `supabase.js`: `playerToDb()` and `resetDemoData()` no longer write `is_vice_captain` (column moved to team_players); `dbToPlayer()` read mapping unchanged (reads `r.is_vice_captain ?? false` from RPC responses that still return tp.is_vice_captain)

Commits: 0947af1 (carryForwardDebts), 1833a1e (guard comment), 2e00f6f (getPlayerTeams RPC), 86b79b0 (MySquads.jsx), 1d1d531 (PlayerView wiring), f317bb3 (barrel export), f175fa4 (migrations 026/010/012/005), d2e769c (010 cleanup), 770f6ca (011/012 cleanup)

Bug fixes post-Priority E:
- `get_team_state_by_admin_token` RPC: `team_switches` added to matches `jsonb_build_object` in migration 010 — was missing, caused ⇄ icon not showing in HistoryView
- HistoryView `findPlayer`: now tries name match first, then falls back to ID match — handles both legacy name-keyed and new ID-keyed `team_a`/`team_b` arrays
- HistoryView guest label: resolves `guestOf` ID to player name via `findPlayer` instead of rendering raw ID string
- Local migration file 010 updated: `team_switches` added to `get_team_state_by_admin_token` matches block

Commits: 0d30124 (team_switches in admin RPC), 2a32699 (findPlayer fallback), 4ebc054 (guest label)

**Session 27 (May 20 2026):**
Fix: `addPlayerToTeam` join flow bug — join flow was calling `addPlayerToTeam(name, teamId, { userId })` which maps to `(adminToken, name, type, priority)` — wrong in every position and no admin token available in join context. Replaced with dedicated `playerJoinTeam` SECURITY DEFINER RPC: `player_join_team` SQL written, JS wrapper added to `supabase.js`, barrel-exported from `packages/core/index.js`, call site in `App.jsx` corrected.

Commits: 97e8c79 (playerJoinTeam RPC wrapper + barrel export), 0d419f6 (App.jsx call site fix)

- Join/login redesign complete — JoinTeam.jsx full rebuild, 5-stage build, RLS compliant, direct team_players upsert removed from App.jsx Part A, player_join_team RPC handles all join writes
- Commits: 8fe55c2, c101d3e, 98d4336, 17d8038, 7d71c39, 5cdfda2
- Stage A: price_per_player fixed — column altered to numeric(10,2), create_team RPC p_price updated to match
- Commits: 5e3c01c, 651f61c
- Stage B: AddPlayers removed from onboarding — players now join via squad link only; useOnboarding.js simplified, AddPlayers.jsx deleted, index.jsx step progression updated
- Commits: 28cf7c4
- Stage C: ShareLinks.jsx cleaned — dead direct table write removed, unused onComplete prop removed, supabase import removed
- Commit: ac46497
