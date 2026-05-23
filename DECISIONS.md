# In or Out — Key Decisions Log
*Last updated: May 23 2026 (session 32)*

Architectural, product, and design decisions that should inform future work.
Read this before building new features to avoid re-litigating settled questions.

---

## AUTH & IDENTITY

- **Token links always work** — no auth for day-to-day use. `/p/TOKEN` never requires sign-in.
- **Auth only required when joining a new team.** `/join/CODE` is the only auth gate.
- **Email is the identity** — not the name. `auth.uid()` → `user_id` on players row.
- **Returning player joining a new team** reuses the existing `players` row — new `team_players` entry only, no new players record.
- **Flat stat columns** (`goals`, `motm`, `bib_count`, `w`, `l`, `d`, `attended`) are cross-team lifetime totals on one row. `player_match` rows support per-team breakdowns. Don't treat flat columns as per-team.
- **`ioo_redirect_to` is iOS-only.** Write MUST be gated by `isIOS && !isStandalone`. Writing on Android/desktop causes disorienting forced redirects.
- **`onboarding_complete=true`** is written exactly once, at step 3 (ShareLinks.jsx handleGoAdmin). Step 2 leaves it false.

## RLS & WRITES

- **No direct table writes from the client. Ever.** All writes via SECURITY DEFINER RPCs.
- **Admin RPCs derive team_id from p_admin_token server-side.** Never pass team_id as a trust signal from the client.
- **Demo team is not a valid test target for auth or RLS flows.** team_demo has seeded created_at dates and no team_admins row. Always verify against team_finbars or a fresh team.

## PAYMENTS

- **Payment model:** cash only for Stage 1/2. Stripe slots in later.
- **`handleCashPayment` sets `self_paid=true` (not `paid=true`).** Player sees amber "Awaiting confirmation". Admin confirms → `handleMarkPaid` sets `paid=true`.
- **`selfPaid=true` still counts as paid** in PaymentsScreen — admin confirmation is a UX signal, not a payment gate.
- **Ledger cross-path:** player self-pays before lineup lock (matchId=null entry). When admin marks paid with real matchId, `handleMarkPaid` promotes the null entry rather than creating a duplicate.
- **PostgREST `.upsert()` cannot target partial unique indexes.** Use INSERT + catch `23505` instead.
- **`owes` double-increment guard:** `updatePlayerRecords` in ScoreScreen is the sole owes-increment path. `carryForwardDebts` removed session 26. Do not add a second increment path.

## STATS & DISPLAY

- **`player_match` is the source of truth for all stats.** `players` flat columns are write-only convenience fields, not used for display.
- **Reliability is always all-time** — never period-filtered. Numerator (`allTimePlayed`) and denominator (`totalTeamGames`) both use all-time queries. Reliability is a player trait, not a period stat.
- **H2H `dominantType`** is always team-wide all-time regardless of period selector — it's a UI presentation decision, not a stat. Team scoring style is stable; don't thrash it on period change.
- **Goals only counted** where `score_type = null OR 'exact'`. Use `hasGoalData(scoreType)` helper for all goal-related computation.
- **`matches.motm` stores player_id, NOT name.** Use `resolveMotm(motmValue, players)` for display. `isWinner` checks use ID comparison (`match.motm === me.id`).
- **`matches.bib_holder` stores player_id for new rows.** Legacy rows may have name strings. Use `resolveBibHolder(value, players)` which handles both.

## NAMING CONVENTIONS

- **POTM in UI, `motm` in DB/code** — never change DB column names.
- **Results in UI, `history` in filenames/functions** — never change.
- **`is_vice_captain` lives on `team_players`** (per-team), not `players` (global). Migrated session 26.

## ARCHITECTURE

- **VC access = full AdminView minus Rotate Admin Link.** Scoping done via `isViceCaptain` prop throughout. `role_scope` on players is dormant (Phase 2 RBAC).
- **`addPlayerToTeam` is the correct function for admin-adding players** — writes both `players` row and `team_players` link, generates token. `upsertPlayer` does NOT write `team_players` and must not be used for this purpose.
- **App.jsx state wrappers (`setSchedule`, `setSettings`) are pure setters.** Never add DB calls inside them. Child screens call RPCs explicitly before calling the setter for UI sync.
- **iOS localStorage does NOT bridge Safari to PWA.** Treat them as separate contexts.
- **`ioo_last_visited`** — permanent. **`ioo_redirect_to`** — one-time, 7-day, iOS only.
- **Multi-team admin:** Phase 2. Multi-team player switcher already built (MySquads.jsx, session 26).
- **PostgREST self-join workaround:** `getMostPlayedWith`, `getNemesis`, `getBestPartnership`, `getPlayerImpact`, `getPOTMEligiblePlayers` all use two sequential queries + JS computation. PostgREST foreign key joins unreliable in this config.
- **Install ("Add to Home Screen") UX is shared across join and create flows.** Lives in `apps/inorout/src/components/InstallSection.jsx` — platform-detected inline block (iOS 4-step carousel, Android numbered steps, desktop copy-link), no outer shell or CTA. Parent screens (`JoinSuccess`, `SquadReady`) own page chrome + sticky CTA + PostHog event with `flow: "join" | "create"`. Standalone PWA users get the section auto-hidden (returns `null`). Desktop copy-link target: join URL for the join flow, **admin URL for the create flow** — admins reopen the admin panel on phone to install (session 30).
- **TeamsScreen is "Smart by default" — auto-Smart fires on entry** when the match has no saved teams. LiveBoard (two-column A | B grid mirroring PlayerView's confirmed-teams tile) is the primary surface; tap-to-move between teams. The old per-row A/B button list was removed entirely. SMART panel opens by default with Group 1 + Group 2 seeded. BUILD TEAMS is a contextual gold CTA that only appears when groups have been edited since the last algorithm run. Decided session 31.
- **Game-live toggle hides when live.** Off state: "Make this week's game live" + slider. On state: pulsing green dot + "LIVE" badge, no slider. Admin uses Cancel This Week to go offline. Removes the ambiguous "Game is Open / Closed" wording (session 31).
- **Reopen-after-cancel creates a fresh match.** Cancelled match stays in history with `cancelled=true`. New `admin_reopen_week` RPC handles the full transaction (clear is_cancelled, insert new matches row, point active_match_id at it). Keeps the audit trail honest and avoids un-cancelling payment ledger refunds (session 31).
- **Admin-configured `schedule.dayOfWeek` is authoritative over the `gameDateTime`-derived weekday** in player-facing copy. The demo schedule had drift between the two (day_of_week='Wednesday' but timestamp on a Tuesday); when they disagree, the configured day wins. Session 31.
- **Status confirmation banners are one-shot, not persistent.** "🔒 Locked in", "👍 No worries", "🤞 Got it" etc. flash up for 5s after a setStatus tap, then slide-fade. They do NOT resurrect on page refresh. `hideConfirmation` initial state is `true` (session 31).
- **IO deeper-intel is computed client-side, not via RPC.** `packages/core/engine/deeperIntel.js` derives mostPlayedWith, mostFacedOpponent, nemesis, bestPartnership, impact, reliabilityRanking from `matches[]` + `squad[]` already in state. No new RPC, no schema change, no extra round-trip. Chosen over extending `get_team_state_by_player_token` because the source data is already loaded on every route and the computation is cheap. Phase 0B (Casual/Competitive split) will pre-filter `matches[]` before this engine sees them, so the cards inherit the filter for free (session 32).
- **MyIOView.jsx is exempt from the hex-literal hygiene check.** Documented in `skills/scripts/check-hygiene.sh` header. Rationale: CLAUDE.md itself mandates hex literals inside SVG fill/stroke (CSS vars don't work there) and this file is overwhelmingly SVG badge crests and gradient overlays. Same exemption pattern as `constants/colors.js`. If extending: keep new colours in the INSIGHTS array, not scattered through the file (session 32).
- **Smart Teams adoption analytics: rich `team_confirmed` event as the anchor.** Carries `manual_moves_before`, `manual_moves_after`, `regenerate_count`, `was_ai_picked_as_is`, `is_recommit`, plus prediction fields and team sizes. Secondary events (`team_drafted_auto`, `team_player_moved`, `team_regenerated`, `team_cleared`) fire alongside but the confirm event is what the dashboard queries. Session 31.

## SCHEDULING & CRON

- **`is_draft` is NOT the auto-open flag.** `is_draft=true` means onboarding incomplete only. `auto_open_pending=true` is the auto-open flag — reset weekly by `advanceGameDateJob`.
- **`advanceGameDateJob`** resets `auto_open_pending=true` weekly so games auto-open next week without admin action.
- **Lineup lock window:** first cron tick at or after kickoff (real-world window: kickoff → kickoff+15min depending on cron cadence). Requires `game_is_live=true` and `lineup_locked=false`.

## BETA PLAN

- **Stage 1:** team_finbars (Finbar's Tuesdays). Beta held — currently stabilising bugs.
- **Stage 2:** May 26 — Monday Footy added if Stage 1 week 1 is clean.
- **Broader beta:** ~Jun 9 — anyone willing to mandate the app.
- **Quiet public availability:** late Jul / early Aug.
- **Beta deal:** free forever for first 10 teams. Cash/bank transfer. Stripe fees only if Stripe lands.

---

## MID-GAME TEAM SWITCHES (Phase 2 — spec agreed)

- New stage in ScoreScreen between score entry and bibs
- Admin marks players who switched teams during the game (⇄ swap icon next to name)
- `team_switches jsonb` column on matches: `[{player_id, from: "A", to: "B"}]`
- `team_a`/`team_b` on match updated to reflect FINAL team assignments after switches
- `player_match.team_assignment` records the final team — W/L/D derived from that
- Match history shows ⇄ icon next to any player who switched
- Switch time not recorded — binary only
- Stage is optional — if no switches, admin skips through

---

## APPLE WATCH GOAL LOGGER (Phase 3 — spec agreed)

- Requires native iOS app (Capacitor) as container first
- watchOS extension in Swift/SwiftUI alongside Capacitor — not possible via Capacitor alone
- Interaction: tap team A/B → crown scroll to player → tap confirm → goal logged to Supabase
- Haptic confirmation on goal log
- Estimated effort: ~20h Capacitor iOS + ~8h watchOS = ~28h total
- Prerequisite: Apple Dev account £79 (same as Apple Sign In)

---

## PHASE 4 — LEAGUE MODE (parked)

Full spec in `CONTEXT.md`. Do not build pre-launch. Sales pitch: "I have N of your players
already using the team app — want to run your league free for one season?"

Schema decisions to keep in mind (don't implement yet, just don't paint into corners):
- `player_match.team_assignment`: may need to reference team_id not just 'A'/'B'
- `matches.motm`: may need to allow array (one POTM per side)
- Future tables: venues, leagues, fixtures, referees

---

## GROUP BALANCER

- **Tap-to-assign over drag-and-drop.** Chosen for mobile reliability,
  accessibility, zero library footprint, and ~2–3h faster Stage 3 build. Drag
  was rejected (dnd-kit, Framer Motion, react-beautiful-dnd all considered).
  Drag is "playful" but the value of a balancer is *who ends up on each team*,
  not the gesture used to assign them. Tap → panels glow as targets → tap to
  commit. Tap outside cancels.
- **Win rate is the only signal.** No MMR, balance scores, or per-player
  numerical signals — keeps the system simple and avoids any path toward
  player-visible rankings. Random tiebreak within 5% of best score gives
  rerolls varied feel.
- **Group numbers are admin-only.** Never expose to player routes. Enforced by
  RLS (no anon read on `team_players.group_number`) and a header comment in
  `packages/core/engine/groupBalancer.js`.
- **`generateBalancedTeams` is a pure engine function**, no Supabase calls.
  Reusable by Ask the Gaffer Phase 2 (fair team suggestions) without
  reinventing the algorithm.

Full spec: `GROUP_BALANCER.md`.

---

## ASK THE GAFFER

- **Football-operations agent, not a generic chatbot.** Must be grounded in
  team data (`player_match`, `bib_history`, `team_players`, `matches`,
  `team_switches`, `ledger`). Feel: "a smart assistant for the organiser who
  already knows the squad."
- **Four-phase trust-graduated rollout:**
  1. Read-only assistant (Q&A, summaries, briefings)
  2. Recommendations (drafts shown, no actions taken)
  3. Confirmed actions (admin one-tap approve buttons fire existing RPCs)
  4. Semi-autonomous (auto-detect short squads etc.) — only after trust
     proven
- **Anything visible to players requires admin approval, even in Phase 4.**
  Hard rule.
- **All writes via existing SECURITY DEFINER RPCs.** No new direct-write
  paths for the agent. Auth via `adminToken` per RLS checklist.
- **LLM provider + data-access pattern** deferred until Phase 1 scope opens
  (cost is the primary factor).

---

## MARKETING LANDING PAGE

- **Beta:** Option A — conditional render at root. Single Vercel project,
  unauth + no token + root path → render landing, else app shell. Zero
  infrastructure change, preserves all existing `/p/TOKEN`, `/create`,
  `/join`, `/demoadmin` URLs.
- **Post-public-launch:** Option B — subdomain split (`in-or-out.com` =
  marketing, `app.in-or-out.com` = app). Requires updating Supabase OAuth
  callbacks, redirecting in-the-wild `/p/TOKEN` links, re-checking
  push-notification origin scope. Planned migration, not now.
- **Why now:** beta needs a public-facing landing page to capture sign-ups
  and run ads. Option A ships in a day; Option B is 1–2 days plus settle-in
  risk on existing share links.

---

## H2H DESIGN DECISIONS

- **Two matches queries:** Query 1a all-time (for `dominantType`), Query 1b period-filtered (for stats). One extra query per H2H open in 'all' mode — clarity wins over optimisation.
- **Sample size floors:** chemistry refuses to fire with < 3 games of each baseline. Main verdict requires ≥ 3 `totalShared`. Section 2 streak softens "1 in a row" to "won the last meeting".
- **Score type gating:** use `hasGoalData(scoreType)` for any goal computation. Filter data set first, then reduce over filtered set AND divide by filtered count (not unfiltered) so averages are honest.
- **`meRows`/`themRows` filtered by `matchMap` membership immediately after Query 2.** `matchMap` contains only period-filtered match IDs and is the single period-gating point — all downstream computation inherits period scope automatically.

---

## IO INTELLIGENCE

- **4 tabs for players, 5 tabs for admins.** 5th tab appears when `onAdminClick` prop is truthy (not an `isAdmin` prop).
- **Unlock thresholds are per-player per-team.** Progressive reveal based on `gamesPlayed`.
- **`useIOIntelligence.js` is a pure passthrough** — takes `stats` prop from state RPC, makes no direct Supabase calls. Rewritten session 25.
- Full IO spec in `IO_INTELLIGENCE.md`.
