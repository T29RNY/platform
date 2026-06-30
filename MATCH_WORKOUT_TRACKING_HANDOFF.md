# Match Workout Tracking — Epic Manifest

*Scoped 2026-06-30. Audit + plan only — no code yet.*
*Runs as an UNMANNED epic loop: `/loop /dev-loop MATCH_WORKOUT_TRACKING_HANDOFF.md`.*
*Each `### PR #n` = one dev-loop cycle → one PR. The loop stops at every gate marked*
*🚦 (human / Mac / Apple / migration-apply). PR-only; never pushes main; never applies*
*a migration or touches RLS/auth/health-data without explicit sign-off.*

---

## WHAT IT IS (plain English)

A player records their match as an Apple workout on their Apple Watch (Apple's own
Workout app). Our iPhone app **reads Apple Health, finds that workout, matches it to
the game** (by time, GPS as tiebreaker), and pulls the stats — distance, heart rate,
calories, route/heatmap — into the player's profile, the match result, and a running
history. Casual squad data accumulates for a future head-to-head view. Refs and casual
players with watches get the same. **We build NO tracking — Apple measures everything;
we read the summary and display it.**

**Two phases, ONE data pipe:**
- **Phase 1 (this manifest):** iPhone reads Apple Health + matches to game. Works TODAY
  with any Apple Watch + Apple's stock Workout app — no watch app needed.
- **Phase 2 (later, [[watchOS companion]] epic):** the watch app auto-starts/stops the
  Apple workout so the player needn't remember. Same pipe; convenience layer only.

## LOCKED DECISIONS (operator, 2026-06-30)

1. **Routes / heatmaps IN** (outdoor only — GPS).
2. **Team tally = CASUAL only, STORE-NOW / DEFER-DISPLAY.** Capture + attribute per
   player per match; **no team-tally screen in this epic**; display folds into
   head-to-head later (`IO_INTELLIGENCE.md`). League = private to the player.
3. **WATCH ONLY — phone never tracks.** No phone-GPS capture.
4. **Indoor = HIDE distance** (no GPS); HR / calories / duration still show. No map indoor.
5. **Indoor/outdoor preference remembered PER RECURRING GAME** → drives the Phase-2 watch
   auto-start, one-tap override. Lives in our app, not Apple Health.
6. **Teammate-sharing CONSENT toggle** — "share my match fitness with my squad", default
   OFF. Stored now even though display is deferred (consent must exist before any sharing).
7. **NEVER gather health data for under-18s.** The save RPC blocks under-18 where DOB is
   known; the client only offers the feature to users confirmed 18+.

## KEY AUDIT FACTS (load-bearing — don't re-derive)

- **Next free migration = 456.**
- **Existing backend (mig 375, reusable):** `match_health_sessions` (RLS-on, NO policies,
  RPC-only): `user_id→auth.users ON DELETE CASCADE`, `match_context` CHECK
  (`league|casual|cohort`), `match_ref`, `client_session_id`, `duration_seconds`,
  `active_energy_kcal`, `distance_meters`, `avg_hr`, `max_hr`, `hr_zones` jsonb,
  `started_at`, `ended_at`; `UNIQUE(user_id, client_session_id)` = offline idempotency.
  RPCs `save_match_health_summary(...)` (idempotent upsert, audit_events, authenticated-
  only SECDEF) + `get_my_match_health()` (`{ok,sessions,totals}`). JS wrappers
  `saveMatchHealthSummary`/`getMyMatchHealth` (`packages/core/storage/supabase.js`
  ~L3029, barrel). Surface = "YOUR MATCH FITNESS" card `MyIOView.jsx` ~L775 (self-hides
  when empty). **UK-GDPR delete-cascade already wired into BOTH `delete_my_account_auth()`
  and `delete_my_account(p_token)`.**
- **Idempotency key = `HKWorkout.uuid`** → feed it as `client_session_id` so re-syncing
  the same workout can never double-count.
- **Match time anchors:** casual = `matches.actual_kickoff_at` (set when game goes live)
  + `game_is_live`; fallback `matches.match_date` (date only) + remembered usual time.
  League = `fixtures.scheduled_date` + `fixtures.kickoff_time`. `match_ref` = `matches.id`
  (text) for casual, `fixtures.id` (uuid) for league.
- **DOB source = `member_profiles.dob` (date, NULL).** Casual players often have NO
  member_profile → DOB unknown. Guard: block under-18 where DOB known; client confirms
  18+ where unknown.
- **HealthKit gotchas (bake into UX):** (a) read-denial is INVISIBLE — "no workouts" can
  mean denied OR none; (b) watch→iPhone Health sync has a delay (retry, don't flat-fail);
  (c) indoor = same "Soccer" type + indoor location flag, no GPS.
- **iPhone reads Health; iPhone app surfaces read ONLY our backend.** iPad has no HealthKit
  (app is iPhone-only). Native plugin pattern = mirror `apps/inorout/ios-plugins/AuthSession/`
  (Swift `CAPPlugin` + `.m`, lives OUTSIDE gitignored `ios/`, dragged into the Xcode target).
- **Whole feature ships DARK** — every surface self-hides until native ingestion feeds data,
  so app-side PRs are prod-safe during the Apple-review freeze.

---

## ROADMAP — PRs in dependency order

### PR #1 — Storage migration (456)  🚦 TIER-3 (migration apply + RLS + health data = sign-off)
Loop drafts the `.sql` (+ `_down.sql`), runs ephemeral-verify against live DB w/ rollback,
then **STOPS at the apply sign-off gate** (does NOT apply).
- `match_health_sessions`: add `source text` (e.g. `apple_health_manual` | `watch_app`).
- NEW table `match_health_routes` (`id uuid pk`, `session_id uuid→match_health_sessions(id)
  ON DELETE CASCADE`, `track jsonb`, `captured_at timestamptz`), RLS-on, NO policies (RPC-
  only). Separate table = stats stay lean, route ages-out independently, cascade auto-deletes.
- NEW consent store: `players.share_match_fitness boolean NOT NULL DEFAULT false`
  (decision #6; default OFF = byte-identical privacy-safe).
- Under-18 guard helper (resolve caller age via `member_profiles.dob` when present).
- Extend `save_match_health_summary`: ADD `p_source`, `p_route jsonb` (writes
  match_health_routes), and the **under-18 block** (reject if DOB known & <18). Additive
  params only (HR#12 — additive safe; record watch consumer in RPCS.md). DROP old overload.
- NEW reader `get_match_health_for_match(p_match_ref)` — per-match card; own row always;
  teammate rows ONLY when `match_context='casual'` AND that player's `share_match_fitness`.
- NEW reader `get_match_route(p_session_id)` — heatmap, own only.
- Generalise `get_my_match_health()` wording ref→any-player (no shape change).
- Gates: rpc-security-sweep (all SECDEF, anon-revoked, search_path, single overload),
  ephemeral-verify (assert: idempotent upsert, route cascade-delete, under-18 reject,
  consent gating on the casual reader, DOB-unknown path, leak-check 0), build.
- **STATUS: DRAFTED + EV-PASSED (loop, dev cycle). `needs-human: G1 migration apply + PR merge.`**
  Migration `456_match_health_routes_consent_source.sql` (+ `_down.sql`) written. EV ran the full
  object set inside a rolled-back transaction (objects impersonated via `request.jwt.claims`): all
  8 assertion groups PASS (A dob-unknown save, B idempotent upsert, C route+owner-read, D route
  own-only, E under-18 blocked + adult-known allowed, F invalid-source rejected, G consent gating
  [self+consenter shown, non-consenter hidden, self-first], H route cascade-delete). Leak-check =
  0 (incl. `source` column + `match_health_routes` table = 0 → confirms NOT applied to live; G1
  intact). rpc-security verified STATICALLY (all 4 new SECDEF fns: search_path pinned, anon-revoked,
  single overload, no PUBLIC grant) — the live `pg_proc` sweep is owed at apply (functions don't
  exist on live until G1). **The loop STOPS here. Operator: review + apply 456 at G1, then merge PR.**

### PR #2 — JS wrappers + barrel  (app-side)
Wrappers `getMatchHealthForMatch`, `getMatchRoute`; extend `saveMatchHealthSummary`
(source + route). Barrel exports. Gates: `node --check`, build. (Dark — nothing calls them yet.)

### PR #3 — Display: per-match result card + heatmap + history wording  (app-side, ships DARK)
- Per-match result card reads `get_match_health_for_match`; self-hides when empty.
- Heatmap render (outdoor only). Indoor: hide distance, show "no route" not an empty map.
- Generalise "YOUR MATCH FITNESS" card ref→any-player.
- Gates: hygiene, build, Playwright /MyIO + match-result smoke against SEEDED rows.

### PR #4 — Consent toggle UI  (app-side)
"Share my match fitness with my squad" toggle in player profile → writes
`players.share_match_fitness` (default OFF). Gates: hygiene, build, Playwright (toggle
persists). (Casual-only relevance; display still deferred.)

### PR #5 — Dormant native HealthKit plugin source + JS bridge  🚦 build/entitlement = Mac gate
Loop WRITES the source (uncompiled reference, like AuthSession); cannot compile/entitle.
- `apps/inorout/ios-plugins/HealthKit/HealthKitPlugin.swift` + `.m` — request READ auth for
  workouts + distance/HR/active-energy + route; `queryWorkouts({fromISO,toISO})` →
  summaries; `queryRoute({workoutUuid})` → coordinates. Lives OUTSIDE gitignored `ios/`.
- `apps/inorout/src/native/native-health.js` — JS bridge, `isNativeApp()`-gated, no-op on web.
- README with Mac activation steps (entitlement, Info.plist string, drag into target, cap sync).
- Gates: `node --check` the JS, build clean (Swift not in CI). 🚦 STOPS — native wiring is G2/G3.

### PR #6 — Match-to-game logic + confirm flow  (app-side; real-device proof = G5 gate)
- ⚠️ **AUDIT FLAG (found by loop during PR #1, verify at PR #6 audit):** `matches.actual_kickoff_at`
  and `matches.game_is_live` — named as load-bearing in KEY AUDIT FACTS — **do NOT exist** on the
  live `matches` table (only `id`, `team_id`, `match_date` confirmed). PR #6 must re-derive the real
  casual kickoff anchor (likely a settings/schedule "usual time" + `match_date`, or a column named
  differently) before building the time window. Does NOT affect PR #1 (migration never referenced them).
- Given a game, build the time window (casual `actual_kickoff_at`→now/+duration, fallback
  `match_date`+remembered time; league `scheduled_date`+`kickoff_time`), query Health via the
  PR-5 bridge, **match by time + GPS tiebreaker**.
- Robustness (KEY AUDIT FACTS): sanity-clamp duration (min floor + forgot-to-stop ceiling);
  dedup on `HKWorkout.uuid`; sync-delay retry; denied-vs-empty ambiguity → "check Health
  permissions" path; **trim stored route to the game window** (don't leak home→pitch street).
- Confirm prompt ("found a 58-min workout during your 7pm game — add it?") → post via
  `saveMatchHealthSummary` (source=`apple_health_manual`, route).
- Multiple-workout disambiguation picker; backfill recent past games; un-attach / re-attach.
- **Under-18 client gate** (only offer if 18+ confirmed; RPC also blocks).
- Gates: hygiene, build, Playwright smoke with MOCKED Health responses (found / none /
  multiple / denied / too-long). 🚦 real-device walk owed at G5.

### PR #7 — Indoor/outdoor preference per recurring game  (app-side; Phase-2-coupled)
Store the preference keyed to the recurring game (casual ≈ `team_id` [+ optional day-of-week];
league ≈ competition). Drives the Phase-2 watch auto-start; harmless dark until the watch app.
⚠️ Confirm the recurring-game key at audit (no first-class "recurring game" row exists — team
is the practical key for casual). Gates: hygiene, build, Playwright.

---

## 🚦 GATES THE LOOP MUST STOP AT (human / Mac / Apple)

- **G1 — Migration 456 apply** (after PR #1 EV passes): operator signs off + applies. RLS +
  special-category health data → never auto-applied.
- **G2 — Apple Developer portal:** add **HealthKit** to App ID `uk.inorout.app`; regenerate
  the provisioning profile. (Operator.)
- **G3 — Mac / Xcode:** Info.plist `NSHealthShareUsageDescription`; drag the PR-5 plugin into
  the App target; `npx cap sync ios`; archive → TestFlight. (Operator, build machine.)
- **G4 — App Store submission** (re-arms the review freeze): privacy-policy "Apple Health"
  section in `Legal.jsx` (loop CAN draft the copy as its own app-side PR), App Privacy
  "Health & Fitness" answers, reviewer note (write-of-our-own-summary, read-only of Apple
  workouts, no ads/data-mining, not stored in iCloud). Operator submits.
- **G5 — Real-device walks (Hard Rule #13):** grant/deny HealthKit; record an Apple Soccer
  workout (outdoor + indoor); match-to-game + confirm; heatmap (outdoor) / no-route (indoor);
  under-18 block; multiple-workout picker; web/PWA no-op; sync-delay retry.

## LOOP PROGRESS LOG (unmanned dev-loop)
- **PR #1 ✅ DONE** — mig 456 applied to live (G1 cleared by operator) + merged (#167, 085dade).
  Live rpc-security sweep PASS. The storage spine is live.
- **PR #2 ✅ DONE** — JS wrappers + barrel merged (#168, d5ca110). `getMatchHealthForMatch`,
  `getMatchRoute`, `saveMatchHealthSummary(+source,+route)`. Dark.
- **PR #3 ◻ IN PR** — display components (this PR). `MatchRouteHeatmap.jsx` (SVG, outdoor-only) +
  `PerMatchFitnessCard.jsx` (reads `getMatchHealthForMatch`; self-hides empty; indoor hides
  distance/route; own-only route reveal) + "YOUR MATCH FITNESS" card generalised ref→any-player.
  Built as **Option A**: reusable components shipped DARK + UNMOUNTED (no casual match-result
  surface exists to host them — see below); the MyIOView wording is the only live-visible change.
  Gates: hygiene 7/7, build PASS, esbuild compile+import-resolve PASS, ship-safety CLEAR, QA review
  clean. **Owed at PR #6:** render-with-data Playwright (mount the card + mocked Health responses) —
  the manifest already scopes that for PR #6; the components are unmounted until then.
  ⚠️ **Scope note for PR #6:** there is NO casual match-result view in apps/inorout (casual flow ends
  at AdminView scoring). The only existing per-match surface is league `FixtureDetailCard` (private to
  player). PR #6 (or a dedicated casual result surface) must decide where `PerMatchFitnessCard` mounts
  for casual. Operator endorsed Option A (defer casual host) by re-issuing the loop.

## DONE = Phase 1
PR #1–#7 merged (PR #1 applied at G1), G2–G4 cleared, the app live in the App Store with
HealthKit, and the G5 device walks signed off. **Phase 2 (watch auto start/stop using PR #7's
preference) = the separate [[watchOS companion]] epic.**

## Related
- `rls_migrations/375_match_health_sessions.sql` — existing storage spine.
- `project_watchos_companion` memory + `WATCH_DESIGN_HANDOFF.md` — Phase 2 capture.
- `project_native_app_wrap` memory + `APP_STORE_CHECKLIST.md` — native build / submission.
- `IO_INTELLIGENCE.md` — head-to-head, where the casual team data surfaces later.
