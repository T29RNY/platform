# IN OR OUT — Master Project Context
*Last updated: May 11 2026 (session 5)*
*Always paste this at the start of a new session, or keep in Claude Projects*

---

## WHAT THIS IS

In or Out is a mobile-first web app for organising casual weekly football games. Live at **in-or-out.com**. Built as a React/Vite monorepo, deployed via Vercel, backed by Supabase.

Target market: casual 5-a-side and 7-a-side football teams in the UK.
Competitor: Spond (broad, all sports), Capo (early stage UK).
Differentiator: football-specific, frictionless, random player pool, in-app payments.

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
- Rotate Supabase anon key (keys visible in conversation history)
- Google DNS verification via 123-reg TXT record (fixes OAuth branding showing Supabase URL)

---

## MONOREPO STRUCTURE

```
platform/
  apps/
    inorout/
      src/
        App.jsx              ← routing, data loading, realtime, auth
        seeds.js             ← demo data (legacy, being phased out)
        views/
          Header.jsx
          PlayerView.jsx
          StatsView.jsx
          HistoryView.jsx
          InstallBanner.jsx  ← fixed bottom banner + iOS 4-screen tutorial modal
          PWAWelcome.jsx     ← standalone PWA welcome (email lookup + paste link)
          JoinTeam.jsx       ← auth-first join flow
          JoinSuccess.jsx
          AuthCallback.jsx   ← handles OAuth redirect
          Legal.jsx          ← T&Cs and Privacy Policy at /legal
          IsThisYou.jsx      ← legacy player linking
          AdminView/
            index.jsx        ← main admin, CoverPoolSection
            TeamsScreen.jsx
            ScoreScreen.jsx
            BibsScreen.jsx
            SquadScreen.jsx  ← invite link banner
            ScheduleScreen.jsx
      onboarding/
        index.jsx
        config.js
        hooks/useOnboarding.js
        steps/CreateTeam.jsx  ← includes City field
        steps/AddPlayers.jsx
        steps/ShareLinks.jsx
      public/
        manifest.json
        sw.js
        icons/icon-192.png
        icons/icon-512.png
      vercel.json
      index.html             ← Posthog snippet + Google verification meta tag
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
created_at
```

### team_players
```
team_id, player_id
```

### matches
```
id, team_id, date, score_a, score_b,
scorers, motm, bib_holder, result, created_at
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
game_date_time, is_draft, is_cancelled, cancel_reason
```

### settings
```
id, team_id, group_name
```

### cover_pool
```
id, team_id, name, played, owes, created_at
```

### push_subscriptions *(new — add to Supabase)*
```
id text PK, player_id text, player_token text, team_id text,
subscription jsonb, created_at timestamptz default now()
UNIQUE on player_id
```

### notification_log *(new — add to Supabase)*
```
id text PK, team_id text, player_id text, type text, game_date text,
sent_at timestamptz, queued_for timestamptz, queued_payload jsonb,
created_at timestamptz default now()
```

### schedule (updated)
`reminders_config jsonb` column added — stores quiet hours + per-trigger toggles.

### RPC functions
`find_player_by_email(lookup_email text)` — SECURITY DEFINER, joins auth.users → players → team_players → teams. Returns `(token, player_id, player_name, team_id, team_name)` rows. Called from PWAWelcome email lookup. SQL must be run manually in Supabase SQL Editor.

**Realtime enabled on:** players, schedule, matches

---

## URL ROUTING

| URL | What it renders |
|---|---|
| / | Landing page (new visitors) OR PWA welcome screen (standalone + no ioo_last_visited) OR redirect to ioo_last_visited |
| /create | 3-step onboarding flow |
| /p/TOKEN | Player view (no auth required) |
| /admin/TOKEN | Admin view (validated against teams table) |
| /join/CODE_OR_TEAM_ID | Player self-registration (auth-first) |
| /auth/callback | OAuth redirect handler |
| /legal | Terms of Service (tab) + Privacy Policy (tab) |
| /legal#privacy | Privacy Policy direct link |

---

## AUTH SYSTEM

- Google OAuth — production, verified
- Email magic link — enabled
- Supabase Auth configured at ktvpzpnqbwhooiaqrigm.supabase.co
- Redirect URLs: https://in-or-out.com/auth/callback, localhost variants
- Manual linking: ENABLED in Supabase Auth settings
- Confirm email: DISABLED

### Auth Join Flow (confirmed correct):
1. Player taps /join/team_finbars
2. App loads session + team in parallel
3. If session exists → findPlayerByUserId → if found, show JoinSuccess directly
4. If session exists but no player → show name entry step
5. If no session → show Google/Email sign in buttons
6. After sign in → OAuth redirect → /auth/callback → restore returnTo → redirect back
7. Player enters name → addPlayerToTeam(name, teamId, userId) → JoinSuccess

### Token links: unchanged — players can use /p/TOKEN without signing in

---

## KEY TOKENS — FINBAR'S TUESDAYS (demo/test team)

| Item | Value |
|---|---|
| Team ID | team_finbars |
| Join code | a26cbcf2 |
| Admin URL | in-or-out.com/admin/admin_101d9ac950278f76 |
| Join URL | in-or-out.com/join/team_finbars |
| Tarny player ID | p_onxumqi1 |
| Tarny token | p_95go8k6cfwo |
| Tarny user_id | f95ad4a8-9b36-4b73-b909-8d2e10c9354b |
| Tarny URL | in-or-out.com/p/p_95go8k6cfwo |

---

## VITE ALIASES

```js
"@platform/core":     ../../packages/core/index.js
"@platform/ui":       ../../packages/ui/index.jsx
"@platform/supabase": ../../packages/core/storage/supabase.js
```

---

## FEATURES COMPLETED ✅

- Multi-tenant platform — all queries filtered by team_id
- Player routing via unique token URLs
- Admin secret URL (validated against DB)
- Real-time updates (Supabase channels — players, schedule, matches)
- Self-service onboarding (3 steps) with city field
- Player self-registration via invite link (auth-first)
- Google Sign In + Email magic link auth
- Auth callback handling
- Returning user recognition (skip name/sign-in if already linked)
- Multi-team game switcher (full-screen card UI)
- Switch game button in header
- Cover pool per team (Supabase backed, add/remove from admin)
- Mark All Paid button
- Clear Debt button per player
- Outstanding Debts section
- PWA (manifest, service worker, icons, install banner)
- Web push notifications — VAPID, push_subscriptions table, notification_log table, api/notify.js (direct + pg_cron modes), quiet hours queuing, 6 cron trigger types (gameDay9am, oneHrBefore, debtReminder, bibs24hr, bibs45min, flushQueue)
- Notification subscription prompt (Android + installed iOS PWA only; iOS Safari non-standalone excluded)
- Reminders config UI — quiet hours pickers + 9 per-trigger toggles in admin Schedule settings
- Bib holder picker in ScoreScreen — staged save flow before committing result
- Debt auto-calc on result save (pricePerPlayer added to owes for unpaid IN players)
- PWA install flow — redirect bridge (ioo_redirect_to 7-day expiry, ioo_last_visited permanent), saves on every /p/ and /admin/ load
- InstallBanner — 4-screen iOS tutorial modal ("How to" → step-by-step with dots nav), Android deferred prompt install button
- PWA welcome screen — shown on first standalone open (no ioo_last_visited); email lookup via find_player_by_email RPC + paste link fallback; multi-team picker; saves ioo_last_visited and never shows again
- Stats: Goals, MOTM, W/L/D, Streaks, Attendance, Bibs, Records, Payment reliability
- Match history with drill-down, share report
- Team selection (manual + random split)
- Score input (scorers, MOTM, W/L/D)
- Bib tracker with history
- Payment tracking + self-pay by player
- Cancel week, late dropout alerts, player notes, deputy flag
- Auto weekly draft after result saved
- City field in onboarding
- Posthog analytics (Product Analytics + Web Analytics + Session Replay)
- T&Cs + Privacy Policy at /legal
- Legal footer links on landing page
- Google Search Console verified
- GitHub repo private
- Invite link banner in Manage Squad
- Admin link reset per player (Reset Link button in Manage Squad, two-step confirmation, old link invalidated immediately)

---

## CONFIRMED FEATURE DESIGNS — NOT YET BUILT

### Plus One
- Player can add a plus one from their view at any time (before or after paying)
- Admin can add a plus one on behalf of a player
- Plus one appears on live board as: Jay 👤 (guest of Dave)
- Payment options: Dave pays via app (second Stripe transaction), or Jay pays cash
- If Dave drops out after adding Jay — admin prompted to keep/remove/reserve Jay
- Plus one spot is INDEPENDENT once paid — Dave dropping out doesn't auto-remove Jay
- After game: admin can add Jay to cover pool with one tap
- Jay never needs the app — name only is sufficient

### Stripe Payments
**Architecture:** Stripe Connect with application fees
- Each team has one treasurer who connects their Stripe account
- Players pay by card, Apple Pay, Google Pay — no Stripe account needed
- Platform fee: 20p per transaction → In or Out Stripe account
- Stripe fee: 1.5% + 20p (EU cards)
- Player pays: match fee + ~50p to cover all fees
- Treasurer switches: Option A — old account disconnects, new connects, clean break

**Refund policy (confirmed):**
- Non-refundable by default
- Game cancelled → automatic full refund to all paid players
- Admin manual refund → one tap, admin decision only
- Randoms → non-refundable, no-show recorded on reliability score
- Platform fee (20p) → always non-refundable
- Reserve players → 30 mins to pay on confirmation, non-refundable once paid

**Payment before game:**
- Admin sets payment deadline (12/24/48hrs before kickoff)
- Unpaid players after deadline → moved to reserve list automatically
- Spot opens → next reserve player notified

**Pay for another player (confirmed rules):**
- Player already paid → option greyed out, cannot pay again
- First payment wins — no duplicates
- Refund always goes to original payer (Stripe default)
- No "owes you back" tracking — players sort themselves
- Plus one payment = separate Stripe transaction, fully independent

**Test case:** Gurnam (treasurer, iPhone) — Finbar's Tuesdays
Gurnam needs: full name, DOB, address, sort code, account number

### Help Chatbot
- Floating ⚽ button on every screen
- Opens chat drawer
- Sends question to Claude API (claude-sonnet-4-20250514)
- System prompt: 820 words covering every screen, flow and common problem
- Tone: friendly, football-casual, short answers
- Cannot access player data — redirects data questions to organiser
- Beta value: stops beta testers messaging Tarny, generates clean feedback

**System prompt saved separately — request it if needed**

### MOTM Voting System
*Status: Designed, not yet built. Effort: ~60–90 mins.*

**Overview**
After each game, all IN players receive a push notification to vote for Man of the Match. Voting is anonymous — admin sees counts only. MOTM is auto-confirmed when a threshold is reached, or admin decides after 12 hours.

**DB Changes**
```sql
ALTER TABLE schedule ADD COLUMN match_duration_mins int DEFAULT 60;
ALTER TABLE matches  ADD COLUMN match_duration_mins int DEFAULT null; -- per-match override
ALTER TABLE matches  ADD COLUMN motm_votes         jsonb DEFAULT '[]';
ALTER TABLE matches  ADD COLUMN voting_closes_at   timestamptz;
ALTER TABLE matches  ADD COLUMN motm_confirmed     boolean DEFAULT false;
```

**Match Duration Setting**
- Added to ScheduleScreen settings — "⏱ Match duration" — default 60 mins
- Stored on schedule table, applies every week; overrideable per match
- Voting notification fires at: kickoff + match_duration_mins + 10 mins

**Voting Rules**
- Only IN players can vote (non-guests, non-injured)
- Players cannot vote for themselves — own name excluded from ballot
- One vote per player, tap to select, tap again to lock — no changes after locking
- Voting window: 60 mins from notification fire time
- If no winner after 12 hours → admin prompted to decide manually
- `motm_votes` stores: `[{voter_id, nominee_id, locked_at}]` — voter identity never exposed to admin

**Auto-Confirm Threshold**
| Players | Votes to auto-confirm |
|---|---|
| 4–5 | 2 |
| 6–8 | 3 |
| 9–11 | 4 |
| 12+ | 5 |

~40% of eligible voters = auto-confirm. Ties don't auto-confirm — wait for more votes or 12hr timeout.

**Notification Flow**
1. Admin saves result
2. Cron fires voting notification at kickoff + duration + 10 mins
3. All eligible IN players get push: "🗳️ Vote for MOTM — who was the best tonight?"
4. Player taps → player view opens → voting card appears front and centre
5. If already in app → voting card appears automatically via realtime
6. Threshold reached → MOTM gets special push: "🏆 You've been voted Man of the Match!"
7. MOTM taps notification → full screen celebration
8. If no winner after 12hrs → admin push: "⚽ Split vote — pick MOTM for Tuesday's game"
9. Admin picks manually → same celebration fires for chosen player

**Admin View**
- Live vote tally visible during window — counts only, no voter names (e.g. "Hassan ●●● Mike ●● Robbie ●")
- Manual override always available
- After 12hr timeout: prompted to decide, sees final counts

**MOTM Celebration Screen**
Full screen takeover on MOTM's device:
- Confetti cannon animation
- Ballon d'Or gold ball or 🏆 trophy — large, centred
- Player name in huge gold text
- "MAN OF THE MATCH" heading
- Game details: "Finbar's Tuesdays · Tuesday 13 May · 20:00"
- Sound effect — crowd roar, respects silent mode (triggered by notification tap)
- Share button → generates text for WhatsApp: "🏆 Hassan voted MOTM — Finbar's Tuesdays 13 May"
- Auto-dismisses after 5 seconds or on tap

**Edge Cases**
| Scenario | Handling |
|---|---|
| Player votes for themselves | Blocked — own name excluded from ballot |
| Guest tries to vote | Excluded — no token/auth |
| Injured player | Excluded from voting |
| OUT/no-show player | Excluded — IN only |
| Admin is also a player | Can vote from their player view |
| MOTM already set before votes close | Auto-confirm skipped, manual takes precedence |
| Tie at threshold | Don't auto-confirm, wait for more votes or 12hr timeout |
| Very small game (4–5 players) | 2 votes to auto-confirm |
| Player has no push subscription | Excluded from push, voting card still appears if they open app |
| Sound on silent mode | Respects device silent switch — no sound |

**Files to Touch**
- `packages/core/storage/supabase.js` — `submitMotmVote()`, `getMotmVotes()`, `confirmMotm()`
- `packages/core/engine/availability.js` — eligible voter logic
- `apps/inorout/src/views/PlayerView.jsx` — voting card + celebration screen
- `apps/inorout/src/views/AdminView/ScoreScreen.jsx` — manual MOTM override, live tally
- `apps/inorout/src/views/AdminView/ScheduleScreen.jsx` — match duration setting
- `apps/inorout/api/notify.js` — voting notification trigger, MOTM confirmed notification
- `apps/inorout/api/cron.js` — new triggers: `motmVoting` (kickoff + duration + 10 mins), `motmTimeout` (12hrs after `voting_closes_at` if not confirmed)

---

### Random Player Pool (Phase 2)
**Three tiers of casual player:**
1. Plus one (one-off) — no app needed
2. Cover pool — no app needed, admin managed
3. Random pool — app required, Google auth, rated

**Player signup:**
- Signs in with Google (auth already built)
- Enters postcode → converted to lat/lng via postcodes.io (free, no key)
- Sets availability: days of week, time windows
- Gets profile card with reliability score

**Existing players:** can opt into random pool from their player dashboard — toggle on/off

**Admin find a random:**
- Pulls live game data automatically (date, time, venue)
- Admin enters/confirms venue postcode
- Sets number of spots needed
- App shows players within radius, sorted by reliability
- Rich player card: name, distance, availability, last 4 weeks history, goals, reliability %
- Admin selects who to ping or pings all

**Ping system:**
- Player gets push notification + email
- Game details shown: date, time, venue, players confirmed, cost
- <24hrs → all available randoms notified, first to respond gets spot
- Randoms pay upfront, non-refundable

**Reliability score:**
- Based on: accepted pings / showed up to games
- Admin marks attendance post-game
- No performance rating — reliability only
- Displayed as percentage: ⭐ 87%

**After game:**
- Admin marks showed up / no show
- One tap: Add to cover pool

---

## PHASE 1 — THIS WEEK (priority order)

| Feature | Est | Notes |
|---|---|---|
| Rotate Supabase keys | 15 mins | Do first — security |
| Admin link reset per player | 30 mins | ✅ DONE |
| Reserve list | 1 session | ✅ DONE |
| Reminders engine | 2 sessions | ✅ DONE (session 4) |
| Notification subscriptions | 1 session | ✅ DONE (session 5) |
| PWA install flow | 1 session | ✅ DONE (session 5) |
| PWA welcome screen | 1 session | ✅ DONE (session 5) |
| iOS PWA fix | 1 session | ✅ DONE (session 5) |
| Plus one | 1 session | Full design above |
| Help chatbot | 1 session | System prompt ready |
| Stripe Connect | 2 sessions | Gurnam test case |
| Super admin dashboard | 1 session | Read-only, quick |
| UI redesign | 2 sessions | Better than current, not final |
| Undo last action | 30 mins | |
| Apple Sign In | 1 session | Needs Apple Dev account £79 |

**Moved to back of Phase 1:**
- Announcement board
- Deputy admin proper access
- Duplicate player handling
- Auth redirect incognito fix

---

## PHASE 2 — WEEKS 2-4

| Feature | Est | Notes |
|---|---|---|
| Random player signup | 2 sessions | Postcode, availability |
| Admin find a random | 1 session | Radius search |
| Ping system | 1 session | Push + email |
| Reliability score | 1 session | |
| Post-game attendance | 30 mins | |
| Add random to cover | 15 mins | |
| Player profile cross-team | 1 session | |
| Full UI design pass | 3 sessions | Final version |

---

## PHASE 3 — MONTH 2+

| Feature | Est | Notes |
|---|---|---|
| iOS + Android apps | 2 sessions | Capacitor |
| Apple Sign In native | 1 session | After Dev account |
| Venue white-label | 3 sessions | After user numbers |
| Booking integration | 4 sessions | Needs venue API agreement |
| WhatsApp Business API | 2 sessions | Phase 3 notifications |
| In or Out Ltd registration | 1hr | Companies House £12 |
| Trademark | 1hr | ~£170 UK |
| Pitch deck for venues | 1 session | |
| Club Manager | 10+ sessions | Second product |

---

## BUSINESS MODEL

| Revenue stream | Amount | When |
|---|---|---|
| Team subscription | £5/year per team | Phase 2 |
| Platform transaction fee | 20p per player per game | Phase 2 |
| Venue white-label | TBD | Phase 3 |

**Revenue projections:**
- 500 teams, payments live: ~£50,000/year
- 5,000 teams, payments live: ~£505,000/year

---

## KEY DECISIONS LOG

*Things agreed that must not be reversed without discussion*

- Token links (/p/TOKEN) always work — no auth required for day-to-day use
- Auth only required when JOINING a new team
- Email is the identity — not the name
- Cover pool players never need the app
- Reserve list always visible (not just when full)
- <24hrs → all reserves notified simultaneously
- Refunds non-refundable by default
- Platform fee (20p) always non-refundable
- Treasurer uses Option A switching (disconnect/reconnect)
- Pay for another player — first payment wins, refund to payer, no owes tracking
- Plus one spot independent once paid
- No performance ratings — reliability only
- Three player tiers: plus one / cover pool / random pool
- Quiet hours for reminders — admin configurable
- Stripe Connect with application fees architecture
- postcodes.io for postcode → lat/lng (free, no key needed)
- iOS localStorage does NOT bridge Safari → PWA (separate storage contexts) — ioo_redirect_to only works if the player visited /p/TOKEN in Safari before installing. Solved for cold PWA first-open with PWA welcome screen: email lookup via find_player_by_email RPC + paste link fallback
- ioo_last_visited is permanent, never cleared — redirects every future app open. ioo_redirect_to is a one-time install bridge, cleared after use (7-day expiry)

---

## TEST ACCOUNTS AND PEOPLE

| Person | Role | Device | Notes |
|---|---|---|---|
| Tarny (you) | Developer + organiser | Mac + iPhone | Google: tarnysingh@gmail.com |
| Gurnam | Treasurer + beta tester | iPhone | Willing to connect Stripe |
| Finbar | Organiser | Unknown | Real Tuesday game organiser |

**Real teams for beta:**
- Finbar's Tuesdays (team_finbars) — primary test case
- Monday Footy (team_mfw3hhu6) — cash only test case

---

## BACKLOG — LOWER PRIORITY

- Google DNS verification via 123-reg TXT record
- Announcement board
- Deputy admin proper access
- Duplicate player handling
- Auth redirect in incognito (cookie fix)
- Admin link regeneration
- iOS offline PWA fix
- Undo last action

---

## CHATBOT SYSTEM PROMPT

*Full 820-word system prompt available — request it when building the chatbot session*

Key points:
- Friendly, football-casual tone
- Max 3-4 sentences per answer
- Cannot access player data
- Redirects data questions to organiser
- Covers: player links, responding, live board, payments, stats, history, multi-game, joining, admin flows, common problems

---

## SESSION NOTES

*Update this section at the end of each session*

**Session 1 (May 9 2026):**
Built core app, Supabase backend, multi-tenancy, player routing, admin view, stats, history, bibs, payments, PWA.

**Session 2 (May 10 2026):**
Built Google auth, email magic link, auth-first join flow, returning user recognition, cover pool (Supabase), Mark All Paid, Clear Debt, city field, Posthog, T&Cs, Google Search Console, GitHub private.

Designed (not yet built): Reserve list, plus one, reminders engine, Stripe payments, random player pool, help chatbot, super admin dashboard.

**Session 3 (May 11 2026):**
Built admin link reset — Reset Link button per player in Manage Squad with two-step confirmation. New token written to Supabase via resetPlayerToken(); local squad state updated immediately. Old link invalidated on confirm, success banner auto-dismisses after 5s.

Built reserve list — RESERVE as 4th status (purple). Player view: reserve button always visible, IN/MAYBE disabled when squad full, "🔒 Squad is full" notice, reserve queue on live board with position numbers. Admin view: squad summary strip (IN X/Y + RESERVE N), draggable reserve list (⠿ drag handles, #1 "Next" badge, array-position reorder). TODO placeholders in code for Reminders and Stripe sessions.

**Session 4 (May 11 2026):**
Built reminders engine + debt tracking.
- Web push: sw.js push/notificationclick handlers, api/notify.js (quiet hours, trigger toggles, queuing, expired sub cleanup), api/cron.js (every 15min: flush queued, game day 9am, 1hr before, 24hrs after, bibs 24hr+45min)
- Player view: "Get notified" subscription prompt after first status set, debt banner
- Squad full + spot opened notifications fired client-side from setStatus
- Game live + cancelled notifications fired from AdminView
- ScoreScreen: staged save with bib-holder picker before committing; debt auto-calc via pricePerPlayer in updatePlayerRecords
- ScheduleScreen: Reminders tab with quiet-hours pickers + 9 per-trigger toggles
- Outstanding debts header: shows total £ and player count
- New Supabase tables needed: push_subscriptions, notification_log
- New Vercel env vars needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, VITE_VAPID_PUBLIC_KEY, CRON_SECRET

**Session 5 (May 11 2026):**
Built PWA install flow, notification subscriptions, and PWA welcome screen.
- Redirect bridge: ioo_redirect_to (7-day expiry, one-time) + ioo_last_visited (permanent). Both saved synchronously in getRoute() on every /p/ and /admin/ load — not in useEffect, which was too late (fires after Supabase data loads).
- InstallBanner rewritten: 4-screen iOS tutorial modal ("How to" → step-by-step with animated dots nav), Android deferred prompt unchanged.
- Notification subscription prompt: canPush now false for iOS Safari non-standalone — no dead-end permission request before install.
- PWA welcome screen (PWAWelcome.jsx): shown when standalone + no ioo_last_visited. Option A: email → find_player_by_email RPC → redirect or team picker. Option B: paste full URL or raw token (validates p_ prefix). Both save ioo_last_visited so screen never shows again.
- Key discovery: iOS localStorage does NOT persist from Safari to PWA — separate contexts. The redirect bridge only helps players who visited /p/TOKEN in Safari before installing. Welcome screen is the real solution for cold installs.
- find_player_by_email RPC: SECURITY DEFINER Postgres function, joins auth.users → players → team_players → teams. SQL must be run manually in Supabase.
- Fixed bug: localStorage saves were in useEffect hooks (fired after async data load) — moved to getRoute() for synchronous save on every page load.

**Next session — start with:**
1. Rotate Supabase keys + add new env vars (VAPID, service role key, cron secret)
2. Create push_subscriptions + notification_log tables in Supabase
3. Run find_player_by_email RPC SQL in Supabase SQL Editor
4. Plus one
5. Help chatbot
6. Stripe Connect (Gurnam test case)
