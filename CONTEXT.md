# IN OR OUT — Master Project Context
*Last updated: May 13 2026 (session 9)*
*Always paste this at the start of a new session, or keep in Claude Projects*

---

## WHAT THIS IS

In or Out is a mobile-first web app for organising casual weekly football games. Live at **in-or-out.com**. Built as a React/Vite monorepo, deployed via Vercel, backed by Supabase.

Target market: casual 5-a-side and 7-a-side football teams in the UK.
Competitor: Spond (broad, all sports), Capo (early stage UK).
Differentiator: football-specific, frictionless, random player pool, in-app payments, IO Intelligence stats system.

---

## STAGE 1 BETA — LIVE TUESDAY MAY 19 2026

**First real team: Finbar's Tuesdays.** Tarny creates the team, admin liaises with players, players self-serve via /join/team_finbars.

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

**Out of Stage 1:** POTM voting, admin screens redesign, onboarding redesign, Stripe Connect.

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
| Supabase publishable key | sb_publishable_tG3ErIB1e19YIJsraHMrPA_0xIozTN- |
| Domain | in-or-out.com (123-reg, DNS → Vercel) |
| Posthog | phc_nKE8bJkj8skLdsxpierEVHgDyGGwaiwbwXoR7F7gLBc7 (EU region) |
| Google OAuth Client ID | GOOGLE_CLIENT_ID_HERE |
| Google OAuth Secret | GOOGLE_CLIENT_SECRET_HERE |

**TODO — SECURITY:**
- Rotate Supabase anon key (keys visible in conversation history) ⚠️ OVERDUE
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
          ui/                ← reusable components
        views/
          PlayerView.jsx     ← rebuilt session 6, new design system
          MyIOView.jsx       ← built session 8, IO Intelligence screen
          StatsView.jsx      ← rebuilt session 6, IO Statbook
          HistoryView.jsx    ← rebuilt session 6, Results screen
          Gaffer/
            index.jsx        ← Ask the Gaffer chatbot
            systemPrompt.js  ← 820-word system prompt
          AdminView/
            index.jsx        ← rebuilt session 6
            TeamsScreen.jsx
            ScoreScreen.jsx  ← writes player_match on save
            BibsScreen.jsx
            SquadScreen.jsx
            ScheduleScreen.jsx
          InstallBanner.jsx
          PWAWelcome.jsx
          JoinTeam.jsx
          JoinSuccess.jsx       ← rebuilt session 8, PWA install screen (platform-detected)
          AuthCallback.jsx
          Legal.jsx
          IsThisYou.jsx
        hooks/
          useIOIntelligence.js ← IO Intelligence data hook, unlock thresholds
      onboarding/
        index.jsx
        config.js
        hooks/useOnboarding.js
        steps/CreateTeam.jsx
        steps/AddPlayers.jsx
        steps/ShareLinks.jsx
      public/
        manifest.json          ← 4 icon sizes, theme_color #0A0A08
        sw.js
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
id, name, admin_token, join_code, onboarding_complete, created_at
```

### players
```
id, name, token, user_id (uuid → auth.users),
type, disabled, priority, deputy,
status (none/in/out/maybe/reserve),
paid, owes, goals, motm, attended, total,
bib_count, team, w, l, d,
pay_count, late_dropouts, note, self_paid,
paid_by (self/host/admin/stripe),
is_guest, guest_of,
injured, injured_since,
nickname,
created_at
```

### team_players
```
team_id, player_id
```

### matches
```
id, team_id, date, score_a, score_b,
scorers (jsonb), motm, bib_holder, result,
team_a (jsonb array), team_b (jsonb array),
winner, cancelled, cancel_reason,
venue, kickoff_time,
created_at
```

### bib_history
```
id, team_id, name, returned, date
```

### schedule
```
id, team_id, day_of_week, kickoff, venue, city,
opens_day, opens_time, priority_lead_mins,
price_per_player, game_is_live, squad_size,
game_date_time, is_draft, is_cancelled, cancel_reason,
reminders_config (jsonb)
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

### demo_sessions
```
id text PK default 'main',
last_reset timestamptz,
last_interaction timestamptz
```

### RPC functions
`find_player_by_email(lookup_email text)` — SECURITY DEFINER, joins auth.users → players → team_players → teams

**Realtime enabled on:** players, schedule, matches

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
- NavBar accepts isAdmin prop — renders 4 or 5 tabs

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
- Make Teams tile → TeamsScreen
- Input Result tile → ScoreScreen (writes player_match on save)
- Squad tile → SquadScreen
- Schedule tile → ScheduleScreen
- Notifications tile → reminders config
- Bibs tile → BibsScreen
- Cover Pool accordion
- Drag to reorder reserve list

### Platform
- Multi-tenant — all queries filtered by team_id
- Realtime — players, schedule, matches
- player_match writes on every result save
- Demo environment — team_demo, 25 players, 22 matches, /demoadmin, auto-reset
- Design system — tokens.css, Phosphor icons thin, mockup reference files

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

### MyIOView.jsx structure (built session 8)
- IO brand header — sticky top:0 zIndex:20 background:var(--bg)
- TacticsBoardHero — tactics board SVG pitch, YOUR GAME/YOUR STORY heading (40px Bebas Neue italic), attendance ring with glass tile
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
- NOTE: PostgREST self-join workaround — getMostPlayedWith/getNemesis/getBestPartnership/getPlayerImpact use two sequential queries + JS computation

### Hero card — attendance ring
- SVG 56×56, viewBox "0 0 38 38", R=16, progress ring stroke #3DDC6A strokeWidth 3
- Glass tile wrapper: rgba(255,255,255,0.07), blur(12px), 0.5px border rgba(255,255,255,0.18), borderRadius 14px, padding 10px, minWidth/minHeight 80px
- Ring text (HTML spans, not SVG): number 16px/600/#fff, "/X" 9px/#fff, "games" 7px/rgba(255,255,255,0.6)

### Edge cases
- 0 games: "YOUR IO JOURNEY STARTS HERE" empty state
- Guest player: "Join the squad properly to unlock IO Intelligence"
- POTM zero state: "yet to win one" (not "0% of wins")
- position:sticky breaks with transform on parent — hero uses sticky only on brand header (not inside io-section which has transform)
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

### payments.js functions
- getPaymentState(player, schedule, cashPending)
- getGuestPaymentState(guest, guestCashPending)
- getPaymentMode(schedule)
- handleCashPayment(playerId, teamId, paidBy='self')
- handleGuestCashPayment(guestId, teamId, paidBy='host')
- handleMarkPaid(playerId, teamId)
- handleResetPayment(playerId, teamId)
- handleStripePayment(playerId, teamId, amount) — stub

### paid_by values
self | host | admin | stripe | null

---

## NOTIFICATION SYSTEM

### Auto triggers
- gameDay9am, oneHrBefore, debtReminder
- bibs24hr, bibs45min, squadFull, spotOpened
- gameLive, gameCancelled, scheduleChange
- streakNotification (3/5/10 games)
- monthlySummary (end of month)

### Manual triggers (admin)
- Chase no-responses
- Cancel week
- Announce to squad (recipient picker)
- Game is live toggle

### Config
- Quiet hours — admin configurable per team
- 9+ per-trigger toggles in ScheduleScreen Reminders tab
- push_subscriptions + notification_log tables

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
| Rotate Supabase keys | ⚠️ OVERDUE | Do immediately |
| PlayerView redesign | ✅ Done | |
| StatsView rebuild | ✅ Done | IO Statbook |
| HistoryView rebuild | ✅ Done | Results screen |
| AdminView rebuild | ✅ Done | |
| player_match + player_career tables | ✅ Done | |
| player_injuries table | ✅ Done | |
| Teams confirmed view | ✅ Done | |
| Demo environment | ✅ Done | team_demo |
| POTM + Results display text | ✅ Done | |
| My IO screen | ✅ Done | MyIOView.jsx, useIOIntelligence.js |
| Admin screens redesign | 🔲 Next | TeamsScreen etc |
| Onboarding redesign | 🔲 Pre-launch | |
| JoinSuccess install screen | ✅ Done | Platform-detected, placeholder screenshot slots |
| Join/login redesign | 🔲 Pre-launch | |
| Stripe Connect | 🔒 Blocked | Needs platform account |
| Apple Sign In | 🔒 Blocked | Needs Dev account £79 |
| Undo last action | 🔲 Backlog | |
| Super admin dashboard | 🔲 Backlog | Read-only, Tarny only |

---

## PHASE 2 — WEEKS 2-4

| Feature | Notes |
|---|---|
| IO Wrapped | End of season shareable card |
| POTM voting | Post-game push, 60min window, car park voting |
| Monthly summary notifications | End of month push |
| Streak notifications | 3/5/10 game streaks |
| Random player signup | Postcode, availability |
| Admin find a random | Radius search, ping system |
| Deputy admin access | Proper permissions |
| Player profile cross-team | Career stats, player_career table |

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

**Next session (Session 10) — start with:**
1. Test /join/team_finbars flow end-to-end on iPhone (clean device)
   — capture iOS install screenshots while testing, drop into PlaceholderScreenshot slots
2. Rotate Supabase publishable key — security, OVERDUE
3. Google DNS TXT record via 123-reg — fixes OAuth branding
4. Tuesday-night standby kit set up (Posthog + Supabase dashboards)
5. WhatsApp comms to Finbar's Tuesdays admin

**Aspirational for May 19 matchday (Stage 1 live):**
- Ask the Gaffer open to admin role
