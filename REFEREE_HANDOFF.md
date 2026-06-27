# REFEREE EPIC — handoff

Referee experience inside the unified `/hub` mobile app + the standalone `apps/ref`
officiating tool. Track 1 (the referee home) is SHIPPED; four follow-on PRs are scoped
below, each to land as **its own PR**.

---

## SHIPPED (merged to main)

- **Referee role in `/hub`** (PR #133, mig 440 demo seed): `nav.js` resolves a `referee`
  role from `world.ref_assignments`; new `mobile/screens/RefFixtures.jsx` ("My fixtures",
  Live now / Upcoming via `getMyAssignments(null)`) + `mobile/screens/RefMatch.jsx`
  (full-screen overlay that **iframes** the existing `apps/ref` officiating view, kept
  100% untouched); ProfileSheet referee hat switches in-place.
- **Auto-link on sign-in** (PR #133): `App.jsx` world-load calls `refLinkSelfToOfficial()`
  before `get_my_world()` — an email-matched `match_officials` card auto-links
  (`user_id` set → trigger fills `person_id`) so a referee's fixtures + Referee hat appear
  with zero manual setup. Best-effort, idempotent, no-op for non-referees.
- **`apps/ref` LiveMatch polish** (PR #134): home/away unified with a "vs" divider,
  flat scroll-body background, GOAL button = tracked uppercase text (no icon).
- **Push-notify the ref on assignment** (PR #1 of this epic): when a venue assigns a
  referee (`venue_assign_ref` → `fixtures.official_id`, or `assign_casual_match_ref` →
  `matches.ref_player_id`), the newly-assigned ref now gets a push deep-linking into
  `/hub/fixtures`. **Pure delivery-layer change — no migration, no RPC, no schema.** The
  assign RPCs already audited the assignment; the gap was only that `dispatchRefAssigned`
  (in `api/cron.js onboardingEmailJob`, every-tick, 20-min audit-poll) hardcoded
  `push:false`. Now `push` is a real channel via the existing `pickChannel`, keyed on the
  ref's auth `user_id` (`match_officials.user_id` / `players.user_id`) and resolved by a
  new auth-user push mode in `api/notify.js` (`{ authUserIds, payload }`, CRON_SECRET-
  gated — refs needn't be club members so it bypasses the `member_profiles` hop). Honours
  `preferred_channel` (default `push`); falls back to email/SMS/WhatsApp when no live sub.
  Covers re-assignment (`fixture_ref_changed` / `casual_ref_changed` added to
  `ONBOARDING_ACTIONS`, notifying the NEW ref); clears are not notified. Per-channel dedup
  via `notification_log`. Gates: `node --check` both files, app build, `pickChannel`
  routing unit test (8/8). ⛔ owed: real-device push walk (web-push + APNs need a real
  subscription endpoint — not exercisable headlessly).

## KEY AUDIT FACTS (load-bearing — don't re-derive)

- **Reader:** `get_my_assignments(p_role_filter)` (mig 372, SECDEF, **authenticated-only**,
  ⚠️ **Swift-locked shape — DO NOT change it**) returns Live + Upcoming only
  (`status IN scheduled|allocated|in_progress`, future-or-live). NO completed games.
- **Resolves the ref** via `match_officials.person_id = (person of auth.uid())`.
  `person_id` is filled by trigger `trg_match_officials_person_id` when `user_id` is set.
- **Linking:** `ref_link_self_to_official()` (mig 369) matches `lower(auth email)` →
  `match_officials.email`, sets `user_id`. Now called on every world-load (PR #133).
- **Officiating view:** token-driven `get_fixture_state_by_ref_token(token)` → `apps/ref`
  PreMatch/LiveMatch/PostMatch. Embeddable (no frame headers). `REF_APP_BASE =
  VITE_REF_APP_URL || https://platform-ref.vercel.app`.
- **Push infra:** member push subscription = `register_member_push_subscription` (mig 422,
  keyed on auth.uid()); the `/hub` ProfileSheet notifications toggle already registers it
  for any role incl. referee. Send pipeline = `apps/inorout/api/notify.js` +
  `packages/core/notifications/notify.js` (+ `apps/inorout/api/cron.js`). Server-side
  fire-and-forget RPCs must INSERT into `audit_events` (Hard Rule #9).
- **`match_officials` columns:** `id, venue_id, name, phone, email, whatsapp_number,
  preferred_channel, employment_type, active, overall_rating, user_id, person_id`.
- **Assignment delivery TODAY:** setting `fixtures.official_id` does NOT notify the ref.
  The per-match `/ref/<TOKEN>` link is shared **manually** by the operator (no auto-send).
- **Demo:** `tarny+demo` (person `c029db7a…`) is a seeded referee (mig 440: a match_official
  @demo_venue + 3 fixtures in the 3v3 league, comp `3a3a…010`). Password `DemoBoss1!`.
  Test via 127.0.0.1 (not localhost = admin backdoor); clear stale PWA SW first.

## Next free migration = **442**.

---

## ROADMAP — four PRs, in priority order

### PR #1 — Push-notify the referee on assignment  ✅ SHIPPED (see SHIPPED section above)
Delivered as a pure delivery-layer change (no migration). League + casual arms both
covered; push deep-links to `/hub/fixtures`; honours `preferred_channel` with email/SMS
fallback; re-assignment notifies the new ref; per-channel dedup. ⛔ owed: real-device walk.

### PR #2 — History / Past matches in the ref view  ✅ SHIPPED
New reader `get_my_officiating_history(p_limit?)` (mig 441, SECDEF STABLE, authenticated-
only, read-only — **separate** from the Swift-locked `get_my_assignments`). Two person-keyed
arms mirroring mig 372 but TERMINAL only (league `fixtures.status='completed'`; casual
`matches.winner IS NOT NULL`); per-game shape = the assignments shape PLUS
`home_score`/`away_score`, most-recent-first, capped at `p_limit` (default 50). Surfaced as a
muted read-only "Past" section in `RefFixtures.jsx` (final score badge + date + venue) under
Live now / Upcoming. Tapping reuses the existing RefMatch overlay → `/ref/<ref_token>`; the
ref app already routes `completed → PostMatch`, so it opens read-only with `apps/ref`
untouched. Mig 441 also seeds 2 completed league fixtures for the demo ref (mig 440 had
live+upcoming only). Gates: build, hygiene 7/7×3, casual-regression (no `views/` touched,
additive core), rpc-security-sweep (clean), Playwright /hub ref smoke PASS (Past renders 2
games w/ scores → tap → read-only PostMatch). No write → EV N/A. Wrapper
`getMyOfficiatingHistory`; RPCS.md updated.

### PR #3 — Availability + accept/decline  ✅ SHIPPED
The FIRST referee PR that WRITES. mig 442 adds two RPC-only tables —
`ref_assignment_responses` (accept/decline; absent row = pending) and `ref_unavailability`
(blackout date ranges) — kept ISOLATED so the security-sensitive assign RPCs
(`venue_assign_ref`/`assign_casual_match_ref`) and the Swift-locked `get_my_assignments`
stay UNTOUCHED (a re-assignment naturally reads "pending" for the new ref — no reset logic).
Three write RPCs (`ref_respond_to_assignment`, `ref_add_unavailability`,
`ref_remove_unavailability` — all SECDEF, authenticated-only, each INSERTs audit_events,
Hard Rule #9) + two readers (`get_my_ref_status` for the ref, `venue_get_ref_responses` for
the operator). Resolution mirrors mig 372/441 (`auth.uid()`→`people`→`match_officials`/`players.person_id`).
Frontend: RefFixtures gains Accept/Decline on each UPCOMING row (live/past excluded) +
a "My availability" panel (add/remove blackout ranges); venue FixtureCard shows a ref-response
chip (✓ accepted / ✗ declined) and FixtureActions flags an official who's unavailable on the
fixture's date. Both works LEAGUE + CASUAL for the ref's accept/decline; the operator-facing
"see the response" surface is LEAGUE-only this PR (casual is squad-admin-assigned — the
squad-admin response surface is deferred to a follow-up). Gates: build ×2 clean, hygiene 7/7,
rpc-security-sweep (5 RPCs: 4 authenticated-only, 1 venue-token anon+auth, all SECDEF +
search_path), ephemeral-verify PASS (10 assertions incl. 5 error-paths + unauth, leak-check 0),
casual-regression (additive core only, no `views/` touched), Playwright /hub ref smoke PASS
(Referee hat → Live/Upcoming(accept/decline)/Past/Availability all render; Accept persisted to
DB + audit_events live). ⛔ owed: real-iPhone referee walk; squad-admin casual response surface.

### PR #4 — Tournament officiating
Currently excluded: tournament fixtures aren't assigned via `match_officials`, so they never
appear in `get_my_assignments`. Decide the model (extend the reader's union with a tournament
arm, or a parallel assignment table) so tournament refs get the same `/hub` home. Tournament
live scores currently poll (ref tournament RPCs don't broadcast yet).

## Also flagged (not yet scheduled)
- **Onboarding edge:** auto-link needs the venue to assign by the **same email** the ref
  signs in with. Phone/name-only assignment or a different email → no auto-link. Consider a
  phone-match fallback or invite-code claim.
- **Ratings/profile:** `match_officials.overall_rating` exists but isn't surfaced (show the
  ref their rating; let venues rate post-match).
- **Apple Watch ref stats:** data-ready (mig 372 built as the shared source for `apps/ref`
  + watchOS; migs 369/375). Native watch phases gated on iOS App Store approval.
- ⛔ Owed: real-iPhone referee walk (cross-origin iframe in WKWebView).
