# Match Fitness Stats & Trends — Epic Manifest

*Scoped 2026-07-03. Audit + plan only — no code yet.*
*Runs as an UNMANNED epic loop: `/loop /dev-loop MATCH_FITNESS_STATS_HANDOFF.md`.*
*Each `### PR #n` = one dev-loop cycle → one PR. The loop STOPS at every 🚦 gate (migration*
*apply / legal sign-off). PR-only; never pushes main; never auto-merges; never applies a*
*migration or touches RLS/health-data without explicit sign-off.*
*Plan gate: batched · Merge mode: per-phase.*

## 🔁 EPIC STATUS (loop state — newest first)
- **PR #4 — Trend graph + baseline + PB callout** → 🏁 **MERGED (#258, 2026-07-03)**, on `main`
  @ 5fe2598. Single-file: `MatchFitnessSection.jsx`
  gains a hand-rolled SVG per-match sparkline (avg-HR, toggle→distance), a dashed rolling baseline
  (`--green` fitter / `--gold` not, per-segment; colour via `currentColor`+inline `style` — the
  `MatchRouteHeatmap` idiom), a hedged rolling-trend verdict (never per-match, LOCKED DEC #5), a
  "fittest match" hero + "most active month" badge (both metric-INDEPENDENT), and a <5-match
  sparkline-only fallback. Zero backend (client-side over `getMyMatchHealth()`). Proof: trend-math
  validated in isolation (no NaN, baseline colour correct, flat/sparkline safe); hygiene(SVG colour
  discipline)/lint/build green; browser smoke (demo token) — StatsView unchanged, section
  self-hides, 0 new console errors, no health RPC leaked; QA+Security review clean (2 minor QA fixes
  applied: hero/badge metric-independence + swatch colour); live-config CLEAR; CI
  platform-clubmanager PASS. **DARK-IN-PROD**. Merged 2026-07-03 (per-phase). **NEXT = PR #5
  (🚦 migration 475: two readers + detach write RPC)** — TIER-3. Loop drafts the `.sql`+`_down.sql`,
  runs rpc-security-sweep + ephemeral-verify (delete path: own-row-only, route cascade, audit row,
  cannot delete another's), then **STOPS at G1 (migration-apply sign-off)**. Re-confirm mig 475 free
  on live first (MEMORY says next free = 472; re-check).
- **PR #3 — Promote MATCH FITNESS into StatsView** → 🏁 **MERGED (#257, 2026-07-03)**, on `main`
  @ 94c3e46. New
  `apps/inorout/src/views/MatchFitnessSection.jsx` (reads `getMyMatchHealth()`, buckets client-side
  by StatsView's `month|season|all` selector → own totals Matches/Distance[`formatDistance`]/
  Calories/AvgHR; self-hides on empty; token/anon short-circuits on `getSession()`); StatsView.jsx
  += import + one render line after the league table. No backend. Proof: diff-triggers→
  casual-regression only; hygiene(both)/lint/build green; browser smoke (dev server, demo token) —
  StatsView all existing sections unchanged, new section self-hides, 0 new console errors, no
  get_my_match_health RPC fired for token viewer; QA+Security review clean (no issues); live-config
  CLEAR; CI platform-clubmanager PASS (platform-ref = known false alarm). **DARK-IN-PROD**
  (display gates on has-data; prod has no attaches). Merged 2026-07-03 (per-phase).
  **NEXT = PR #4 (trend graph + baseline + PB callout)** — builds the graph INSIDE the PR-3
  MatchFitnessSection. Hand-rolled SVG per `MatchRouteHeatmap` idiom; client-side monthly
  buckets + rolling baseline; zero backend.
- **PR #2 — Attach-on-next-open (friction kill)** → 🏁 **MERGED (#256, 2026-07-03)**, on `main`
  @ 6f19844. Single-file:
  `PerMatchFitnessCard.jsx` gains an auto-detect useEffect that eagerly searches Apple Health on
  result-card mount for recent (14d) casual games with no session, surfacing the EXISTING one-tap
  confirm/pick sheet; `runSearch({silent})` variant (quiet inline note, no modal on empty/denied);
  gated on `AGE_KEY==="yes"` so U18 / first-timers never get an unprompted native/age prompt;
  per-match throttle set only when a workout SURFACES (empty stays retryable = sync-delay retry).
  Proof: diff-triggers→casual-regression only; hygiene/lint/build green; browser smoke (demo token
  `p_demo_alex_token`) — Results renders, cards expand, card self-hides, 0 new console errors, no
  health RPC leaked; QA+Security review clean (1 throttle refinement applied); live-config CLEAR;
  CI platform-clubmanager PASS (platform-ref = known false alarm). **DARK-IN-PROD** (flag unset).
  Merged 2026-07-03 (Merge mode: per-phase). **NEXT = PR #3 (promote MATCH FITNESS into
  StatsView)** — branch off `main`@6f19844; reads `getMyMatchHealth()`, new first-class section in
  `StatsView.jsx`, uses the existing period selector + `formatDistance`. No backend.
- **PR #1 — Units → miles foundation** → 🏁 **MERGED (#255, 2026-07-03)**, on `main` @ 8a3ceb8.
  New `apps/inorout/src/lib/formatDistance.js`; MyIOView + PerMatchFitnessCard retrofitted to
  miles. Proof: node --check / lint / hygiene / build green; live-config CLEAR; browser smoke
  of MY IO + Results clean; done-check proven (6100m→"3.8 mi"); QA review clean; DARK-IN-PROD.
  **NEXT = PR #2 (attach-on-next-open)** — branch off fresh `main` (@8a3ceb8 or later); it edits
  PerMatchFitnessCard which now imports formatDistance from ../lib/formatDistance.js.

**Builds ON (does NOT re-scope):** `MATCH_WORKOUT_TRACKING_HANDOFF.md` (the capture+storage
pipe — mig 456/457, all 7 PRs merged, HealthKit build 1.1.0(10) Apple-APPROVED 2026-07-03).
This is the **Phase-2 STATS / TRENDS / SOCIAL layer** on top of that shipped pipe. The pipe
is done; this surfaces the data properly and makes logging near-frictionless.

---

## WHAT IT IS (plain English)

The Apple-Watch match-fitness data is already captured and stored (duration, distance,
calories, avg/max HR, GPS route/heatmap) but it only shows as raw all-time totals on the
separate "My IO" tab. This epic does five things, cheapest-win-first:

1. **Kills the logging faff.** Instead of a multi-step manual "attach a workout" button,
   the app auto-detects the watch workout in the match window and surfaces a **one-tap
   "add it?"** the next time the player opens the app after a game they were IN for.
2. **Promotes fitness into StatsView** — a first-class "MATCH FITNESS" section beside the
   existing squad leaderboards, where players already go to compare.
3. **Trends over time** — a monthly graph with a "**vs your own baseline**" line (avg HR
   drifting down over weeks = you're getting fitter) and a "**fittest match this season**"
   hero. Built client-side from data we already have — no new backend.
4. **Head-to-Head fitness** — "who ran further / higher HR / more calories vs *this
   opponent*" over month/season/all, consent-gated, casual-only.
5. **Squad fitness board** — the recurring squad's fitness, framed as **averages +
   most-improved + consistency**, NOT a raw fastest-first leaderboard.
6. **Per-match "who ran the most"** — right on the match result, a "🏃 Top runner this game:
   Sam · 3.2 mi" highlight of the squad in *that* match. Reuses data already fetched — no new
   backend, consent + casual-only inherited from the existing per-match reader.

**Distance is shown in MILES throughout** (stored in metres, formatted in the client).

**POSITIONING (locked — do not drift):** We differentiate on **context Apple Health and
Strava structurally can't hold** — *this match, this opponent, this recurring squad*. The
squad IS the naturally-scoped peer segment Strava has to engineer artificially; that's the
unfair advantage. We lean to Strava's **social/competitive** model (per-opponent H2H,
squad board, consistency crown) pointed at organised recurring football. We **explicitly
decline generic-health-app parity**: no HR-zone clinical dashboard (Z1–Z5), no
resting-HR/HRV/recovery score, no VO2max/cardio-fitness estimate, no calorie-ring/move-goal
gamification, no all-day steps/sleep. Strictly the match window, always framed against a
football referent.

## LOCKED DECISIONS (carried from the capture epic + set here)

Inherited from `MATCH_WORKOUT_TRACKING_HANDOFF.md` (already decided — do not re-litigate):
- **Under-18 NEVER tracked.** Consent (`players.share_match_fitness`, default OFF) gates
  teammate visibility. Casual-only for any cross-player view; league/cohort fitness stays
  private to the player. Indoor hides distance/route (no GPS). Whole thing ships **DARK**
  behind `VITE_HEALTH_KIT_ENABLED` (off) — display surfaces self-hide on empty data.

Set by this scope:
1. **Logging mechanism = "attach on next app open"** (eager `queryWorkouts` on foreground
   for recent IN + final casual games with no session yet). Reuses the SHIPPED plugin
   methods → **pure JS, no native change, does NOT re-arm the Apple freeze.** A
   push-notification nudge is REJECTED for Phase 1 (needs native background delivery =
   binary change = full re-review). Manual attach stays as the fallback.
2. **Phase-1 primary path = one-tap CONFIRM on next open** (auto-detect surfaces the sheet;
   the player taps to add — nothing to undo, so PR #1 stays pure JS with no delete RPC). A
   **silent auto-attach-with-undo** variant is DEFERRED until the detach RPC ships (mig 475,
   PR #4) — it needs a reversible delete the pipe doesn't have today. Multiple/ambiguous →
   the existing pick sheet. Manual attach stays fallback throughout.
7. **Non-watch players are a first-class audience, never shamed.** Most squad members will
   NOT own an Apple Watch. Their squad-board row is framed as an invitation ("add an Apple
   Watch to join the fitness board"), never a blank/zero row, and they still count toward
   the squad-total aggregate — they're part of the collective number even without data.
8. **Wrongly-attached workouts are removable.** A "remove / re-attach" affordance (backed by
   a new `delete_match_health_session` write RPC, mig 475) lets a player detach a workout
   matched to the wrong game — a genuine reverse-path the capture epic never shipped.
9. **Distance is displayed in MILES, everywhere.** Storage + RPCs stay in **metres** (SI,
   unit-neutral); a single shared `formatDistance(metres)` helper (miles, ~1 dp, "mi";
   `metres / 1609.34`) does ALL formatting. This retrofits the two ALREADY-SHIPPED surfaces
   that currently show km (`MyIOView.jsx:776` MatchFitness card, `PerMatchFitnessCard.jsx`).
   Centralising units in one helper also makes a future per-user km/mi toggle a one-function
   change (not scoped now — miles only).
10. **Per-match top-runner reuses the SHIPPED reader.** "Who ran the most this game" ranks
    `get_match_health_for_match(p_match_ref)`'s already-consent-gated, casual-only per-player
    rows (mig 456, live) — a re-sort + highlight of data `PerMatchFitnessCard` already
    fetches. NO new RPC; inherits the U18 read-guard once mig 475 retrofits it.
11. **Consent opt-in = a ONE-TIME proactive request at first attach, not a buried toggle.**
    The `share_match_fitness` toggle + its RPCs already exist (mig 457) but are passive — a
    settings toggle nobody finds. Add a single clear one-time sheet at the FIRST successful
    workout attach (the moment sharing becomes meaningful): brief explanation + [Share my
    stats] / [Not now]. Default stays OFF (opt-IN). One-time via a `localStorage`
    "seen" flag (mirrors the existing `AGE_KEY` pattern) → never nags. Under-18 never sees
    it. The profile toggle remains the permanent control. NO new backend.
3. **Fitness is promoted to a first-class MATCH FITNESS section in StatsView** (the
   comparison/bragging surface). The trend graph lives inside it. The MyIO card **stays**
   as the compact personal glance. Per-match detail stays in HistoryView (correct today).
4. **Phase 5 = averages + most-improved + consistency, NOT a raw leaderboard.** A
   fastest-first board motivates the two fittest and shames the rest (and rewards pointless
   over-running). Multiple paths to a win — most-distance, most-improved %, most-consistent
   (attendance/"Local Legend" analog) — plus a squad-average backdrop you beat yourself
   against. A slower player can still win "most improved."
5. **HR-improvement is framed as a hedged rolling 4–6 week trend, never a per-match
   verdict.** "Trending in the right direction," never medical/diagnostic phrasing —
   single five-a-side matches are stop-start and HR is confounded by weather/sleep/intensity.
6. **The two new readers (mig 475) speak `p_period` (`month|season|all`) AND return a
   pre-bucketed monthly `buckets[]` series** (not just scalar totals) — see FUTURE-PROOF.

## KEY AUDIT FACTS (load-bearing — don't re-derive)

- **Next free migration = 475** (474 highest on disk; re-confirm live before taking it —
  "first-come on main", a cloud session can grab it).
- **Phases 1–3 need ZERO new backend.** `get_my_match_health()` returns `{ok, sessions[],
  totals}` where each session carries `started_at` + `duration_seconds`,
  `active_energy_kcal`, `distance_meters`, `avg_hr`, `max_hr`, `hr_zones`, `ended_at`,
  `match_context`, `match_ref`. Client-side monthly bucketing (`started_at.slice(0,7)`) +
  rolling baseline are fully computable in JS. **One known gap:** the sessions array does
  NOT carry `source` (`apple_health_manual` vs `watch_app`) — a one-line additive add to
  the RPC's SELECT if watch-vs-manual badging is ever wanted (then HR#12 applies).
- **The full attach state machine ALREADY EXISTS** and is correct: `PerMatchFitnessCard.jsx`
  (513 lines, mounted `HistoryView.jsx:473`) does age-gate → `requestHealthAuth` →
  `queryWorkouts` → clamp → confirm/pick → `queryRoute` + `trimRoute` →
  `saveMatchHealthSummary` → refresh. Phase 1 = change *when* `runSearch()` fires (auto on
  mount/foreground vs button tap), reusing this flow verbatim. Native helpers in
  `apps/inorout/src/native/native-health.js` (`isHealthAvailable`, `requestHealthAuth`,
  `queryWorkouts`, `queryRoute`) — all shipped in 1.1.0(10).
- **Admin's "Full Time" (`ScoreScreen.jsx` winner-set cascade) is the WRONG hook** — it's
  one admin device and can't touch other players' HealthKit. Each player's own device must
  prompt → surface per-player on next open / on the HistoryView result card.
- **Phases 4–5 = TWO new reader RPCs, NO DDL** (just 2 `CREATE FUNCTION`s in mig 475).
  Reference implementation = `get_match_health_for_match(p_match_ref)` (mig 456): SECDEF,
  STABLE, `auth.uid()`, anon REVOKED, `search_path` pinned, single overload; own row
  always, teammate rows only when `match_context='casual'` AND that player's
  `share_match_fitness=true`. **Mirror it exactly.**
- **Identity/join path (proven in mig 456):** `match_health_sessions.user_id (auth.uid())`
  ↔ `players.user_id`; casual co-participation via `player_match` (`player_id` TEXT,
  `match_id` TEXT, `UNIQUE(match_id, player_id)`); `matches.id` TEXT = `match_ref` for
  casual. **Squad membership = `team_players`, NOT `players.team`** (`players.team` = A/B
  match assignment, per SCHEMA.md).
- **U18 guard is SAVE-TIME ONLY today** (`_health_is_under_18()` inside
  `save_match_health_summary`). The readers have NO U18 re-check — a residual row is
  reachable (saved while DOB unknown, DOB<18 entered later). **Every new reader must add
  `AND NOT _health_is_under_18(s.user_id)` for self AND teammate rows; retrofit the same
  guard into `get_match_health_for_match` in the same PR.**
- **Consent is re-evaluated on every read** (join `players.share_match_fitness`) — turning
  the toggle OFF makes a player vanish from others' boards on the next read, no cache. New
  readers MUST replicate the join, never snapshot consent.
- **Privacy policy already discloses teammate sharing** (`Legal.jsx` ~L141: "so you — and,
  if you choose, your teammates — can see your match fitness stats"). The *comparison /
  ranking* purpose (viewer as recipient of others' special-category data) is thin → legal
  sign-off gate (G-Legal below).
- **No chart library in the tree.** Precedent for hygiene-safe hand-rolled SVG =
  `components/MatchRouteHeatmap.jsx` (normalise into a padded `viewBox`, colour via
  `currentColor` / inline `style={{fill:'var(--…)'}}` — never raw hex, never CSS-var in an
  SVG attr). Also `components/ui/GaugeArc.jsx`. Build the trend graph from scratch in that
  idiom.
- **Design language for fitness is set:** gold-coded (`--gold` numbers, `Lightning`
  Phosphor icon `weight="thin"`, Bebas Neue), `--green` start / `--red` end route dots,
  card = `var(--s2)` on `0.5px solid var(--b2)`, radius 12. No new tokens needed —
  `--gold`/`--green`/`--red`/`--t2` cover it. Team A/B stay `#60A0FF`/`#FF6060`.
- **Whole layer is web-bundle-only** → deploys via Vercel with no Apple review; prod-safe
  during the freeze. Display gates on **has-data**; the attach affordance gates on
  **`VITE_HEALTH_KIT_ENABLED`**. So displays light up automatically the moment the flag
  flips and real attaches land — no second deploy.
- **Distance is stored in metres** (`match_health_sessions.distance_meters`) and formatted to
  km TODAY (`MyIOView.jsx:776` does `distance / 1000`). Miles = a CLIENT formatting change via
  a shared `formatDistance` helper; storage + both new RPCs stay in **metres** (unit-neutral —
  never bake miles into SQL). Both the shipped MatchFitness card and `PerMatchFitnessCard` need
  the retrofit (they render km now).
- **The consent toggle + its RPCs already exist** (mig 457, PR #172): `players.share_match_fitness`
  (default false), `get_my_share_match_fitness` / `set_share_match_fitness`, and a passive
  "MATCH FITNESS" toggle in `PlayerProfile.jsx` (signed-in only). The opt-in-prompt PR adds a
  proactive one-time REQUEST only — no new backend. Reuse the `AGE_KEY` localStorage pattern
  in `native-health.js` for the one-time "seen" flag.
- **Per-match "who ran the most" needs NO new backend.** `get_match_health_for_match(p_match_ref)`
  (mig 456, LIVE) already returns the squad's per-player rows for a match, consent-gated +
  casual-only, and `PerMatchFitnessCard` already fetches them — the top-runner highlight is a
  re-sort + highlight of on-screen data. It inherits the same consent/casual gate and (once
  PR #5 lands) the U18 read-guard.

---

## ROADMAP — PRs in dependency order

### PR #1 — Units → miles foundation   TIER-1 · CLEAR
New shared `formatDistance(metres)` helper (miles, ~1 dp, "mi"; `metres / 1609.34`) — the
single formatter every fitness surface calls (LOCKED DECISION #9). Retrofit the two
ALREADY-SHIPPED km surfaces: the MatchFitness card (`MyIOView.jsx:776`) + `PerMatchFitnessCard`.
Storage/RPCs untouched (stay in metres). A tiny foundation PR so every later PR just calls the
helper — and a future km/mi toggle is one function.
- Gates: check-lint, check-hygiene, check-build, casual-regression, Playwright smoke of MyIO +
  a per-match card.
- Done-check: both shipped surfaces render "mi" (a 6.1 km session now reads "3.8 mi"); no other
  behaviour changes; grep confirms no stray "km"/`/ 1000` in fitness surfaces.
- Effort: XS. No 🚦.

### PR #2 — Attach-on-next-open (friction kill)   TIER-1 · CLEAR
Eager `queryWorkouts` on app foreground / result-card mount for recent IN + final casual
games with no session yet; primary path = one-tap CONFIRM sheet (LOCKED DECISION #2), else the
existing pick sheet on multiple/ambiguous. Reuses the shipped `PerMatchFitnessCard` flow
verbatim — only *when* `runSearch()` fires changes. Manual button stays fallback. Throttle so
opening old results doesn't re-prompt. Handle denied-vs-empty (one-line "Health access off"
note, no modal spam) + sync-delay retry. Under-18 never offered.
- Gates: check-lint, check-hygiene, check-build, casual-regression, Playwright smoke with
  MOCKED Health responses (found / none / multiple / denied).
- Done-check: reopen the app after a logged watch workout → the matching game auto-surfaces
  the confirm sheet with zero manual navigation; empty/denied self-hides cleanly.
- Effort: M. No 🚦 (JS only, plugin unchanged — no new binary; real-device walk folds into
  the capture epic's owed G5, not a new Apple submission).

### PR #3 — Promote MATCH FITNESS into StatsView   TIER-2 · CLEAR
New first-class "MATCH FITNESS" section in `StatsView.jsx` reading `getMyMatchHealth()` —
own totals glance (Matches / Distance [`formatDistance`] / Calories / Avg HR) inheriting the
existing `month|season|all` period selector. MyIO card stays as-is. Self-hides on empty.
- Gates: check-hygiene, check-build, casual-regression, Playwright smoke of StatsView.
- Done-check: a player with sessions sees the section under the period selector; empty =
  renders nothing; StatsView's existing sections unchanged.
- Effort: S.

### PR #4 — Trend graph + baseline + PB callout   TIER-1 · CLEAR
Inside the PR-3 section: hand-rolled SVG line/sparkline of per-match avg-HR (toggle to
distance), client-side monthly buckets, a dashed **rolling-baseline** line (segment
`--green` when trending fitter, `--gold` above), and a "**fittest match this season**"
callout row. Under ~5 matches → sparkline only + "needs more games". PB / "most active
month" badges derived in JS. Zero backend.
- Gates: check-lint, check-hygiene (SVG colour discipline), check-build, casual-regression,
  Playwright.
- Done-check: a player with ≥2 months of sessions sees the trend + baseline + fittest-match
  hero; <5 matches shows the sparkline fallback; empty self-hides. Confirm month-bucket
  timezone (UTC vs local `started_at`) lands a late-night match in the right month.
- Effort: M.

### PR #5 — Migration 475: two readers + one detach write RPC   🚦 TIER-3 · CLEAR
ONE migration file (no schema DDL — three `CREATE FUNCTION`s) + `_down.sql`. All SECDEF,
`search_path` pinned, single overload, **REVOKE from anon + authenticated + PUBLIC by name
then GRANT to authenticated** (the default-privileges gotcha). The two readers are STABLE,
`auth.uid()`; both carry `p_period text DEFAULT 'all'`, return a pre-bucketed monthly
`buckets[]` (each bucket carries a stable **`period_start` ISO date** so the SAME reader
feeds weekly/monthly/seasonal graphs without a re-shape) + `totals` + per-bucket
**`source_counts`** (`watch_app` vs `apple_health_manual` — baked in NOW because the sessions
array doesn't carry `source` today; retrofitting later = a return-shape change across five
recorded consumers, HR#12/#14). Both add the **U18 read-guard**
(`AND NOT _health_is_under_18(s.user_id)`) and **retrofit that guard into
`get_match_health_for_match`**. Casual-only + `share_match_fitness` consent enforced
server-side.
- **`delete_match_health_session(p_client_session_id text)`** — the reverse path (LOCKED
  DECISION #8). VOLATILE, `auth.uid()`-scoped own-row-only DELETE (cascade wipes the
  `match_health_routes` row), `audit_events` insert per **Hard Rule #9** (fire-and-forget
  write must leave a server trace). Lets a player detach a workout matched to the wrong game
  + unblocks the deferred silent-auto-attach-with-undo variant. This makes PR #5 carry a
  WRITE, so ephemeral-verify must prove the delete path (own-row-only, route cascade, audit
  row written, cannot delete another user's session) — not just the readers.
- `get_h2h_match_fitness(p_opponent_player_id text, p_period text DEFAULT 'all')` →
  `{ok, opponent_consented, shared_games, me:{…}, them:{…}|null, buckets[]}`. **Anti-probing:**
  `them` populated ONLY across casual matches BOTH players have a `player_match` row for
  (EXISTS on shared `matches.id`) AND `them.share_match_fitness=true` — passing an
  arbitrary opponent we never played returns empty, never their numbers. Aggregate over the
  shared-match subset only.
- `get_squad_fitness_leaderboard(p_team_id text, p_period text DEFAULT 'all')` →
  `{ok, min_cohort_met, rows:[{player_id, player_name, is_self, games, avg_distance,
  avg_kcal, avg_hr, most_improved_pct, ...}], buckets[]}`. Squad derived from `team_players`
  (caller may be in several teams → `p_team_id` explicit, but membership verified
  server-side). Own row always; other members only when consented + ≥18 + casual. **Min-N
  floor** (suppress the board when consenting members < N, default 3) to prevent
  re-identifying one teammate's exact numbers.
- JS wrappers `getH2hMatchFitness` / `getSquadFitnessLeaderboard` / `deleteMatchHealthSession`
  + barrel export.
- RPCS.md: record consumers now (HR#14) — StatsView, HeadToHead, watchOS companion, Ask the
  Gaffer (note "gaffer-consumable"), reception display.
- Gates: rpc-security-sweep (all 3 fns), ephemeral-verify (readers → consent exclusion
  [non-consenter absent, not zeroed], casual-only [league `match_ref` returns self-only],
  U18 read-guard blocks a residual U18 row, anti-probing [unplayed opponent = empty], squad
  derived server-side, min-N floor; **delete → own-row-only, route cascade, audit row
  written, cannot delete another user's session**; `_e2e_` leak-check = 0),
  check-lint/hygiene/build, casual-regression.
- **🚦 STOP:** loop drafts the `.sql` + EV-proves it, then STOPS at the migration-apply
  sign-off (G1). Does NOT apply. Re-confirm 475 free on live at apply.
- Done-check: EV green on all gating assertions + leak-check 0; rpc-security PASS.
- Effort: M/L.

### PR #6 — One-time "share your fitness?" opt-in prompt   TIER-1 · CLEAR
Makes the passive consent toggle proactive (LOCKED DECISION #11) — the thing that actually
populates the cross-player surfaces. The first time a player successfully attaches a workout
(hook the PR-2 attach-success path), show ONE clear sheet: *"Share your match fitness with
your squad? Teammates can see how you compare — head-to-head and on the squad board. Casual
games only, and you can turn it off any time."* → [Share my stats] / [Not now].
- One-time: shows only when `share_match_fitness===false` AND `!localStorage('io_fitness_share_seen')`
  AND ≥1 session. [Share] → `setShareMatchFitness(true)`; [Not now] → set the localStorage
  flag. Either way it NEVER re-appears. Reuses the `AGE_KEY` localStorage idiom.
- Under-18 never sees it (same DOB/age gate as the attach flow).
- Passive fallback: a soft inline "turn on sharing to compare" line on the LOCKED/empty state
  of the H2H fitness row (PR #7) + squad board (PR #9) — not a modal.
- The `PlayerProfile.jsx` toggle stays as the permanent control (change your mind any time).
- NO new backend — the toggle + `set_share_match_fitness` already exist (mig 457).
- Gates: check-lint/hygiene/build, casual-regression, Playwright (prompt shows once → opt-in
  flips the flag → never re-shows; dismiss → never re-shows; under-18 never sees it).
- Done-check: first attach surfaces the sheet exactly once; opting in makes you appear on
  teammates' boards; dismissing leaves you private and never re-prompts; profile toggle still
  works.
- Effort: S.

### PR #7 — Phase 4: Head-to-Head fitness compare (UI)   TIER-2 · CLEAR
Wire `getH2hMatchFitness` into `HeadToHead.jsx` (901 lines, high-traffic) as a new "WHO
WORKS HARDER" section reusing the existing delta-row pattern + period pill — Distance
(`formatDistance`) / Avg HR / Calories rows, `--green` on the winner's side. Non-consenting
opponent → graceful "not sharing" state, H2H otherwise unchanged. Same-format guard (don't
compare indoor 5s distance to outdoor 11s — OQ).
- Gates: check-build/lint/hygiene, Playwright smoke of H2H, casual-regression.
- Done-check: two consenting players show side-by-side fitness over the selected period; a
  non-consenting opponent shows the "not sharing" state; the rest of H2H is byte-unchanged.
- Effort: M.

### PR #8 — Per-match "Top Runner" highlight (match result)   TIER-2 · CLEAR
In `PerMatchFitnessCard` (HistoryView result card), add a "🏃 Top runner this game: Sam ·
3.2 mi" highlight + a compact per-player distance rank of the squad in THAT match. Reuses the
already-fetched `getMatchHealthForMatch(matchRef)` rows (mig 456, LIVE) — **no new RPC** —
so consent-gating + casual-only + the U18 read-guard (retrofitted in PR #5) are all inherited.
Distance via `formatDistance`. Also surface avg-HR / calories toppers if that reads well.
- Gates: check-build/lint/hygiene, Playwright smoke of the result card (populated + empty +
  single-consenter), casual-regression.
- Done-check: a casual match with ≥2 consenting players shows the top-runner highlight ranked
  by distance; a match with only self shows just your own line (no "top runner" singling-out);
  non-consenters absent; empty self-hides.
- Effort: S.

### PR #9 — Phase 5: Squad fitness board + detach + admin glance (UI)   TIER-2 · CLEAR
Wire `getSquadFitnessLeaderboard` into the PR-3 StatsView MATCH FITNESS section — averages
board + celebrated most-improved % + consistency (the attendance/"Local Legend" analog so a
**watch-less regular still ranks** — LOCKED DECISION #7), `is_self` highlighted, min-N floor
respected (client + server). Casual-only, consent-gated, U18-excluded — all server-enforced;
UI just renders `rows`. Also in this PR (all reuse the shipped readers, no new RPC):
- **Detach affordance** on `PerMatchFitnessCard` — "remove / re-attach this workout" calling
  `deleteMatchHealthSession` (mig 475). The reverse path (LOCKED DECISION #8).
- **Non-watch framing** — a member with no sessions shows "add an Apple Watch to join",
  never a blank/zero row; they still appear in the squad-total aggregate.
- **Admin glance (the admin wow)** — a one-line "squad ran 26 mi tonight, up on last week"
  read off `get_squad_fitness_leaderboard` totals on the admin match card. Screenshot-ready
  for the group chat. No new query.
- Gates: check-build/lint/hygiene, Playwright smoke of StatsView + AdminView, casual-regression.
- Done-check: board lists only consenting squad members + watch-less members shown as
  invited (not blank); board hides below the min-N floor; detach removes a wrongly-attached
  workout + its route; admin card shows the squad-total line; StatsView baseline unchanged.
- Effort: M/L.

### PR #10 — Privacy copy for the comparison purpose   🚦 TIER-3 (decision) · CLEAR
Small `Legal.jsx` copy add covering the *comparison/ranking* purpose (viewer receives
others' consented special-category data) IF legal says it's needed. **Gated on G-Legal**
— do not ship until the operator returns the legal/DPIA decision.
- Gates: check-hygiene, check-build.
- Done-check: legal sign-off recorded; if copy needed, the added sentence is live before
  the cross-player PRs (#7/#8/#9) reach real users (i.e. before `VITE_HEALTH_KIT_ENABLED` flips).
- Effort: XS.

---

## 🚦 GATES THE LOOP MUST STOP AT

- **G1 — Migration 475 apply** (after PR #5 EV passes): operator reviews + applies. New
  SECDEF readers + a detach write RPC over special-category health data → never
  auto-applied. Re-confirm 475 free on live first.
- **G-Legal — Privacy/DPIA sign-off** (before the cross-player PRs #7/#8/#9 reach real users):
  does surfacing *other players' ranked/compared* fitness to a viewer need one added
  privacy-policy sentence + a DPIA addendum for the comparison purpose (venue/club =
  controller)? Human/legal decision — the loop drafts the sentence and STOPS.
- **Shared with the capture epic:** flipping `VITE_HEALTH_KIT_ENABLED=true` (operator, at
  the capture epic's G5) is what makes any of this visible to real users. Not owned here.

**EXPECTED-STOPS = 2** (G1 migration apply at PR #5 + G-Legal sign-off at PR #10). The other
eight PRs are app-side → dev-loop auto-runs each to a PR, human merges. No native binary, no
auth/money → the
Apple freeze stays un-rearmed throughout.

## DONE =
PR #1–#10 merged (PR #5 applied at G1, PR #10 resolved at G-Legal); distance shows in miles
everywhere; logging is one-tap on next open; players are asked once to share and can find the
toggle any time; a MATCH FITNESS section with a trend-vs-baseline graph lives in StatsView;
the match result shows who ran the most that game; H2H shows
per-opponent fitness; the squad board shows averages + most-improved consent-gated and
casual-only; every surface self-hides dark until `VITE_HEALTH_KIT_ENABLED` flips. Real-device
walk of the auto-attach flow folds into the capture epic's owed G5 (no new Apple submission).

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

- **MISSED (folded back in):** the **undo/reverse path had no RPC.** LOCKED DECISION #2
  originally promised "auto-attach with undo," but `save_match_health_summary` only upserts
  and the sole `DELETE FROM match_health_sessions` lives inside the two account-deletion RPCs
  (wipes ALL rows) — there is no single-session detach. Resolved: Phase-1 primary path
  softened to **one-tap confirm** (nothing to undo → PR #1 stays pure JS), and a
  `delete_match_health_session` **write** RPC added to mig 475 (PR #4) so a wrongly-attached
  workout is removable and the silent-auto-attach variant is unblocked later. Lesser misses
  noted as OQs: keeper/low-mobility players look "unfit" (mitigated by the "many paths to a
  win" framing, not fully solved), and a leaver's board disappearance relies on the live
  consent-join (holds only while the row exists, not merely dormant).
- **OPPORTUNITY:** the pre-bucketed `buckets[]` readers make **Ask-the-Gaffer fitness
  briefings nearly free.** `GAFFER.md` already defines `gaffer_get_context_*` RPCs + an
  `ai_briefings` surface; a thin `gaffer_get_context_fitness` wrapper turns the series into
  "you've out-run your H2H rival three games running / the squad's up 8% this month" — a
  retention push loop and a **sales/demo wow** no siloed competitor (Strava, Apple Health)
  can match, because only In-or-Out holds fitness + fixture + opponent + squad in one place.
  Second, near-free later: a venue **reception-display** squad-fitness board off the same
  leaderboard reader (FEATURES.md reception-display epic). Both are cheap ONLY because PR #4's
  readers are shaped gaffer-consumable now — so shape them that way (recorded in RPCS.md).
- **FUTURE-PROOF (the one lever):** **`source_counts` (watch_app vs apple_health_manual)
  baked into every bucket at mig-475 time** — plus the `period_start` ISO on each bucket.
  `p_period` + `buckets[]` is table stakes; the genuinely cheap-now/expensive-later choice is
  `source_counts`, because the sessions array does NOT carry `source` today, so adding it
  later is a return-shape change rippling across five recorded consumers (HR#12/#14). Locking
  it in the first cut future-proofs watch-vs-manual badging and "verified-watch" credibility
  for zero extra cost. `period_start` similarly lets the SAME reader feed weekly/monthly/
  seasonal graphs without a mig-476 re-shape.
- **WOW per audience:** *Casual player* — "your avg HR is down 8bpm over 6 weeks, you're
  getting fitter" + the fittest-match hero (self-referential, screenshot-worthy, zero shame).
  *Squad-as-unit* — the most-improved / consistency crown. *Admin* — was THIN; added the
  one-line "squad ran 26 mi tonight, up on last week" glance on the admin match card (PR #8),
  screenshot-ready for the group chat, off the existing reader. *Non-watch majority* (the
  unnamed audience the fan-out missed) — was an active demotivator; reframed so a watch-less
  regular ranks on **attendance/consistency** and still counts in the squad total, turning a
  sparse board from exclusionary to inclusive (LOCKED DECISION #7).

## Related
- `MATCH_WORKOUT_TRACKING_HANDOFF.md` — the capture+storage pipe this builds on (mig 456/457).
- `rls_migrations/456_*`, `457_*` — shipped storage + consent + readers.
- `project_match_workout_tracking` / `project_watchos_companion` memories — pipe + watch epic.
- `IO_INTELLIGENCE.md` — H2H period/matchMap model the fitness dimension plugs into.
- `GAFFER.md` — the AI briefing layer that can consume `buckets[]` later.
