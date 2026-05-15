# IN OR OUT — Master Project Context
*Last updated: May 15 2026 (session 19)*
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
          ui/                ← reusable components
        views/
          PlayerView.jsx     ← rebuilt session 6; startTab prop added session 12
          MyIOView.jsx       ← built session 8, IO Intelligence screen; TacticsBoardHero sticky (session 12)
          StatsView.jsx      ← rebuilt session 6, IO Statbook; local SVG hero + sticky (session 12)
          HistoryView.jsx    ← rebuilt session 6, Results screen; score_type + last_goal_scorer display corrected (session 14)
          Gaffer/
            index.jsx        ← Ask the Gaffer chatbot (disabled via ENABLE_GAFFER=false in App.jsx)
            systemPrompt.js  ← 820-word system prompt
          POTMVotingModal.jsx   ← built session 10
          AdminView/
            index.jsx        ← rebuilt session 6; POTM tiebreak modal (session 10); sticky hero + My IO nav (session 12)
            TeamsScreen.jsx
            ScoreScreen.jsx  ← rebuilt session 11, 6-stage progressive flow, score_type + last_goal_scorer
            BibsScreen.jsx
            SquadScreen.jsx
            ScheduleScreen.jsx  ← rebuilt session 13: MATCH SETTINGS, pickers, computed next matchday, bibs, Nominatim, opens helper, upsert save
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
id, team_id, match_date (date), score_a, score_b,
scorers (jsonb), motm, bib_holder,
team_a (jsonb array), team_b (jsonb array),
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
```

### schedule
```
id, team_id, day_of_week, kickoff, venue, city,
opens_day, opens_time, priority_lead_mins,
price_per_player, game_is_live, squad_size,
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

### RPC functions
`find_player_by_email(lookup_email text)` — SECURITY DEFINER, joins auth.users → players → team_players → teams

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
- Make Teams tile → TeamsScreen
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
- submitPOTMVote(matchId, teamId, voterId, nomineeId) → {ok} or {error:"already_voted"} on UNIQUE violation
- getPOTMVotes(matchId) → [{voter_id, nominee_id}]
- getPOTMEligiblePlayers(matchId, teamId) → [{id, name, team}] — two-query pattern (player_match then players)
- tallyPOTMVotes(matchId, teamId) → {winner, voteCount, totalVoters, isTie, tiedCandidates}
- closePOTMVoting(matchId, winnerId, wasAdminDecided) — updates matches + player_match
- openPOTMVoting(matchId, teamId, closesAt, totalVoters) — updates matches
- NOTE: PostgREST self-join workaround — getMostPlayedWith/getNemesis/getBestPartnership/getPlayerImpact/getPOTMEligiblePlayers all use two sequential queries + JS computation

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
- `carryForwardDebts(players, pricePerPlayer)` — pure fn; adds pricePerPlayer to owes for unpaid in-players, resets paid/selfPaid/status/team
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

### owes recalculation — two independent paths
1. `draftNextWeek()` in AdminView → `carryForwardDebts()` → `upsertPlayers()` — advances week, adds price to unpaid in-players
2. `updatePlayerRecords()` in ScoreScreen save — adds price to unpaid in-players at result entry time
Both can run; both add to `owes`. No deduplication.

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
- streakNotification (3/5/10 games)
- monthlySummary (end of month)

### Manual triggers (admin)
- Chase no-responses
- Cancel week
- Announce to squad (recipient picker)
- Game is live toggle

### Config
- Quiet hours — admin configurable per team
- 9+ per-trigger toggles in ScheduleScreen Notifications tab
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
| Admin screens redesign | 🔲 Next | TeamsScreen, BibsScreen etc — ScheduleScreen ✅ session 13 |
| Payments admin screen | ✅ Done | PaymentsScreen.jsx — 4-section layout, ledger dedup, inline Reset/Mark Paid |
| Onboarding redesign | ✅ Done | CreateTeam, AddPlayers, ShareLinks rebuilt session 13 |
| JoinSuccess install screen | ✅ Done | Platform-detected, placeholder screenshot slots |
| Join/login redesign | 🔲 Pre-launch | |
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
- Returning player joining a second team: REUSES the existing players row — new team_players entry only, no new players record created
- Flat stat columns (goals, motm, bib_count, w, l, d, attended etc.) are cross-team totals on one row, not per-team — player_match rows support per-team breakdowns but denormalised columns don't
- **Known bug**: NameStep asks returning player "what should we call you?" but the typed name is silently discarded — handleJoin uses existing.name from DB, ignores the input

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

**Next session (Session 20) — start with:**
1. Run Supabase CHECK constraint SQL (above) to enable Cancel Week ledger writes
2. Test Cancel Week flow end-to-end (demo team or Finbar's)
3. Test /join/team_finbars flow end-to-end on iPhone (clean device)
   — capture iOS install screenshots while testing, drop into PlaceholderScreenshot slots
4. Google DNS TXT record via 123-reg — fixes OAuth branding showing Supabase URL
5. Tuesday-night standby kit (Posthog + Supabase dashboards open, error log reviewed)
7. WhatsApp comms to Finbar's Tuesdays admin with welcome + expectations
8. Stage 1 ship blockers review — is May 19 still on track?

**Aspirational for May 19 matchday (Stage 1 live):**
- POTM voting live for Finbar's Tuesdays first match
- Re-enable Gaffer for admin role (ENABLE_GAFFER = true + remove token gate)
