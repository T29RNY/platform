# In or Out — Known Bugs & Tech Debt
*Last updated: Jun 18 2026 (session 149 — CLASSES OPEN/FREE/TRIAL ACCESS SHIPPED (mig 360) — NO new production bugs. Closes the s148 OPT-IN FOLLOW-UP: the classes epic now supports open/free/trial via a per-class-type `venue_class_types.members_only` flag (additive NOT NULL DEFAULT true → existing classes byte-identical). AUDIT CORRECTION to the handoff's "three gate sites": the live `member_claim_waitlist_spot` body has NO membership check (it only validates the existing `offered` row, which inherited the booking gate), so it needed NO change; `member_purchase_class_package` left member-only (operator s149 — packs stay members-only); only `member_book_class_session` changed (membership EXISTS wrapped in `IF COALESCE(members_only,true)`). An ACCOUNT (auth.uid→member_profiles) is NEVER dropped. Flag plumbed through venue_create/update/list_class_type + member_list_class_sessions; operator toggle in ClassesView, member CTA in ClassesTimetable. All gates passed: rpc-security PASS (5 RPCs single-overload/SECDEF/search_path/grants; old 10-arg venue_create_class_type DROPped), EV 5/5 + leak 0 (non-member books open-paid→£10 door charge; open-free→waived/no charge; rejected on member-only; member books member-only; column default true), casual-regression PASS via additive-diff (no casual surface touched — only ClassesTimetable labels + class-type wrapper), boot smoke clean, build inorout+venue + hygiene 7/7. ⛔ real-iPhone PWA walk OWED (a signed-in NON-member books an open class). **Next free mig = 361.** PRIOR session 148 — GYM/BOXING VERTICAL Phase 4 SHIPPED (mig 359, bout / fight record + sparring stats) — **THE VERTICAL IS COMPLETE (Phases 0–4).** NO new production bugs; EV caught + fixed ONE pre-commit consistency gap before any commit: the member-facing headline W-L-D counted sparring rows while the operator list excluded them — folded the `NOT is_sparring` filter into the source as 359b so both reads agree (sparring surfaced separately as `sparring_count`). ONE new RLS-walled table `member_bouts` (soft-void via `voided`, never hard delete; W-L-D-NC derived over non-voided non-sparring rows) + DORMANT additive `player_match.sport_stats`/`matches.sport_stats jsonb` (0 pg_proc refs — football result cascade proven byte-unchanged in casual-regression). 5 new RPCs: operator `venue_record_bout`/`venue_update_bout`/`venue_delete_bout` (soft-void) gated `manage_facility` + audited; reads `venue_list_member_bouts` (operator, incl voided) + `member_get_fight_record` (member via pass_token, excludes voided). Operator: per-member "Fight record" modal in MembershipsView (`FIGHT_RECORD_DISCIPLINES=['boxing']`). Member: MemberProfile "Fight record" section (disciplineLabels.hasFightRecord; boxing only). All gates passed (rpc-security PASS 5 RPCs single-overload/SECDEF/search_path/grants, EV 10/10 + leak 0, casual-regression PASS via additive-diff — only MemberProfile touched + gated on hasFightRecord, sport_stats invisible to all RPCs, no casual football surface touched — Playwright boot smoke 0 app errors, build inorout+venue + hygiene clean). ⛔ real-iPhone PWA walk OWED (MemberProfile Fight record section; needs an authed member on a boxing club). The OPT-IN FOLLOW-UP below (classes free/trial `members_only`+price-0 levers) is now PLANNED for the NEXT session — operator opted in s148; full scope + live audit facts + a paste-ready next-session prompt are in **CLASSES_OPEN_ACCESS_HANDOFF.md** (3 membership-gate sites to modify: `member_book_class_session` / `member_claim_waitlist_spot` / `member_purchase_class_package`; the `members_only` flag goes on `venue_class_types`; an account stays always-required; mig 360 reserved). **Next free mig = 360.** PRIOR session 147 — GYM/BOXING VERTICAL Phase 3 SHIPPED (mig 358, PT / 1-on-1 appointment booking) — NO new production bugs; EV caught + fixed ONE pre-commit gap: the shared `venue_charges_source_type_check` constraint rejected `'pt'`, so the very first priced booking failed — fixed by extending the allow-list (applied live as 358b, folded into the 358 source). 3 RLS-walled tables (venue_trainers / venue_trainer_availability / venue_appointments, partial-unique one-live-booking-per-slot), 11 new RPCs (4 operator CRUD + venue_pt_checkin + venue_mark_appointment_completed + 4 member + member_list_my_appointments). DEDICATED appointments model (NOT capacity=1 classes — locked in handoff). Money rides the existing venue_charges ledger (source_type='pt', door path; settlement DORMANT until live keys). TWO LEVERS decide who can book: an ACCOUNT is always required (auth.uid → member_profiles); `members_only` per-trainer adds the active-membership requirement — members_only=false + price 0 = a free open session (operator answer s147 "A, but B for trials/one-offs"). Trainer = optional staff login (admin_id nullable → also a no-login coach card). Cancellation cutoff per-trainer (0 = free cancel); no-show keeps the charge + bumps member_profiles.no_show_count. Train tab is discipline-gated via disciplineLabels.hasPT (gym/boxing/martial_arts/fitness) so casual football is byte-identical. Operator: new venue TrainersView (Trainers + Appointments tabs, ClassCheckinScanner generalised with an optional `checkin` cb). Member: new `/book` route + BookPT view + ClubNavBar Train tab. All gates passed (EV 9/9 + leak 0, rpc-security PASS 11 RPCs single-overload/SECDEF/search_path/grants, casual-regression PASS via additive-diff — no casual view touched, App.jsx purely additive — Playwright /book boot smoke 0 console errors, build inorout+venue + hygiene 7/7 clean). ⛔ real-iPhone PWA walk OWED (/book Train tab + booking + operator QR check-in; needs an authed member on a PT-discipline club). OPT-IN FOLLOW-UP (no mig yet): the classes epic still hard-requires membership — retrofitting the same `members_only`+price-0 levers to classes would let venues run free/open or trial classes (operator asked s147); not bundled into 358. **Next free mig = 359.** PRIOR session 146 — GYM/BOXING VERTICAL Phase 2 SHIPPED (mig 357, grading / belt progression) — NO new production bugs; EV caught + fixed ONE pre-commit bug: within a single transaction `now()` is constant so two `member_grades` awards tied on `awarded_at` and "current grade = latest" picked the wrong row — fixed by adding a monotonic `awarded_seq` identity column and ordering "current" by `awarded_at DESC, awarded_seq DESC` (also hardens production against same-microsecond awards). 3 RLS-walled tables (venue_grading_schemes / venue_grades / member_grades append-only), 5 new RPCs + get_member_pass (now returns current `grades[]`) + venue_list_members (additive club_id+discipline) extended. Award authority = existing `manage_facility` cap (operator 1A); ladder = ordered named grades + colour_hex + per-grade max_stripes, award carries capped stripes, age bands = separate schemes (operator 2B + martial-arts research). All gates passed (EV 11/11 + leak 0, rpc-security PASS 6 RPCs, casual-regression PASS via additive-diff — every new inorout render gated on disciplineLabels.hasGrading so casual football is byte-identical — + Playwright boot smoke 0 app errors, build inorout+venue + hygiene clean). ⛔ real-iPhone PWA walk OWED (Pass rank chip + Profile Progression; needs an authed member on a martial-arts club). **Next free mig = 358.** PRIOR session 145 — GYM/BOXING VERTICAL Phase 1 SHIPPED (mig 356, sparring/open-mat class-type flag + member `/classes` route reusing the class-session booking model) — NO new bugs; all gates passed (EV 5/5 + leak 0, rpc-security PASS both modified write RPCs, casual-regression PASS via additive-diff proof, build inorout+venue + hygiene clean, Playwright `/classes` boot smoke 0 console errors). ⛔ real-iPhone PWA walk OWED (new route + ClubNavBar Classes tab; needs an authed member on a non-football club). **Next free mig = 357.** PRIOR session 144 — GYM/BOXING VERTICAL Phase 0 SHIPPED (mig 355, club `discipline` identity) — NO new bugs; all gates passed (EV 7/7 + leak 0, rpc-security/casual-regression/build/hygiene PASS). ⛔ real-iPhone PWA walk OWED (flag-gated, club nav labels). **Next free mig = 356.** PRIOR session 143 — CLUB/MEMBERSHIP SYSTEM AUDIT + 3 FIXES (see SESSION 143 entries below): (1) BST recurring-session timezone bug — venue_create_class_series/club_create_session_series/club_manager_create_session_series stored UK wall-clock as UTC, 1h late in summer, fixed AT TIME ZONE 'Europe/London' (mig 353); (2) multi-club nav residual club[0] in MemberProfile + ClubNavBar (PR #14); (3) MemberPass nav club context via get_member_pass club_id (mig 354). Full end-to-end audit found only these — memberships/scheduling/booking/waitlist/check-in/packages/context-wiring all verified live; multi-sport is dormant scaffolding. Next free mig = 355. PRIOR — session 141 — MULTI-CONTEXT NAV Phase 1 — two pre-existing bugs RESOLVED: (1) MULTI-CLUB SELECTION — a multi-club member tapping a specific club always landed on the FIRST club; SessionsScreen auto-selected only when exactly one club existed and never read the tapped one. Fix: carry the chosen club via `?club=<id>` (switcher + legacy club cards append it) and SessionsScreen pre-selects it (validated against active_clubs). (2) STRANDED CLUB/GUARDIAN USERS — `/sessions` and `/profile` had NO bottom nav and ParentHome's bespoke bar had no way back; a club-only member landing on /sessions was stuck. Fix: shared config-driven NavBar via new `ClubNavBar` (Sessions·Pass·Profile — Pass deep-links via the new active_clubs.pass_token; "Classes" deferred until a /classes route exists) on SessionsScreen+MemberProfile; guardian Home rebuilt child-first on `guardian_list_children_sessions` with the unified NavBar; header-avatar `ContextSwitcher` on squad routes (flag-gated). New squad-route nav ships dark behind `teams.multi_context_nav` (default off) so the footballer's app is byte-identical until enabled per team; club/guardian nav is additive. Build: 8/8 monorepo apps clean; hygiene 7/7 every changed file. ⛔ real-iPhone walk OWED before commit (Hard Rule #13 — App.jsx routing/PlayerView/NavBar touched). session 139 — RESOLVED (mig 348, getHeadToHead/getPlayerLeagueTable): Stats → tap a player → Head-to-Head always showed the empty "you haven't played together" state for EVERY player on the normal player route (/p/<token>), even with shared games. Root cause: `getHeadToHead` only had a SECURITY DEFINER path for ADMIN tokens (mig 041); its fallback read `player_match` directly, but that table has RLS on with NO anon/authenticated select policy, so the reads returned zero rows → totalSharedGames 0 → empty state. On a player route `isAdmin` is false so `adminToken` is null → the dead direct path was always taken. The Stats league table itself still rendered because it's derived client-side from match history, which masked the gap (admin showcase route worked, so it was never caught). Fix: new player-token RPCs `get_head_to_head_raw_by_player_token` + `get_player_league_table_raw_by_player_token` (mirror the mig-041/042 admin variants, resolve team via players.token→team_players), threaded `playerToken` through App.jsx→StatsView→HeadToHead→supabase.js. FOLLOW-UP (commit 28821af): the first pass only wired the STANDALONE `view==="stats"` StatsView in App.jsx — but the Stats screen players/admins actually use is the Stats TAB inside PlayerView (PlayerView.jsx:1640, reached via the navbar and via admin `onGoStats`), which passed only adminToken (null on a player route) and no playerToken, so H2H stayed empty after the first deploy. Fixed by passing PlayerView's own `playerToken` (me.token) to that StatsView render. LESSON: when a shared view (StatsView) is rendered from more than one place, grep `<StatsView` and patch EVERY render site, not just the first one found. Verified end-to-end via the live PostgREST endpoint as anon (token vs Ranny → 2 games, HTTP 200) and confirmed new bundle live. Owed: real-iPhone walk on /p/ link. RESOLVED (no mig, AdminView/POTMTiebreakModal): the ADMIN-facing "POTM TIE — YOUR CALL" modal had NO escape — no ✕, no backdrop close, no scroll, no height cap; the only way out was to lock in a winner, so two admins (incl. Rocky) were trapped behind it and couldn't reach admin options. NOTE: there are TWO POTM modals — POTMVotingModal (player, in PlayerView) and AdminView/POTMTiebreakModal (admin, shown only on a vote tie). The admin "too big / can't tap away" complaint is the TIEBREAK one; the first round of fixes wrongly targeted the player voting modal. Fixed the tiebreak modal: capped to calc(100dvh - 40px) flex column (header + footer pinned, list scrolls w/ iOS momentum), always-visible ✕, tap-backdrop-to-close, "Decide later" footer → new onClose (tie re-surfaces next session until resolved). RESOLVED (no mig, POTMVotingModal): voting modal was too tall for small screens — the card was centred with overflow:hidden so on a big squad the footer (skip/close) was clipped off-screen, scrolling didn't work, and there was no backdrop-tap-to-dismiss → admins were trapped. Fixed: card capped to calc(100dvh - 40px) as a flex column (header + footer flexShrink:0, only the player list scrolls) + tap-backdrop-to-close. RESOLVED (no mig, HistoryView/StatsView): an UNPLAYED match (winner NULL) was classified by getResult() as a "draw", so this week's not-yet-played fixture rendered as an amber 0–0 draw — indistinguishable from a real draw. Split "pending" out from "draw" (winner==='D' only is a draw; null→pending, shown neutral grey "NOT PLAYED YET"/"–") and gave real draws a dedicated teal token --draw (distinct from amber, which also means maybe/won-by). Applied across HistoryView result cards + StatsView W/D/L totals + form dots; league-table form pill left amber (PlayerLeagueTable.jsx has pre-existing hardcoded medal hexes that block clean edits — tokenize separately). RESOLVED (no mig, PlayerView): POTM voting modal never reappeared once dismissed without voting. Root cause: a `localStorage` `ioo_potm_seen_<matchId>` flag (added s80 to stop per-open re-popping) was written the instant the modal first showed, and the show-condition suppressed on seen-OR-voted — so tapping away to open the admin panel killed it permanently. Fixed: gate the show purely on `voted` (server-truth) and drop the seen-flag. Modal now reappears on every app open while voting is live UNTIL a vote is cast, then never again; the `nowOpen && !wasOpen` transition guard still prevents within-session re-pop after a dismissal. RESOLVED (no mig, HistoryView): a DRAW (stored as winner='D') rendered wrong in the expanded result drill-down — margin-mode draws showed the "Won by" pill + "?" ("Won by ?"), and the IO prediction chip read "Predicted: Draw · Result: Team D won" (it treated a draw as winner being empty, and interpolated 'D' as a team name). Fixed both to key off getResult()==="draw": margin draws now show "D", and the chip shows "Draw"/marks a draw prediction correct. Also shipped (mig 347): match RESULT note — admins can attach free-text to a result (e.g. "abandoned early due to injury, declared a draw"); see FEATURES/RPCS. session 137 — no new bugs found or fixed. Phase 4 Stripe test clock lifecycle proven: all 5 state-machine scenarios pass, reconciliation cron verified live at 04:00 BST. Critical operational finding: live Stripe keys must go in `platform-clubmanager` Vercel project, NOT `inorout`. System DORMANT pending operator live-key sign-off. session 136 — RESOLVED (mig 332): `get_venue_signup_tiers` used `status='active'` not `'connected'` to detect Stripe connection — tier picker showed no Stripe fork for any venue. Fixed s135, documented s136. RESOLVED (no mig): Stripe webhook endpoint was a platform webhook, not a Connect webhook — `checkout.session.completed` events from the connected account were never delivered. Recreated endpoint in Stripe Dashboard with "Listen to events on Connected accounts" enabled. RESOLVED (mig 335): `stripe_complete_member_enrolment` had `actor_type='member'` in its audit_events INSERT — violated `audit_events_actor_type_check` constraint; every webhook-triggered enrolment silently failed at the audit step. Same pattern as mig 297 fix but this RPC was missed. Fixed 'member'→'player'. RESOLVED (mig 336): after Stripe redirect back to `?checkout=done`, `passToken` was null (component re-mounts fresh after external redirect) so the "Open your membership pass →" link never rendered. New RPC `member_get_venue_membership_pass` + called on MembershipSignup mount — also handles returning-already-enrolled members.) (session 130 — RESOLVED (mig 328): mig 326 write RPCs (club_admin_set_performance_config, club_admin_add_performance_event, club_admin_record_result) all had audit_events INSERTs missing entity_type + entity_id (both NOT NULL since mig 003). Fixed via CREATE OR REPLACE in mig 328. EV 9/9 PASS, leak-clean. Also in session 130 — RESOLVED (mig 327, caught by EV): all 6 write RPCs in mig 327 had the same bug — fixed before commit.) (session 126 — RESOLVED (mig 323): `club_admin_get_standings` crashed at runtime since mig 320 — joined `public.club_admins` which has never existed in any schema. Replaced with `club_team_managers` guard (correct Phase 1-3 pattern). Also shipped: Phase 7B card tracking + auto-suspension. EV 8/8 PASS, leak-clean.) (session 114 — no new bugs found or fixed. Phase 9 Club Merchandise shipped (mig 309); EV caught + fixed a real runtime bug: `venue_list_merchandise` nested-aggregate in PostgreSQL (COUNT inside jsonb_agg) would have silently errored in production — fixed with inner subquery (mig 309b). No change to open tech-debt list.) (session 99 — RESOLVED (mig 297): all 5 member RPCs used actor_type='member' which violates audit_events_actor_type_check constraint. Caught by ephemeral-verify run. Fixed 'member'→'player' across member_register_child, member_update_child, member_accept_consent (from mig 295) + member_self_create_profile, member_enrol_membership (from mig 296). EV 8/8 PASS, leak-clean.) (session 99 — RESOLVED (mig 295): member_register_child, member_update_child, member_accept_consent audit_events inserts were broken — wrong column names (actor_id/event_type/payload vs actual actor_user_id/action/metadata) plus NULL team_id which is NOT NULL. Rewritten in-place, no schema change, all 3 SECDEF/search_path/overload=1 confirmed post-apply.) (session 98 — found pre-existing bug: audit_events column mismatch in Phase 1–5 member RPCs — those audit inserts fail silently at runtime.) (session 89 — STALE-NOTE SWEEP: verified four "open/owed" items against the LIVE function bodies and closed them as already-fixed — (1) "result-save double-charges guests" NOT a code bug: the is_guest=false guard sits on both the owes bump AND the game_fee ledger insert in every admin_save_match_result since mig 206 (predates the s80 report), through 241, to live mig 268; the observed Little K row was historical/hand-created; (2) "result-save wipes the flat paid flag mid-cycle" RESOLVED mig 241 (live in 268) — paid is derived from a LEFT JOIN onto that match's paid game_fee ledger row so it can't diverge; the entry's heading already said RESOLVED, only the body still read "fix owed"; (3) admin_upsert_schedule one-off-date cast RESOLVED by mig 215; (4) superadmin blank screen RESOLVED s79 / GO_LIVE #13 (the BUGS entry still had an "## OPEN" heading). One real fix: removed the shadowed duplicate `minWidth` key in SquadScreen.jsx (kept 220, which already won) — clears the vite warning. Genuinely-open tech debt unchanged: pg_cron bearer secret hardcoded across 7 jobs; Gaffer top-reliable guest filter (defer to Phase 7). session 88 — RESOLVED (mig 268): drawn teams stayed mutable after kick-off — a post-kickoff injured-toggle silently dropped a player from a locked team. Three fixes: un-injure restores a drawn player to 'in'; a kick-off lineup lock (`is_lineup_locked`, lock point = schedule.game_date_time) on the four self-service lineup RPCs; result-save reconciles orphan player_match rows so flat stats can't diverge. EV'd 9 assertions, leak-clean. session 82 — RESOLVED: "Paid" carried into the next game — go-live now clears per-game payment flags (paid/self_paid/paid_by/paid_at), owes untouched, mig 243. session 80 — RESOLVED: debt-state players couldn't finish paying (Confirm button unreachable once "Paid Cash" tapped) + POTM modal re-popped on every app open even after voting — both PlayerView, fixed this session. OPEN: drawn teams stay mutable AFTER kick-off — a post-kickoff injured-toggle silently dropped a player from team B (Footy Tuesdays, this week); two linked bugs filed, live data corrected, no code fix yet. session 79 — RESOLVED ops analytics counted players off players.team (A/B matchday side) not team_players (squad membership), mig 234; RESOLVED apps/superadmin blank screen since first deploy — prebuilt build missing VITE_SUPABASE_* env, see GO_LIVE #13. session 78 — RESOLVED venue Requests inbox confirmed long weekly blocks only partially, mig 236. session 77 — RESOLVED players couldn't save their own nickname, mig 233. session 76 — RESOLVED unreliable "spot opened" reserve notification, mig 230. session 71 — full-codebase bug audit; Batch A COMPLETE (migs 208–211); Batch B COMPLETE (mig 212 create_team TZ + BibsScreen dead-code); Batch C COMPLETE (migs 213–215: notify whitelist, drop cast_potm_vote, update-this-week; + cron DST-safe rollover + dead-code removal). VC parity + guest orphans + HistoryView id-res + self-pay-as-pending-claim all shipped. session 70 — stale guest row RESOLVED e6f9459; session 69 — BST offset RESOLVED 4e351b6; PWA live-update RESOLVED 5edd64f.)*

---

## SESSION 168 — ✅ WATCHOS PHASE 4 SHIPPED (mig 375): match-health storage + casual ref toggle. No new bugs.

watchOS companion **Phase 4** (non-gated backend + web). New RLS-walled `match_health_sessions`
(summary-only health data) + 2 authenticated-only SECDEF RPCs (`save_match_health_summary`
idempotent upsert / `get_my_match_health` read-back) + **mandatory same-migration GDPR cascade**
(both `delete_my_account` + `delete_my_account_auth` purge the table; EV-proven). (B) Casual ref
toggle wired: `dbToMatch.refPlayerId` + `RefAssignCard` in `AdminView/TeamsScreen` (reuses the
mig-369 `assignCasualMatchRef` — NO new backend) + self-hiding "Your match fitness" section in
`MyIOView`. Gates: rpc-security PASS, **EV 9/9 + leak 0** (incl. GDPR-cascade purge, idempotent
upsert, casual team-derive, league-uuid fallback, bad-context reject), hygiene 7/7, build clean,
casual-regression additive-diff PASS + Playwright authed walk on team_demo (RefAssignCard renders;
populated + empty MatchFitness both proven; new RPC 200 authed; 0 console errors from changed files).

**⛔ OWED to the operator (cannot be done bot-solo):**
1. **Real-iPhone PWA walk** (Hard Rule #13) — MyIOView "Your match fitness" section + the admin
   TeamsScreen ref-assign toggle, on a real home-screen install.

**Carry-forward — 0d OWED list (still open, do NOT lose):**
1. **Real phone+watch concurrency rehearsal** — two real devices on one live match; confirm the
   ⌚CTRL badge + handoff hold and the clock doesn't jitter. Precondition for #2.
2. **0d enforcement flip** — the clock lock SHIPS DORMANT; a follow-up migration must wire
   `ref_check_clock_owner` + a `p_device_id` arg into the clock-write RPCs to reject a non-owner.
   Do ONLY after the rehearsal AND once the native watch exists.
3. **Real-iPhone apps/ref PWA walk** of the ⌚CTRL badge (renders, take-control, release-on-exit).

**Next free mig = 376.**

## SESSION 167 — ✅ PHASE 0d SHIPPED (mig 374): watch↔phone live-match single-writer lock (DORMANT). No new bugs.

Unified Identity & Sync Spine **Phase 0d** — fixture-scoped, lease-based **clock-owner
election** replaces the old last-write-wins clock jitter when two devices (phone `apps/ref`
+ the future watch) hold the same `ref_token`. New `fixtures.clock_owner_*` columns + four
ref RPCs (`ref_claim_clock`/`ref_heartbeat_clock`/`ref_release_clock`/`ref_check_clock_owner`)
+ a casual-ref activation validator (`validate_casual_ref_activations`). `apps/ref` auto-claims,
heartbeats, releases, and shows a ⌚CTRL badge (tap-to-take-control when another device holds it).
Also fixed a **Hard Rule #10 publisher gap** — `ref_set_clock` + `ref_set_added_time` were
venue-channel-only; now notify team+venue like every other live-match write. Gates: EV 11/11 +
leak 0, rpc-security PASS (8 SECDEF fns single-overload/search_path/grants), casual-regression PASS
(additive-diff — core +62/−0, zero inorout views), cross-role RLS audit clean (proven live on
tarny+demo + tarny+family), build inorout+ref + hygiene 7/7.

**⛔ OWED to the operator (cannot be done bot-solo):**
1. **Real phone+watch concurrency rehearsal** — two real devices on one live match, confirm the
   ⌚CTRL badge + handoff hold and the clock doesn't jitter. This is the precondition for #2.
2. **Enforcement flip ("switch on the blocking")** — the lock SHIPS DORMANT: the clock-write RPCs
   (`ref_set_clock`/`ref_record_goal`/…) do NOT yet reject a non-owner. After the rehearsal, a
   follow-up migration wires `ref_check_clock_owner` + a `p_device_id` arg into those write RPCs so
   a non-owning device is rejected server-side. Until then the lock is advisory (badge + auto-claim).
3. **Real-iPhone PWA walk of `apps/ref`** (Hard Rule #13 — `apps/ref` LiveMatch touched): badge
   renders, take-control works, release-on-exit frees the clock.

## SESSION 165 — ✅ NATIVE iOS PUSH PROVEN END-TO-END (closes the s164 OWED delivery test). 5 bugs fixed + 1 diagnosed.

Real-device push delivery test on the operator's iPhone. **Native APNs push now
works end to end** — a test push fired from the server landed on the lock screen
**and mirrored to Apple Watch**; APNs returned HTTP 200 (the server writes a
`notification_log.sent_at` ONLY on a successful send, and it did). Server creds
independently proven first via a new `apnsDiag` probe (Apple returned
400/BadDeviceToken to a dummy token = JWT signing + .p8 + key-id + team-id +
bundle-id + topic all accepted). Getting there unpicked **five** bugs:

1. **RESOLVED (commit 09721c3, remote bundle) — push opt-in invisible on native.**
   `PlayerView` gated the Enable prompt on `canPush = "PushManager" in window &&
   "serviceWorker" in navigator` — both ABSENT in the iOS Capacitor WKWebView, so
   the button never rendered and `registerNativePush` could never run. Native push
   uses the `@capacitor/push-notifications` plugin, not the web APIs. Fix: treat a
   `Capacitor.isNativePlatform()` build as push-capable regardless of the web
   checks. Web path byte-identical (`isNativeApp` is false on web).

2. **RESOLVED (THE root cause — native `ios/App/App/AppDelegate.swift`).** iOS
   delivered the device token to the AppDelegate, but the AppDelegate had NONE of
   the APNs-forwarding methods, so `@capacitor/push-notifications`' `'registration'`
   event never fired → token vanished. Symptom: `register()` called, then total
   silence (no token, no error) — the textbook signature. Added
   `didRegisterForRemoteNotificationsWithDeviceToken` +
   `didFailToRegisterForRemoteNotificationsWithError` (post the
   `.capacitorDidRegister*` notifications). `cap add ios` does NOT generate these;
   `ios/` is gitignored → the two hand-edited native files
   (`AppDelegate.swift` + `App.entitlements`, `aps-environment` now `production`
   for TestFlight) are now **force-tracked in git** and documented in
   `APP_STORE_CHECKLIST.md` so a regenerate can't silently lose them.

3. **RESOLVED (commit a8f027d, remote bundle) — premature "subscribed" flag.**
   `registerNativePush` returned 'subscribed' the instant `register()` was called,
   so `handleSubscribe` persisted `notif_<id>='subscribed'` and hid the Enable
   prompt BEFORE any token arrived. When the token never came (bug #2) the prompt
   was hidden forever with no retry. Now `registerNativePush` returns 'registering'
   and fires `onRegistered`/`onError` callbacks on the ACTUAL async outcome — mark
   subscribed only when a token lands + saves; reset to idle on failure so the
   prompt returns. Also `removeAllListeners()` before re-adding (no stacking).

4. **RESOLVED (commit a8f027d, remote bundle) — back button under the status bar.**
   `PlayerProfile` + `HeadToHead` sticky `top:0` headers had no safe-area inset, so
   the back arrow + title sat under the notch/Dynamic Island and were untappable on
   the native build. Added `calc(12px + env(safe-area-inset-top))` top padding.

5. **RESOLVED (commit 05b2a53, remote bundle) — no confirmation feedback.** The
   push prompt only rendered while `notifState==='idle'`, so it vanished the instant
   Enable was tapped — no subscribed/pending/error state, leaving the user unsure it
   worked. Now renders for every state except dismissed: green "Notifications on"
   confirmation, "Turning on…" pending, Settings hint when blocked. `PlayerProfile`
   "Save" on the push channel now also triggers registration (commit b380708) and
   reports the real async outcome.

**RESOLVED (commit cd4e3ef, remote bundle) — squad-resume trap.** A signed-in
squad-only user (2 squads, 0 clubs) landed on the club "No clubs yet" Sessions screen
with no escape (only Sessions + Profile tabs). Root cause: `readLastContext()`
(App.jsx:135) restores a stale `/sessions` path on launch WITHOUT validating the user
still belongs to a club context; once there, `writeLastContext` re-saves it →
self-reinforcing trap. Fix: guard the three club/guardian home routes
(`/sessions` `/feed` `/parent-home`) — once `relationships` is loaded, a
`homeScreenType==='squad_only'` user is bounced to `/` where the landing router routes
them to their real home (squad chooser / player view); the squad home then overwrites
the stale lastContext (self-heals). Casual-safe: casual token flows are unauth +
`route.type==='player'` (untouched), and a signed-in casual squad user IS squad_only so
is correctly sent to their squad home. **Closes s164 fast-follow #3.** Website fix — no
App Store resubmission.

**TECH DEBT found — `/api/notify` direct mode is UNAUTHENTICATED.** Only `cronType`
mode checks `CRON_SECRET`; direct mode sends to a team's subscribers given just
`teamId` + `payload` (used here to fire the test push). Anyone could POST spam to a
team's own subscribers. Limited blast radius (a team's own players) but should be
gated. NOT fixed (changing it must not break the in-app event triggers that call it).

No migration this session (all code/native; no schema change). **Next free mig = 371.**

## SESSION 164 — ✅ APP SUBMITTED TO APPLE (1.0 build 2, Waiting for Review). Stage 5.3 device-walk burndown + 4 fast-follow items OPEN

**iOS app SUBMITTED** (Submission ID `f45149a8-18ed-4b09-87b2-83e19dd14548`, manual
release → won't go live until operator presses release after approval). Build is
**iPhone-only** (TARGETED_DEVICE_FAMILY 1,2→1, build 1→2) to avoid the iPad-screenshot
requirement + Apple iPad-design rejection (app renders as a narrow column on iPad).
DSA/EU skipped (sells everywhere except EU; add trader info later, no resubmit).

**Stage 5.3 fixes shipped + verified this session (all on `main`, deployed):**
F1 safe-area insets on every top-level header; F2 splash auto-hide net; F3 sign-in
green/red lockup; F4 Apple+Google sign-in (Supabase returns `#access_token` HASH not
`?code` → native-shell appUrlOpen routes WebView into web /auth/callback); F5 removed
Capacitor `errorPath` (App.jsx launch redirect → -999 cancelled-nav → mis-served
offline.html ONLINE); F6 multi-context headers lockup+insets; F7 Sessions/Profile
blank `return null` → empty states; F8 Feed tab vanished from ClubNavBar after leaving
Feed (gated `hasFeed` = homeScreenType 'multi'); **mig 370 `delete_my_account_auth()`
= account deletion for auth-only signed-in users (Apple 5.1.1(v)), EV 2/2+leak0,
device-verified end-to-end**; Sign Out added to multi-context MemberProfile.

**OPEN — fast-follow tech debt (all remote/website-side, deploy with NO App Store
resubmission; none block launch; none affect the casual football flow):**
1. **Guided-Tour popup overlays badly** on the squad screen in the installed app
   (standalone-only, couldn't reproduce in a browser — needs a device screenshot to fix).
2. **Signed-in user tapping a casual `/p/<token>` link** is bounced to their own home
   instead of that squad (App.jsx homeScreenType redirect overrides the token route).
3. **Brand-new sign-in lands on an empty "No clubs yet" Sessions** screen instead of a
   clear create/join onboarding.
4. **`delete_my_account_auth` admin-edge**: NO ACTION FKs (team_admins/venue_admins.user_id)
   can leave a residual auth login for users who are also admins; their PII is still
   scrubbed. Pure consumers delete cleanly.

⛔ OWED: **real-device native-push DELIVERY test** (web push LIVE for PWA; native APNs
wired + server-configured but unverified end-to-end) — **= NEXT SESSION**. **Next free mig = 371.**

## SESSION 163 — APP STORE wrap: Phase 0+1 DONE; Stage 5.2 device walk surfaced 4 findings (OPEN)
iOS native build now runs on a real iPhone (iPhone18,2 / iOS 26.6). Deep-link test PASSED
(universal link → opens app, routes to player screen). The device walk then surfaced 4 findings,
all OPEN, tracked in full (symptom + cause + fix) in **`STAGE_5_2_FINDINGS.md`**:
- **F1 (blocker)** — casual player shell missing `env(safe-area-inset-*)`: status bar covers the
  PageHeader AND blocks the profile tap target (gates push opt-in + account deletion). Deployed-site
  fix (`PageHeader.jsx` / PlayerView tab headers / `NavBar.jsx`). Touches apps/inorout/src →
  casual-regression + HR#13 re-walk.
- **F2 (blocker)** — cold-launch splash HANGS forever: `capacitor.config.ts`
  `SplashScreen.launchAutoHide:false` + the only hide is the remote bundle's 400ms timeout; no
  native fallback. Fix = `launchAutoHide:true` + `launchShowDuration:2500` (native only, no deploy).
- **F3 (cosmetic)** — SignIn screen still uses the old amber wordmark (item 1.5 only restyled the
  landing welcome block). Folds into F1's deploy.
- **F4 (blocker, Apple-required)** — Sign in with Apple authenticates (Face ID OK) then stalls on a
  blank `appleid.apple.com`; never returns to `uk.inorout.app://auth/callback`. Cause = custom-scheme
  redirect not allowlisted in Supabase Auth (and/or Apple provider Service ID/key). 👤 Supabase
  dashboard fix; same gate blocks Google return. Stage 5.3 fix plan = in the findings doc.

## SESSION 153 — EXHAUSTIVE E2E SWEEP (Playwright) + 1 seed fix (mig 366) + 3 low-pri findings

Wrote a full per-app × per-role Playwright suite against the live demo seed (migs
363–365) using the existing session-injection harness. **60 specs across 9 projects,
all passing.** Coverage table + run guide in `E2E_HANDOFF.md`. Seed verified unmutated
after the run (e2e-leak count 0; booking/appointment/bout/membership counts match the
seed exactly — every spec is read-only or a non-submitting form render).

**RESOLVED (mig 366, additive seed) — combat clubs were never linked to demo_venue.**
mig 363 created `club_demo_box` (boxing) + `club_demo_ma` (martial_arts) with belt
ladders + fight records, but inserted **no `club_venues` rows**. Effect in the venue
console: Memberships → **Club** tab showed only Finbar's FC, and Memberships →
**Grading** tab showed "No grading clubs" — the seeded schemes were unmanageable from
the operator UI. The consumer `/classes` screen also rendered "No venue linked to this
club yet" because `member_get_self.active_clubs[].venues` is built from `club_venues`.
Member-level Fight-record / Award-grade buttons already worked (they key off the
membership row). Fixed by mig 366 (idempotent `WHERE NOT EXISTS` insert of the two
club→demo_venue links). Verified: Grading tab now lists Adult + Junior Belt Systems,
Club tab lists both combat clubs, `/classes` timetable renders once a club is selected.
**Next free mig = 367.**

**FINDINGS — queued for NEXT session, fully scoped in `E2E_FOLLOWUP_HANDOFF.md`:**
1. **(cosmetic) `/classes` multi-club no-selection copy.** A member of 2+ clubs with no
   `?club=` param sees "No venue linked to this club yet." — really the *no-club-selected*
   state (chips are the selector). `ClassesScreen.jsx` L26 (`pickClub` → null for 2+ clubs)
   + L145 (the `venues.length===0` branch conflates no-selection with no-venue).
2. **(cosmetic) Paused pass shows "Frozen until 1 Jan 1970."** `MemberPass.jsx:125-127` —
   `status==='paused'` renders `fmtDate(pass.frozen_until)`; seed sets `paused` with no
   freeze date so `fmtDate(null)` → epoch. Hide the date when `frozen_until` is null.
3. **(REAL BUG, not cosmetic) "My Squads" hides other squads when sign-ups aren't open.**
   `PlayerView.jsx:1622` derives `currentToken={myId && squad.find(p=>p.id===myId)?.token}`
   from *this week's matchday squad*. When sign-ups aren't open that squad is **empty** →
   `currentToken` falsy → `MySquads` early-returns → "Not part of any other squads yet."
   Data is fine (`player_get_teams_by_token` returns both squads); the token must come from
   the player's own identity, not the empty squad. Reproduces as Alex (2 squads, current
   week not open). Confirmed against `main` — App.jsx switcher code is byte-identical to
   `main`, so this is pre-existing, not a marketing-branch artifact.

## SESSION 154 — E2E FOLLOW-UP FIXES (apps/inorout only, no mig)

**RESOLVED (no mig) — finding #3: "My Squads" hid every other squad.** Root cause was
sharper than the finding's "empty matchday squad" framing. On the **admin route**
(`/admin/<token>`, e.g. Alex viewing his own squad as admin) the matchday squad is NOT
empty (`buildPlayerSquad` always injects the viewer's own row on the *player* route, which
is why it never reproduced there) — but the admin's `is_self` row only resolves when
`auth.uid()` matches, and on a token route it often doesn't. `myId` then falls back to
`squad[0]`, so `currentToken` (PlayerView L1622, `squad.find(p=>p.id===myId)?.token`)
became the WRONG player's token. `MySquads` loaded squad[0]'s squads (or, when sign-ups
weren't open and the roster was genuinely empty, bailed) → "Not part of any other squads
yet." **Fix (`MySquads.jsx`):** a signed-in viewer's list now comes from `auth.uid()` via
`player_get_teams` (NOT the matchday-squad token), and the CURRENT pill is matched by
`currentTeamId` (reliable on every route) instead of the roster-derived token. Anonymous
token-only viewers are byte-identical (still `player_get_teams_by_token(currentToken)`; the
auth RPC never fires for anon — verified). Threaded the authoritative `authUserId`
(App `authUser.id`) → PlayerView → MySquads `userId`. **MINOR FOLLOW-UP — RESOLVED (mig
367):** the auth path's `player_get_teams` RPC didn't return `is_competitive`, so the
**LEAGUE** pill stopped rendering in MySquads for signed-in multi-squad users (never affected
casual-only users, so "casual is sacred" held). Mig 367 brings `player_get_teams` to parity
with `player_get_teams_by_token` — adds `is_competitive` sourced IDENTICALLY (EXISTS over
active league `competition_teams`). Adding an OUT column changes the row type → DROP+CREATE
(zero-arg signature otherwise unchanged); grants restored to auth-only + service_role (the
DROP re-triggered an `ALTER DEFAULT PRIVILEGES` anon grant — explicitly REVOKEd). No
MySquads.jsx change (pill JSX already reads `squad.is_competitive`); wrapper `getPlayerTeams`
returns data raw → no mapper (Hard Rule #12 N/A). Gates: rpc-security PASS (overload=1/SECDEF/
search_path=public/grants), PostgREST cache flushed; Playwright spec extended — asserts
LEAGUE + ADMIN + CURRENT pills on the auth path AND a 2nd test pins the pill as column-driven
(pre-367 shape w/o `is_competitive` → no LEAGUE), both PASS. Read RPC → ephemeral-verify not
required. ⛔ real-iPhone PWA walk STILL OWED. Restoring it needs an additive `is_competitive`
column on `player_get_teams` (done). Original-cycle gates:
deterministic Playwright regression added (`e2e/specs/inorout.mysquads-empty-roster.spec.js`,
stubs is_self off + both team-list RPCs — FAILS pre-fix, PASSES post-fix), casual-regression
PASS (anon walk: token path only, 0 auth-RPC leak, MySquads renders), build + hygiene clean.
⛔ real-iPhone PWA walk OWED (hard-rule #13 — PlayerView/App touched).

**RESOLVED (no mig) — finding #1: `/classes` no-club-selected copy.** A member of 2+
clubs opening `/classes` with no `?club=` param has `selectedClubId === null` (the chips
are the selector), which left `selectedVenueId` null and rendered "No venue linked to this
club yet." — conflating no-selection with a club that genuinely has no venue. **Fix
(`ClassesScreen.jsx` L142):** branch on `selectedClubId` first — `!selectedClubId` →
"Select a club above to see its class timetable."; club selected + venue →
ClassesTimetable; club selected + no venue → the original no-venue copy. Casual-only users
(no clubs) still return null at the activeClubs gate — casual flow byte-identical.
Deterministic Playwright regression added (`e2e/specs/inorout.classes-no-club.spec.js` —
FAILS pre-fix, PASSES post-fix). ⛔ real-iPhone PWA walk OWED.

**RESOLVED (no mig) — finding #2: paused MemberPass showed "Frozen until 1 Jan 1970".**
`MemberPass.jsx` L125-127 rendered `fmtDate(pass.frozen_until)` for a paused pass; an
indefinite hold has `frozen_until = null` so `fmtDate(null)` → `new Date(null)` → the Unix
epoch. **Fix:** label drops to "Frozen" (from "Frozen until") when there's no freeze date,
and the value omits the date entirely (price-only for a paid pass). Confirmed against Sam's
seeded paused pass (`m_8289db16b6ef4386abaf39c294a828cd`, paid £30/monthly, frozen_until
null). Deterministic Playwright regression added (`e2e/specs/tokens.memberpass-frozen.spec.js`,
no-auth /m/ route — FAILS pre-fix, PASSES post-fix). ⛔ real-iPhone PWA walk OWED.

## SESSION 162 — RESOLVED (no mig, app-store item 1.5): consumer welcome screen restyled on-brand

The unauthenticated root (`/`) welcome screen in [`apps/inorout/src/App.jsx`](apps/inorout/src/App.jsx)
(`route.type === "landing"` block) is now on the design system. **Before:** ad-hoc inline styles —
flat-amber `Bebas Neue` "IN OR OUT" wordmark, dead `"Inter"` body font (not loaded → system
fallback), hand-rolled button with a literal `→`, one stray `"#000"` hex. **After (focused
brand-token restyle, behaviour byte-identical):**
- Wordmark is now the **real brand lockup** — `IN` in `C.green` · ` OR ` neutral `C.text` · `OUT`
  in `C.red`, matching the canonical treatment in `PageHeader.jsx` and the marketing site (the
  wordmark *is* the logo mark — there is no SVG/image logo asset).
- Body + CTA switched from the dead `"Inter"` to **`"DM Sans"`** (actually loaded in `index.html`
  per the Bebas/DM Sans brand pair).
- Literal `→` arrows replaced with **Phosphor `ArrowRight` / `LinkSimple` `weight="thin"`** icons.
- Stray `"#000"` → `C.black`; wrapping `<a>` underline killed on the primary CTA.
- **Functional surface unchanged:** `/create`, `/signin`, `/legal`, mailto hrefs; the
  `showLinkInput` toggle; the `/\/p\/([a-zA-Z0-9_-]+)/` paste→navigate (refactored into
  `goToLink`/`linkValid` helpers, logic identical).

Verified: `inorout` build clean, hygiene 7/7 PASS, grep no new hex, all routing/hrefs/regex intact;
Playwright render of the live `/` landing confirms the green/red lockup + DM Sans + thin icons (note:
`localhost` hits the [App.jsx:114](apps/inorout/src/App.jsx) dev backdoor → `admin/local`, so the
landing must be viewed via `127.0.0.1`, not `localhost`). Unblocks the Stage 4.1 App Store screenshot
shoot. ⛔ Hard Rule #13: App.jsx is PWA-affecting → real-iPhone home-screen walk OWED — folded into
the Stage 5.2 device-walk burn-down (not a commit blocker). This was app-store checklist item **1.5**,
done as a focused restyle on the app-store track — NOT the separate cinematic marketing redesign
(still parked in `stash@{0}` on `marketing-cinematic-redesign`).

## SESSION 143 — RESOLVED (mig 353): recurring-session generators stored UTC, not UK local (BST off-by-one-hour)

**Found by the pre-build audit of the club/membership system.** All three recurring-session
generators built their timestamp with a bare cast: `(v_cursor + p_start_time)::timestamptz`.
`(date + time)` yields a `timestamp WITHOUT time zone` (a wall-clock value); the bare cast then
interprets it in the DB session timezone, which is **UTC**. So an operator who entered **18:00**
got every session stored as **18:00 UTC**. During British Summer Time (late Mar–late Oct) the
venue/member UI renders in UK local time, so every recurring session displayed **19:00** — one
hour late — and booking cutoffs, QR check-in windows and `_space_is_available` conflict detection
were all an hour off. Winter (GMT) was unaffected. One-off creators
(`venue_schedule_class_session`, `club_create_session`, `club_manager_create_session`) take a
client-supplied `timestamptz` and were already correct.

Same bug class as the mig-207 game-time BST fix; the correct `AT TIME ZONE 'Europe/London'`
pattern was already in use in migs 143/181. Fixed all three —
`venue_create_class_series`, `club_create_session_series`, `club_manager_create_session_series` —
`(v_cursor + p_start_time) AT TIME ZONE 'Europe/London'`. Bodies otherwise byte-identical
(grants/security preserved via CREATE OR REPLACE; security sweep PASS 3/3).

Verified by pure-expression proof (BST 18:00→17:00Z displays back 18:00 ✅; GMT 18:00→18:00Z
displays 18:00 ✅, no winter regression). Read-only sanity count of already-generated future
series rows = **0** in both `venue_class_sessions` and `club_sessions` — no historical data
correction needed (features built, not yet used by a live venue).

LESSON: never `(date + time)::timestamptz` for a UK local wall-clock; always
`(date + time) AT TIME ZONE 'Europe/London'`. The DB session runs in UTC.

## SESSION 143 — RESOLVED (no mig): multi-club residual club[0] sites (Bug #2 follow-up)

**Found by the pre-build audit.** The s141 multi-club selection fix wired `?club=<id>`
into `SessionsScreen` but missed two render sites, so a member in **more than one club**
could still be pushed to the wrong club:
1. `MemberProfile.jsx` hardcoded `active_clubs[0].pass_token` on its `ClubNavBar`, so the
   **Pass** tab from /profile always pointed at the first club.
2. `ClubNavBar.jsx`'s **Sessions** and **Profile** tabs navigated to bare `/sessions` /
   `/profile`, dropping the `?club=` selection when moving between club screens.

Fix (front-end only, no DB): `MemberProfile` now derives `selectedClub` from `?club=`
(validated against `active_clubs`, falls back to `[0]` — prior behaviour when no/unknown
param) and passes both `passToken` and `clubEntry`; `ClubNavBar` threads
`?club=<club_id>` into the Sessions/Profile hrefs when it knows the club. Single-club
members are unaffected. Build clean; hygiene 7/7 both files.

THIRD SITE — RESOLVED (mig 354): `MemberPass.jsx` rendered `ClubNavBar` without a
`clubEntry` (the `get_member_pass` RPC didn't return `club_id`), so the Sessions/Profile
tabs *from the pass screen* fell back to club[0]/auto-select. Fixed by adding `club_id` to
the `get_member_pass` return shape (the function already loaded `m.club_id`; just surfaced
it — `getMemberPass` returns the payload raw, no mapper) and passing `clubEntry={{club_id}}`
from MemberPass. Runtime-verified the payload carries a non-null `club_id`; build clean,
hygiene 7/7. All three multi-club nav sites now thread the selected club.

## SESSION 136 — RESOLVED (mig 335): stripe_complete_member_enrolment actor_type='member'

**Found during live Phase 3 E2E test.** `stripe_complete_member_enrolment` (mig 331) had `actor_type='member'`
in its `audit_events` INSERT — violates `audit_events_actor_type_check` constraint. Every webhook-triggered
enrolment call crashed at the audit step, leaving the `venue_memberships` INSERT rolled back.

Same bug pattern as mig 297 (which fixed `member_register_child`, `member_update_child`, `member_accept_consent`,
`member_self_create_profile`, `member_enrol_membership`). `stripe_complete_member_enrolment` was added in
mig 331 after the mig 297 fix and repeated the mistake.

**Fix (mig 335):** `'member'` → `'player'` in the audit INSERT. The valid set is: `player`, `team_admin`,
`venue_admin`, `club_admin`, `super_admin`, `system`, `service_role`, `league_admin`, `platform_admin`,
`referee`, `company_admin`, `vice_captain`. Confirmed SECDEF ✓, search_path ✓, overload=1 ✓ post-apply.

---

## SESSION 136 — RESOLVED (mig 332): get_venue_signup_tiers used status='active' not 'connected'

**Found during live Phase 3 E2E test (s135, documented s136).** `get_venue_signup_tiers` derived
`stripe_connected` from `venue_integrations WHERE status = 'active'`. The valid CHECK values on that column
are `'pending'|'connected'|'disconnected'` — `'active'` never matches anything. Result: `stripe_connected`
was always `false`; MembershipSignup never forked to the Stripe Checkout path for any venue, even when
fully onboarded. Fixed in mig 332 to `status = 'connected'`.

---

## SESSION 136 — RESOLVED (no mig): Stripe webhook not registered as Connect webhook

**Found during live Phase 3 E2E test.** Stripe Checkout Sessions are created with `{ stripeAccount: accountId }`
(on the connected account). The `checkout.session.completed` event therefore fires on the connected account,
not the platform account. Our webhook endpoint was a platform webhook (Events from: This account only), so
those events were never delivered.

**Fix:** Deleted and recreated the webhook endpoint, then toggled "Listen to events on Connected accounts" via
the Stripe Dashboard (the `connect=true` flag cannot be set via the REST API — Dashboard-only). Updated
`STRIPE_WEBHOOK_SECRET` in Vercel to match the new endpoint's signing secret.

**Rule established:** Any webhook handling events from connected accounts MUST be registered as a Connect
webhook in the Stripe Dashboard. See DECISIONS.md.

---

## SESSION 136 — RESOLVED (mig 336): post-Stripe-redirect pass link never rendered

**Found during live Phase 3 E2E test.** After a successful Stripe Checkout, Stripe redirects back to
`/q/{inviteCode}?checkout=done`. `MembershipSignup` detects the `?checkout=done` param and sets `step='done'`.
But `passToken` is `null` — the component re-mounted fresh after the external redirect and state was lost.
The done screen shows the pass link ONLY when `passToken` is truthy, so it fell back to
"The club will be in touch with next steps." with no actionable link.

**Fix (mig 336 + MembershipSignup.jsx):** New RPC `member_get_venue_membership_pass(p_invite_code text)`
returns `{found, pass_token, membership_id, status}` for the caller's active membership at the venue.
Called on `MembershipSignup` mount (after auth). If `found=true`, sets `passToken` and jumps to `step='done'`.
Covers both the post-redirect case AND returning already-enrolled members who hit the invite link again.

---

## SESSION 130 — RESOLVED (mig 328): mig 326 write RPCs — audit_events entity_type/entity_id missing

**Found during mig 327 EV audit.** All 3 write RPCs in mig 326 omitted `entity_type` and `entity_id`
from their `audit_events` INSERT (both NOT NULL since mig 003), causing a NOT NULL constraint violation
on every call. Fixed in mig 328 via CREATE OR REPLACE with the correct INSERT pattern:

```sql
INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
VALUES ('_system', v_uid, 'club_admin', 'action_name', 'entity_type_value', entity_id_value::text, jsonb...);
```

- `club_admin_set_performance_config` → entity_type='tournament_event', entity_id=p_tournament_event_id
- `club_admin_add_performance_event` → entity_type='performance_event', entity_id=v_event_id
- `club_admin_record_result` → entity_type='performance_result', entity_id=v_result_id

**EV:** 9/9 PASS, leak-clean. Security sweep 3/3 PASS.

---

## SESSION 126 — RESOLVED (mig 323): club_admin_get_standings crash — club_admins table never existed

**Found during audit for Phase 7B.** `club_admin_get_standings` (applied mig 320, updated mig 322)
performed `JOIN public.club_admins ca ON ca.club_id = te.club_id WHERE ... AND ca.user_id = auth.uid()`.
The `club_admins` table has never existed in this schema. PL/pgSQL defers table resolution to runtime,
so the function body applied cleanly but crashed on every call with "relation public.club_admins does
not exist". The function has been dead since mig 320 shipped (session 122). No production users were
affected (Event OS is not yet live) but standings would have been blank for any director who tried.

**Fix (mig 323):** `CREATE OR REPLACE` replaces the broken join with the correct
`club_team_managers` guard — `auth.uid() → member_profiles → club_team_managers(is_active=true)`
— the same pattern used by Phase 1-3 Event OS RPCs. H2H standings logic preserved byte-for-byte
from mig 322. SECDEF ✓, search_path ✓, overload_count=1 ✓ post-apply.

---

## SESSION 99 — RESOLVED (mig 297): member RPCs used invalid audit_events actor_type

**Found during ephemeral-verify s99.** All 5 member RPCs used `actor_type='member'` which is not
in the `audit_events_actor_type_check` constraint. The check allows: `player`, `team_admin`,
`venue_admin`, `club_admin`, `super_admin`, `system`, `service_role`, `league_admin`,
`platform_admin`, `referee`, `company_admin`, `vice_captain`.

Affected RPCs (never successfully written to audit_events since migs 290+293+296 shipped):
- `member_register_child`, `member_update_child` (mig 290/295)
- `member_accept_consent` (mig 293/295)
- `member_self_create_profile`, `member_enrol_membership` (mig 296)

**Fix (mig 297):** Changed `actor_type='member'` → `'player'` in all 5 RPC bodies. Ephemeral-verify
re-run: 8/8 PASS (not_authenticated, first_name_required, profile_exists, invalid_code,
invalid_period, not_guardian, happy-path profile creation, happy-path self-enrolment). Leak-check: all zeros.

---

## SESSION 99 — RESOLVED (mig 295): member audit_events inserts broken

**Found s98, fixed s99.** Three member RPCs had broken `audit_events` INSERTs:

- `member_register_child` + `member_update_child` (mig 290): used `actor_id`, `event_type`, `payload` — columns that do not exist. Also passed `NULL` for `team_id` which is `NOT NULL`.
- `member_accept_consent` (mig 293): column names were correct but `team_id = NULL` violated the NOT NULL constraint.

Root cause: BUGS.md initially described this as only a column-name mismatch, but the NOT NULL on `team_id` was a second independent failure mode in `member_accept_consent`.

**Fix (mig 295):** Rewrote all 3 audit INSERTs with correct schema (`actor_user_id`, `action`, `entity_type`, `entity_id`, `metadata`) and `'_system'` as the `team_id` sentinel (same pattern as mig 294). SECDEF/search_path/overload=1 confirmed for all 3 post-apply.

---

## SESSION 97 — RESOLVED (mig 292): venue_enrol_membership rejected period='season'

`venue_enrol_membership` now accepts `'season'`; `renews_at` is set to the tier's `season_end`
(or `9999-12-31` if unset). `run_membership_renewals` now excludes `period='season'` rows from
loop (c) — season memberships are one-off, billed at enrolment, never auto-renewed.
`venue_memberships.period` constraint updated to include `'season'`. No JS/UI changes (enrol
modal already passed period from the tier's price rows).

---

## SESSION 87 — RESOLVED: ref live match clock broken (actual_kickoff_at dropped from RPC, mig 160)

**Found during the Ref V2 build** (pulling the live `get_fixture_state_by_ref_token` body before
extending it). mig 120 added `actual_kickoff_at` to the ref state RPC's returned `fixture` object;
mig 160 (Cycle 5.6 lineup-aware rewrite) **silently dropped it** when it re-created the function.
The deployed ref app's live clock derives from `fixture.actual_kickoff_at`
([apps/ref/src/views/LiveMatch.jsx](apps/ref/src/views/LiveMatch.jsx) ~L94), so it has been reading
`undefined` → a stuck/zeroed clock for every live match since mig 160 shipped.

**Fix (mig 265).** Ref V2's `get_fixture_state_by_ref_token` extension restores `actual_kickoff_at`
(plus adds `clock_paused_at/_ms`, `added_time`, `format_override`, resolved `match_format`).
Data side is live; the **deployed ref app won't benefit until redeployed** — which happens as part of
the Ref V2 re-skin (this epic). See GO_LIVE_ISSUES "Ref clock". Ephemeral-verified (mig 265).

## SESSION 82 — RESOLVED: "Paid" carried into the next game (stale per-game flag)

**Incident (user-reported).** "My view shows me still as Paid, even though I've opted in for the
new game which has opened." A player who paid last week sees **✓ Paid** in My View for a brand-new
game they haven't paid for yet.

**Root cause.** `players.paid` is a **per-current-game** flag, but it was only ever recomputed at
end-of-game (`admin_save_match_result`, mig 241). The go-live RPCs (`admin_go_live` /
`admin_go_live_for_team`) reset the squad board (status='none', team=NULL, admin_locked_in=false)
on new-match creation but **deliberately left the payment flags alone** (mig 204 comment: "the Owes
balance depends on it"). So from the moment a new week opened until that game's result was saved,
`paid=true` survived from the previous game. [PlayerView.jsx:742](apps/inorout/src/views/PlayerView.jsx#L742)
reads `me.paid` → "✓ Paid". The admin **Payments → PAID UP** section had the identical bug
([PaymentsScreen.jsx:461](apps/inorout/src/views/AdminView/PaymentsScreen.jsx#L461)).

**Fix (mig 243).** The go-live new-match reset now also clears `paid=false, self_paid=false,
paid_by=NULL, paid_at=NULL`. `owes` is **untouched** — it's an independent accumulator and the
debt must persist; `payment_ledger` keeps the permanent per-match payment record, so no history is
lost. The mig-204 "Owes depends on it" note was a misread: what actually relies on the carry-over
is the post-game reconciliation window, and go-live is exactly the right boundary to close it.
SQL-only (both RPC signatures unchanged → grants preserved; `dbToPlayer` already maps these fields).
Ephemeral-verified both entry points incl. owes-preservation (0/5/10/7), leak-check clean.

## SESSION 80 — RESOLVED: debt-state players could not finish self-paying (Confirm button unreachable)

**Incident (user-reported — Bidz + Tarny, Footy Tuesdays).** "The Paid button doesn't work."
A player with an outstanding debt taps **Clear Debt → Paid Cash → (nothing)** — the
"Confirm — You've Paid?" button never appears, so the cash claim can never be submitted.
Reproduced live on production with Tarny's player link: after "Paid Cash" the entire payment
button row vanished; no `set_player_paid` request ever fired.

**Root cause.** `getPaymentState(me, cashPending)` returns `'cash_pending'` the instant the
player taps "Paid Cash" (the `cashPending` UI flag overrides everything — payments.js:16). But
the render's debt branch is guarded by `paymentState === 'debt'`
([PlayerView.jsx](apps/inorout/src/views/PlayerView.jsx)), and the **Confirm button lives inside
that branch**. So flipping `cashPending` true drops the player out of the debt branch entirely;
the only branch that handles `'cash_pending'` is the `status === 'in'` one. Result: a player who
is **'in'** can confirm (worked for Rohan/Sav at 18:32, pre-result), but a player in the
post-game **'debt'** state (status reset to 'none', `owes>0`) hits a dead end. Once a result is
saved the whole squad is in the debt state — so the button broke for everyone at once.

**Fix.** Branch the outer button structure on a `cashPending`-independent
`basePaymentState = getPaymentState(me, false)`, so the debt branch stays selected through the
Paid-Cash → Confirm sub-flow. One-line guard change + the new derived value. Build clean;
re-verified live after deploy. **Owed:** real-iPhone confirm (Hard Rule #13 — PlayerView).
Note: self-pay is a *pending claim* by design (mig 211) — a successful tap shows "Awaiting
confirmation", it does NOT clear the debt; the admin confirms in Payments to settle.

## SESSION 80 — RESOLVED: POTM vote modal re-popped on every app open (even after voting)

**Incident (user-reported).** The POTM voting modal — meant to appear once — reappeared on
every app open/force-quit-reopen while voting was live, even after the player had already voted.
Openly described by the operator as "very off-putting."

**Root cause.** The auto-open effect keys off `prevVotingOpen` — a `useRef(false)`
([PlayerView.jsx:285](apps/inorout/src/views/PlayerView.jsx)) that **resets to false on every
mount**. So each fresh load with `schedule.votingOpen === true` reads `nowOpen && !wasOpen` =
true and re-opens the modal. The open condition only checked `amEligible` — never whether the
player had already voted or already dismissed it. No persistence.

**Fix.** Suppress the auto-open when the player has voted OR has already seen it, via a
per-match `localStorage` flag (`ioo_potm_seen_<matchId>`) set on first open. They can still vote
through the persistent top "VOTE FOR POTM" banner, so nothing is lost. Build clean.

---

## SESSION 80 — RESOLVED (mig 241): players could sign IN to a game that's already been played

**Incident (user-reported, Footy Tuesdays).** After tonight's game finished and the result was
saved, the app still showed the In/Out/Maybe/Reserve buttons and players (Gurpal) could mark
themselves **In** for the already-played match. The operator: "nobody should be able to mark
themselves in yet as next week's game isn't live."

**Root cause — two layers:**
1. **`admin_save_match_result` never closes the game.** Verified: it does not touch
   `schedule.game_is_live` (only `game_is_live=false` paths are match-cancel migs 013/082 and the
   unstick scripts). So after a result is saved the schedule stays `game_is_live=true`,
   `active_match_id` still pointing at the finished match, and the client gate
   `(schedule.gameIsLive || isCancelled)` ([PlayerView.jsx:939](apps/inorout/src/views/PlayerView.jsx))
   keeps the sign-up buttons visible. The game only closes on cancel or the next week's auto-open.
2. **`set_player_status` has NO server-side gate.** Verified it checks none of `game_is_live` /
   `is_cancelled` / `lineup_locked`. The ONLY thing stopping a sign-up is the client hiding the
   button — a stale client, a direct RPC call, or any window where `game_is_live` is wrongly true
   sails straight through. Violates this project's own "never trust the client" rule.

**Live mitigation applied this session (data only):** set `schedule.game_is_live=false` for
team_KPaoX8oJYMQ and reset Gurpal `status='in' → 'none'`. Verified live — sign-up buttons gone,
player view shows "isn't live yet". This holds until next Wednesday's auto-open; the code bug
will recur every week and affects every team.

**Agreed post-game behaviour (operator spec, session 80) — ALL shipped in mig 241:**
1. ✅ **Close the game.** `admin_save_match_result` now sets `schedule.game_is_live=false` on
   fresh save. See [[project_result_save_invariants]].
2. ✅ **Reset ALL statuses, including reserves.** Added a blanket `status → 'none'` over the whole
   squad after the attendee reset (the attendee-only `WHERE pm.attended=true` left reserves/maybes
   lingering). Operator: "reserves should not stay as reserves once the game is complete."
3. ✅ **Informative sign-up note.** PlayerView now shows "Sign-ups aren't open yet … next game
   goes live — <opens_day> at <opens_time>" pulled live from `schedule.opens_day`/`opens_time`
   (am/pm formatted) instead of the bare "isn't live yet". **Owed: real-iPhone test (Hard Rule #13).**
4. ✅ **Server-side gate.** `set_player_status` now rejects with `game_not_live` unless
   `game_is_live=true AND NOT is_cancelled`. Ephemeral-verified (allow-when-live / reject-when-not)
   + rpc-security-sweep PASS (SECDEF, search_path pinned, anon+authenticated grants intact).
5. ✅ **Stop wiping the paid flag.** The attendee reset now preserves `paid=true` for players whose
   game_fee ledger for that match is `paid` (go-live resets status but NOT paid; next week's save
   keys on next week's match_id, so no stale paid carries forward). Ephemeral-verified.

**Verification:** ephemeral DO-block on a throwaway `_e2e_` fixture — 8/8 assertions pass
(gate allow=in / reject=game_not_live; game_live→false; reserve & non-attendee→none; paid kept;
unpaid stays unpaid owing £5) + leak-check 0. Live mitigation (game closed, Gurpal/Callum/Kyle
reset) already applied earlier this session; mig 241 makes it permanent + automatic for all teams.

---

## SESSION 80 — RESOLVED (mig 241): result-save wipes the flat `paid` flag of already-confirmed players

**Found reconciling payments (Footy Tuesdays, m_vcM3fQbBx6Y).** Players confirmed paid BEFORE
the result was saved (Bidz 06-05, Rohan 20:24) had `players.paid` reset to **false** by the
20:25 `admin_save_match_result` cascade, while their `payment_ledger` row stayed `paid`. The
admin Payments screen reads the ledger (correct), but the player's **My View** reads the flat
`players.paid`/`owes` (`getPaymentState` → payments.js), so a genuinely-paid player saw "Nothing
owed" instead of "✓ Paid". Net: ledger and flat flags diverge for anyone paid mid-cycle, on the
same match. **Reconciled live this session** (set `paid=true` for Bidz + Rohan whose active-match
game_fee ledger = paid). **Fixed (mig 241, still live in mig 268):** the attendee reset now derives
`paid = (l_paid.id IS NOT NULL)` from a LEFT JOIN onto that same match's `game_fee` ledger row where
`status='paid'` — so an attended player keeps `paid=true` whenever their ledger row for this match is
already paid, and only resets to false otherwise ([268_lineup_lock_and_team_integrity.sql:788-798](rls_migrations/268_lineup_lock_and_team_integrity.sql#L788-L798)).
The flat flag and the ledger can no longer diverge mid-cycle. Lives in the result-save cascade — see
[[project_result_save_invariants]] (migs 205/206). Verified against the live function body session 89.

## SESSION 80 — RESOLVED (not a code bug): result-save "double-charges guests" was a stale/historical row

**Found in the same reconciliation.** Guest Little K (`p_rlETFBOM`) carried TWO £5 ledger rows for
m_vcM3fQbBx6Y: a `guest_fee` (unpaid, host owes — created by `set_guest_payment`) AND a `game_fee`.
The original note assumed the result-save created the `game_fee` because the guest sat in the
`team_b` array, and that `admin_save_match_result` needed a fix to skip `is_guest=true` players.

**Re-checked against the live function (session 89).** That fix was already in place — and predates
the report. The `is_guest = false` guard sits on BOTH the `owes` bump AND the `game_fee` ledger
insert in every definition of `admin_save_match_result` since **mig 206**, through **mig 241**, and
in the current live definition **mig 268** ([268_lineup_lock_and_team_integrity.sql:759-778](rls_migrations/268_lineup_lock_and_team_integrity.sql#L759-L778):
`UPDATE players … AND p.is_guest = false` and the ledger `INSERT … AND p.is_guest = false`). mig 206
predates the session-80 report (mig 241), so the cascade could not have produced a guest `game_fee`
at the time it was filed. The observed Little K row was therefore a **historical/hand-created row**,
not output of the current code path. **No code or SQL change required** — guests are billed via
`guest_fee` only, as intended. Verified by direct inspection of the live function body.

---

## SESSION 80 — RESOLVED (mig 268): drawn teams stay mutable after kick-off (player silently dropped from a locked team)

**Fixed session 88 (mig 268, `268_lineup_lock_and_team_integrity.sql`).** Three server-side
fixes, no JS change, all six replaced RPCs keep identical signatures (grants preserved):

1. **Un-injure restores the player.** `set_player_injured` (and `admin_set_player_injured`)
   now restore a still-drawn player (`players.team IN ('A','B')`) from `'out'` back to `'in'`
   on un-injure — closing the silent-drop. (Was: un-injure left them at `'out'`, so the
   client's `inPlayers`-derived team array dropped them at result-save.)
2. **Kick-off lineup lock.** New helper `is_lineup_locked(team_id)` returns true once the
   team's active live match reaches `schedule.game_date_time` (the casual kick-off lock point —
   `matches` has no kick-off column). The four self-service lineup RPCs now raise
   `lineup_locked` post-kickoff: `set_player_injured`, `set_player_status` (both scoped to drawn
   players so a non-drawn player can still act), `add_guest_player` (unscoped), and
   `remove_guest_player` (scoped to a drawn guest). The admin injured path is NOT locked —
   admins may edit a frozen lineup.
3. **Result-save reconciliation.** `admin_save_match_result` now, before the flat W/L/D bump,
   repairs any `attended=true, result IS NULL` `player_match` row (derives result from
   `team_assignment` vs winner) and demotes a sideless orphan to `attended=false` — so
   `player_match` and the flat columns can never diverge again.

Ephemeral-verified (9 assertions incl. pre-kickoff restore, all four post-kickoff locks,
non-drawn-not-blocked, dropped-player reconciliation, sideless demote, idempotent re-save);
leak-check clean. Original incident write-up retained below.

---

### Original incident (SESSION 80)

**Incident (user-reported).** Squad **Footy Tuesdays** (`team_KPaoX8oJYMQ`), this week's match
`m_vcM3fQbBx6Y` (match_date 2026-06-09, kick-off 20:00, result A 1–0). The operator noticed
**team B was showing only 6 players** with **Matty (`p_c430bdb2`) missing**, even though Matty had
played. Teams were saved **7v7 at 18:14** (`match_teams_saved`, `team_b_count: 7` — Matty on B).
The result-save at **20:25** locked in a **6-man** team B with Matty gone and his per-match result
unset.

**Root cause — two linked bugs:**

**[BUG 1 — HIGH] Un-injuring does not restore the player to their drawn team.**
At **20:23** Matty opened the app and self-toggled **injured ON (20:23:35) then OFF (20:23:36)**
(`player_injured_self_set` true then false). Marking injured drops the player to `out` and removes
them from the saved `team_a`/`team_b` lineup array; un-marking injured clears the flag but **never
re-adds them to the team they were already assigned to.** Net effect: a single accidental
on/off toggle silently deletes a player from a fully drawn lineup. Affects any drawn-teams squad,
not just this one.

**[BUG 2 — HIGH, root cause per operator] Drawn teams are not locked at kick-off.**
Teams should be **frozen at kick-off time (20:00).** Matty's injured-toggle landed at **20:23 —
23 minutes after kick-off** — and was still allowed to mutate the locked lineup. Any
lineup-affecting self-service write (injured toggle, status in/out, drop-out, guest add) should be
**rejected or no-op against the team arrays once the match has kicked off**; post-kickoff changes
belong in attendance/result flows, not in silent team-array edits. Had teams been locked at 20:00,
Bug 1 could not have corrupted this match.

**[BUG 3 — MEDIUM, hardening] Result-save cascade diverges flat stats from `player_match` when a
player is in one but not the other.** Matty's `player_match` row (seeded with the draft,
`attended=true`) survived the drop, but because he was **absent from the `team_b` array** when the
result saved, the cascade left his `player_match.result` **NULL** while still counting his flat
loss (`players.l=1`). So the source-of-truth table (`player_match`) and the convenience columns
disagreed for one player. The result-save should reconcile against the union of the team arrays
**and** existing `player_match` rows, and flag/repair any `attended=true, result IS NULL` row after
a fresh save.

**Live data corrected this session (no code change — direct DB fix):**
- `matches.team_b` for `m_vcM3fQbBx6Y`: appended `p_c430bdb2` → **7v7** restored, matches team A's 7.
- `player_match.result` for Matty in that match: `NULL → 'l'` (team B lost 0–1).
- Flat stats untouched — already `total=1 / l=1`, identical to his team-B teammates (gbains, Tarny);
  last week's games aren't in anyone's flat columns, a separate squad-wide pre-existing gap, out of
  scope here. Verified live: `team_b_count=7`, `matty_in_team_b=true`, `matty_result='l'`.

**Fix shipped (mig 268) — all three:**
1. ✅ Un-injuring restores the player to their drawn team slot (`status → 'in'` when
   `players.team IN ('A','B')`). Applied to both the player and admin injured RPCs.
2. ✅ Team arrays locked at kick-off via `is_lineup_locked()` — the lock point is
   `schedule.game_date_time` (casual `matches` carry no kick-off column, as suspected here).
3. ✅ `admin_save_match_result` reconciles `player_match` against the team arrays and never
   leaves an `attended=true, result IS NULL` row.

---

## SESSION 79 — RESOLVED: ops analytics counted players off the wrong column (mig 234)

**Defect (latent, found during `superadmin_health` verification — not user-reported).** The
shipped ops email digest (`get_ops_usage_digest`, mig 234) counted "players" via
`players.team NOT LIKE 'team_demo%'`. But **`players.team` is the A/B matchday team-sheet side
('A'/'B'/NULL), not squad membership** — membership lives in `team_players`. So the count was
nonsense (players currently assigned to a side), reported as 24 when real active membership was
22. Same trap nearly shipped in `superadmin_health` (mig 236*) — caught in verification before
deploy. **Fix:** both RPCs now scope players via `team_players JOIN players` (active, non-guest),
demo/dc stripped on `team_players.team_id`. See DECISIONS "players.team is the A/B matchday side".

## SESSION 79 — RESOLVED: apps/superadmin blank screen since first deploy (env-less bundle)

The superadmin dashboard rendered a blank black screen for everyone since it was first
deployed — never usable. Root cause: `apps/superadmin` deploys **manual prebuilt-static** (its
remote build fails on the monorepo install, like `apps/venue`), and it had **no `.env.local`**,
so `VITE_SUPABASE_URL`/`ANON_KEY` baked in as `undefined` → `createClient(undefined)` threw →
React never mounted. **Fix:** created `apps/superadmin/.env.local` (gitignored; URL + anon key
are public), rebuilt, redeployed prebuilt; live bundle now carries the Supabase URL. Full detail
+ deploy recipe in **GO_LIVE_ISSUES.md #13**.

---

## SESSION 78 — RESOLVED: venue Requests inbox confirmed long weekly blocks only partially (mig 236)

**Defect (latent, found in the Requests-inbox audit — not user-reported).** Decline of a
weekly block had a clean atomic whole-series server path (`cancel_booking_series(series_id)`,
mig 146), but **confirm did not.** [RequestsInbox.jsx](apps/venue/src/views/RequestsInbox.jsx)
looped `venue_confirm_booking` over `g.bookingIds` — an array `BookingsView.buildPendingGroups`
builds only from occupancy rows in the **today..+90d** window (`get_pitch_occupancy`'s range).
Both series RPCs (`book_pitch_series` / `venue_create_booking_series`) allow up to **52 weeks**,
so for any block longer than ~12 weeks the inbox under-counted ("Weekly · 12 wks" for a 52-wk
block) and confirm confirmed **only the in-window weeks** — weeks 13+ stayed `status='requested'`
indefinitely: slot held, no `venue_charge` raised, the casual team never told confirmed.

**Fix (mig 236).** New `venue_confirm_booking_series(p_venue_token, p_series_id)` — confirms
every still-`requested` booking in the series + raises one charge per booking, in one
transaction (same fee logic + `venue_charges_source_uniq` ON CONFLICT guard as
`venue_confirm_booking`; venue-token authed only — a team can't confirm its own request).
RequestsInbox confirm now routes `g.seriesId → venueConfirmBookingSeries` else the single-id
call — symmetric with decline. Ephemeral-verified 7/7 (15-wk series incl. weeks past +90d → all
confirmed, 0 left requested, 15 charges no-dup, audit row, invalid-token / wrong-venue /
double-tap rejected) + leak-check 0; rpc-security-sweep PASS; venue build clean; deployed
prebuilt-static + inbox eyeballed live. Commit `871520f`. **Owed:** logged-in/real-squad pass
confirming a long block end-to-end (no pending series in the demo seed to exercise it in UI).

## SESSION 77 — RESOLVED: players couldn't save their own nickname (mig 233)

**Defect.** The "My View" nickname pencil ([PlayerView.jsx](apps/inorout/src/views/PlayerView.jsx))
always showed "Failed to save" for any plain player (e.g. `rockybram`, `p_cQ-NpVz55ng`, nickname
stuck `null`). The RLS rewrite (commit `7bd7ef2`) changed the `setPlayerNickname` wrapper from a
direct-table write `(playerId, teamId, nickname)` to the **admin-only** RPC
`admin_update_player_name(adminToken, playerId, nickname)`. SquadScreen + PlayerProfile (both admin
paths) were updated; the player-self call site was missed and kept calling
`setPlayerNickname(myId, teamId, myNick)` — passing the player id as the admin token and the team id
as the player id, so `resolve_admin_caller` rejected it (`invalid_admin_token`). A plain player has
no admin token at all, so no player-self path ever existed. Classic Hard-Rule-#7 signature-drift miss.

**Fix (mig 233).** New token-authenticated `set_my_nickname(p_token, p_nickname)` mirroring the
audited `set_player_note` pattern (Hard Rule #9), and restoring the same-team `nickname_taken` clash
check that the original direct-write wrapper did before `7bd7ef2` dropped it. New `setMyNickname`
wrapper; My View call site now `setMyNickname(me?.token, myNick)`. Ephemeral-verified (set / return
shape / clash / clear / audit / invalid-token all pass; leak-check 0). **Real-iPhone confirmed**
(session 77 — Rocky + operator both saved successfully on device; Hard Rule #13 satisfied).

## SESSION 76 — RESOLVED: "spot opened" reserve notification was unreliable + partial (mig 230)

**Defect.** The "🟣 a spot's opened — tap to claim" push was fired **client-side** from the
dropping player's OWN device, only via the self-toggle (`PlayerView.setStatus`). It therefore
**did not fire** when an admin marked a player out, when a player was disabled/removed, or when an
in-player was marked injured (which drops them to `out`) — and was lost entirely if the dropping
device failed to POST (fire-and-forget `.catch(console.error)`). Reserves could silently miss a
spot opening.

**Fix (mig 230, PR #6).** Replaced with a server-side DB trigger `notify_spot_opened`
(`AFTER UPDATE OF status, disabled ON players`) that detects ANY spot-freeing transition and pushes
to the next reserve via `net.http_post` → `/api/notify` direct mode. Exception-swallowing (never
breaks the player write). Client block removed. **Anti-spam:** the weekly squad reset would have
fired the trigger per-row mid-statement → both go-live RPCs now set a transaction-local
`inorout.bulk_reset` GUC before the reset; the trigger skips it (proven load-bearing). No
auto-promotion — tap-to-claim unchanged. Ephemeral-verified (all 4 freeing paths → next reserve;
cancelled/no-reserve/bulk-reset = 0; leak-check 0). **Owed:** real-iPhone confirmation post-deploy.

## SESSION 71 AUDIT — full-codebase sweep of recurring bug classes

A six-domain read-only audit (names-vs-IDs, timezone/notifications, guests, payments,
silent-persistence, VC/admin auth) cross-checked against the live DB. Findings being
worked as **Batch A (HIGH) first**, then B/C. Open (not-yet-fixed) items from the audit
are tracked in the OPEN section below; fixed ones move to RESOLVED as they land.

**Batch A status — COMPLETE:** #1 VC parity (mig 208) ✅ · #3 guest FK orphans (mig 209) ✅ ·
#4 HistoryView id-resolution (ba282a3) ✅ · VC schedule access (mig 210) ✅ · #2 self-pay =
pending claim (mig 211) ✅. VC parity now complete across all 28 casual admin_* RPCs; payment
reconciliation closed (team_KPaoX £45 owes == £45 ledger).

**OPEN — remaining from session-71 audit (Batch B/C, priority order):**
- **[Batch C] Removed-guest names in Results — LARGELY RESOLVED by PERSISTENT GUESTS S1
  (mig 216, session 72):** previously a guest's id in `matches.team_a/team_b` stopped resolving
  once the guest was deleted on rollover. As of S1 guests are NO LONGER deleted — they go dormant
  and persist, so any FUTURE removed-guest id still resolves to a live `players` row (real name
  shows); the lineup-name-snapshot enhancement is now unnecessary for new matches. The S4 "Guest"
  fallback (commit ff3eb8c) still covers already-deleted PAST guests, whose rows died before S1.
  Past names remain unrecoverable.
- **[RESOLVED session 89] `SquadScreen.jsx` duplicate object key `minWidth`:** the `ms-menu`
  dropdown `style` literal carried both `minWidth: 180` and `minWidth: 220` (the later `220` won),
  emitting a non-blocking vite `Duplicate key "minWidth"` warning. Removed the shadowed `minWidth: 180`
  — preserves the rendered behaviour exactly (220 was already applied) and clears the warning.
- **[NEW — LOW, persistent-guests S5 deferral] Gaffer top-reliable doesn't filter guests:**
  `gaffer_get_context_team_summary` (mig 034) builds its "top reliable last 30 days" list from
  `player_match` without an `is_guest=false` filter, so a guest could appear in the AI's context.
  AI-context only (not a user-facing reliability table — those are guest-filtered, see mig 219).
  Close when the Gaffer/Phase-7 AI layer is next worked. Also `getHeadToHead` doesn't filter
  guests, but H2H is a per-record comparison (decision 2 allows a guest's own record) — not a bug.
- **[Batch C] Remaining (low/cosmetic, left as-is):** no cap on guests per host; dead
  `attendance.js` helpers (calcStreaks / topSingleGame / getHatTricks / biggestWins —
  unexported, zero call sites; harmless). (HistoryView legacy POTM crown / last-goal-scorer
  fixed alongside #4.)
---

## RESOLVED (session 73, AdminView) — admin couldn't reorder the reserve queue

Reorder from Admin ▸ Reserve silently failed (optimistic move reverted). Two causes:
1. **Touch:** the only reorder affordance was an HTML5 drag handle (`draggable`/`onDrop`),
   which does not fire on touch screens — so on a phone/tablet (the operator's primary
   device) reordering was impossible by any means.
2. **Count mismatch:** `admin_reorder_reserves` validates that the id set sent equals the
   FULL count of `status='reserve'` players (it does NOT filter injured). Before the
   mig-220 injured fix loaded, the admin reserve list excluded injured players, so a team
   with an injured reserve (Footy Tuesdays: Callum + Kyle🤕 + Happy) sent fewer ids than
   the server counted → `reserve_set_changed` → revert.

Fix: added tap **up/down arrows** to each admin reserve row (`nudgeReserve`, shares a new
`persistReserveOrder` helper with the existing drag path) — works on touch AND desktop,
with ends correctly disabled. The reserve list now includes injured players (mig-220
change), so the id set it sends matches the server count. Verified end-to-end against the
live RPC: tapped Kyle (injured) down to last → DB persisted Callum 0 / Happy 1 / Kyle 2.

Latent note (not fixed, low): `admin_reorder_reserves` also counts `disabled` players with
`status='reserve'`, which the client always hides — a disabled reserve would re-trigger the
same mismatch. No such row exists today; tighten the RPC count to `AND NOT disabled` if it
ever surfaces.

## RESOLVED (session 73, mig 220 + AdminView) — injured reserve stuck at top of queue; player view & admin disagreed

A player could be both `status='reserve'` and `injured=true` at once (separate columns), and
the two surfaces rendered that state inconsistently:
- **Player view** (`PlayerView` via `groupByStatus`) kept the injured player in the reserve
  queue at their *old* position — e.g. shown as Reserve #1.
- **Admin view** (`AdminView/index.jsx`) filtered injured out of reserve entirely, so the same
  player showed only in the Injured section and the next reserve became #1.
Result: the injured player appeared as reserve #1 on My View while admin showed someone else as #1.

**Root cause:** `set_player_injured` / `admin_set_player_injured` only reset `status` to `'out'`
when `status='in'`. A reserve marked injured kept `status='reserve'` AND their queue position.
The client optimistically moved them to `'out'`, so the screen looked right until the next reload
pulled the stale `reserve` row back.

**Fix (product rule, session 73):** an injured player CAN still be a reserve (they may offer to
play) but auto-drops to the **bottom** of the reserve queue; admins can re-order them.
- **mig 220** — both injured RPCs now set the reserve's `reserve_priority_order` to `MAX(others)+1`
  when marked injured (status stays `'reserve'`). The `manage_reserve_priority_order` trigger only
  fires on status changes, so it doesn't interfere.
- **AdminView** — reserve list no longer filters injured (`!p.injured` removed) so admins can
  reorder injured reserves; a 🤕 marker shows next to them. They also remain in the Injured
  section (deliberate dual-listing).
- **PlayerView** — no code change; it already listed injured reserves and now orders them correctly.
- One live row repaired (team_KPaoX8oJYMQ: Kyle Bowden demoted below Callum).
Verified end-to-end via ephemeral-verify (5 assertions PASS, leak-check clean) + RPC security sweep.

**Owed:** real-iPhone walk of the reserve/injured surfaces (per hard-rule #13 / casual-regression).

## RESOLVED (session 71, HistoryView) — Results showed raw player IDs for removed guests

**Symptom (operator screenshot):** the expanded Results card for the 2 Jun Footy Tuesdays match
showed three raw IDs (`p_WEeIK8vS`, `p_RZDRbZyj`, `p_uXFt-4br`) where names should be. Confirmed:
all three are guests that were added then removed — their ids persist in `matches.team_a/team_b`
but the `players` rows are gone (weekly-rollover guest delete), so HistoryView's resolver fell
through to the raw id.

**Why it's only guests:** a regular player who appears in a saved match can't be deleted
(`admin_delete_player`'s has_history guard blocks it), so an unresolved roster id is always a
removed guest — "Guest" is an accurate label.

**Fix (HistoryView):** `toRosterObj` and `displayName` now render "Guest" for an unresolved
`p_…` id (legacy name-stored values are preserved). Fixes all past + future matches. Build clean,
hygiene 7/7.

**Forward enhancement (open, not done):** preserve the guest's *actual* name for future matches
via a lineup-name snapshot at result-save (the name is lost for past matches). See OPEN above.

## RESOLVED (session 71, mig 215 + ScheduleScreen) — "Update this week" one-off date override never worked

**Symptom:** the admin Schedule screen's "UPDATE THIS WEEK" control (a live button) silently did
nothing — two stacked bugs: (1) `applyDateOverride` sent the override as `gameDateTime` but
`upsertSchedule` only forwards `oneOffDate`, so `admin_upsert_schedule` received NULL and kept
the existing date; (2) even with (1) fixed, the RPC's one-off branch
`(p_one_off_date || 'T' || p_kickoff || ':00') AT TIME ZONE 'Europe/London'` would raise
`timezone(unknown,text)` (text→timestamp not implicit — same class as mig 212 create_team).
Both latent together: (1) kept (2) unreached.

**Fix:** mig 215 adds the `::timestamp` cast to the one-off branch (Europe/London, DST-aware);
ScheduleScreen `applyDateOverride` now sends `oneOffDate: dateOverride` and only shows "UPDATED ✓"
on a successful save (was an unconditional optimistic set that lied on failure).

**Verified:** ephemeral-verify PASS (one-off override → game_date_time = 2026-07-16 20:30 London)
+ leak-check 0; ScheduleScreen build clean + hygiene 7/7.

## RESOLVED (session 71, cron.js) — advanceGameDateJob DST-boundary drift (kickoff ±1h on clock-change weeks)

**Symptom (latent, known-open since session 50, 2 weeks/year/team):** the weekly auto-rollover
`advanceGameDateJob` advanced `game_date_time` with `d.setDate(d.getDate()+7)` — in the Vercel
machine TZ (UTC), preserving the absolute instant +168h. Across a DST boundary the UK wall-clock
kickoff shifted ±1h (e.g. 20:00 → 21:00 the week after the clocks go forward), so that week's
kickoff-relative crons fired an hour off until the next rollover corrected it.

**Fix:** new `ukAdvanceDays(iso, days)` helper in cron.js advances the **UK wall-clock** (keeps
hour/minute/weekday fixed) and recomputes the UTC instant using the Europe/London offset valid
on the new date (Intl-based, same DST-aware approach as the other cron helpers). `advanceGameDateJob`
now uses it.

**Verified:** node test across both 2026 boundaries — spring (Tue 24 Mar 20:00Z → 31 Mar 19:00Z =
UK Tue 20:00) and autumn (Tue 20 Oct 19:00Z → 27 Oct 20:00Z = UK Tue 20:00), plus a normal week
(unchanged) — all hold the 20:00 UK wall-clock. `node --check` clean.

## RESOLVED (session 71, migs 213/214 + JS) — Batch C cleanup: notify whitelist + dead code

- **notify_team_change whitelist (mig 213):** added the 10 reasons emitted by live RPCs but
  previously un-whitelisted (week_opened, week_reopened, groups_cleared, group_assigned,
  player_contact_updated, player_left_squad, result_corrected, fixture_status_changed,
  match_event_recorded, match_started) — every one was logging a `RAISE WARNING` per call
  (harmless, but the mig-121/127 latent-drift class). Verified: emitted ⊆ whitelist (0 gaps).
- **Dropped dead `cast_potm_vote` (mig 214):** complete-but-superseded POTM RPC, zero callers
  (JS + SQL), anon-granted, no audit. The live path is `submit_potm_vote`. Down recreates it.
- **Removed dead `getLedgerForTeam` / `getOutstandingBalance`** from supabase.js + barrel — no
  consumers, and they were direct `payment_ledger` reads RLS blocks anyway (latent footgun for
  a future consumer). Build clean.

## RESOLVED (session 71, commit BibsScreen) — dead hidden bib-assign block (silent "save" that never persisted)

**Symptom (latent — no live impact):** the audit flagged BibsScreen's SAVE as pure local
state (no RPC, no adminToken prop). On inspection the entire "WHO HAS THEM TONIGHT" assign
block — including that SAVE button — was wrapped in `display:"none"`: hidden dead code left
over from when bib assignment moved to result entry (ScoreScreen → admin_save_match_result,
migs 205/206). So there was no user-facing bug, just a dead silent-persistence handler waiting
to mislead.

**Fix:** removed the hidden block + its dead `saveBibs`/`bibCounts`/`bibHolder`/`bibSaved`
state and the BackBtn resets that referenced them. BibsScreen is now cleanly read-only (current
holder, history, stats). Also removed a `#0A0A08` hardcoded hex that lived in the dead block.
No persistence wired up — the holder is correctly set at result entry. Build clean, hygiene 7/7.

## RESOLVED (session 71, mig 212) — create_team built the first game_date_time in UTC (summer reminders 1hr late)

**Symptom:** a brand-new squad's first-week cron reminders (lineup lock, 1hr-before, POTM)
fired 1hr late in summer. `create_team` computed the first kickoff from bare `now()` (UTC on
the server): `date_trunc('day', now()) + kickoff` stored e.g. 20:00 UTC = 21:00 BST. The
day-of-week / "past kickoff today" tests also used UTC (wrong-week risk 00:00–01:00 BST). Only
the onboarding week (self-corrects at first rollover), but that's the highest-visibility week.
Same class as mig 207, on the create path.

**Fix (mig 212):** day-of-week, the past-kickoff test, and the kickoff instant all derive from
`now() AT TIME ZONE 'Europe/London'`, composing the final timestamptz via
`(...::date::text || 'T' || p_kickoff || ':00')::timestamp AT TIME ZONE 'Europe/London'` —
note the explicit `::timestamp` cast (text→timestamp is not implicit; without it the expression
raises `timezone(unknown, text)`). Also added the missing `SET search_path TO 'public',
'pg_temp'` (create_team was SECURITY DEFINER with none).

**Verified:** ephemeral-verify 3/3 PASS (kickoff resolves to 20:00 London, lands on the right
weekday, in the future) + leak-check 0 (no `%e2e%` teams/players left) + SECDEF / single
overload / search_path set / anon+authenticated grants preserved.

**Discovered (latent) — RESOLVED (mig 215):** `admin_upsert_schedule`'s one-off-date branch had
the identical text→timestamp cast bug — it never fired because the UI didn't send `p_one_off_date`.
Fixed in `215_upsert_schedule_oneoff_cast.sql`, which adds the explicit `::timestamp` cast to the
one-off `game_date_time` construction (`((p_one_off_date || 'T' || p_kickoff || ':00')::timestamp)
AT TIME ZONE 'Europe/London'`) alongside the ScheduleScreen "update this week" wiring. Verified
against the live function body session 89.

## RESOLVED (session 71, mig 209) — guest deletion leaked FK-less player_match + payment_ledger orphans

**Symptom (data integrity, latent):** `player_match` and `payment_ledger` have no foreign key
to `players`. Guests (is_guest=true) are deleted weekly by the go-live rollover and on-demand
by `remove_guest_player`, leaving their child rows dangling. Live DB carried 3 orphan
`player_match` + 2 orphan `payment_ledger` rows — including a removed guest's (`p_WEeIK8vS`)
unpaid £5 `guest_fee` that inflated the ledger-based outstanding total (the £55 figure).

**Fix (mig 209):** every path that deletes a guest's `players` row (`remove_guest_player`,
`admin_go_live`, `admin_go_live_for_team`) now deletes that guest's `player_match` +
`payment_ledger` rows (scoped by team_id) first. A one-off DELETE swept the existing orphans
(rows whose player_id no longer exists in players). Real players' history is never touched —
deletes are scoped to the guest ids being removed.

**Verified:** orphans 0 after apply; team_KPaoX8oJYMQ reconciliation moved £55 → £50 ledger
(the dead guest's £5 gone; remaining £45-vs-£50 is Bidz, the pending-claim item above).
Ephemeral-verify 3/3 PASS (remove_guest cleans children, go_live cleans guest children, HOST's
own child rows preserved) + `_e2e_%` leak-check = 0. All 3 RPCs SECDEF, single overload,
search_path set, grants correct (go_live_for_team service-role only).

**Lesson:** when a table has no FK to a row that gets hard-deleted, every delete path must clean
the children explicitly. Guests are the only routinely hard-deleted player.

---

## RESOLVED (session 71, mig 208) — Vice Captains rejected by admin_go_live + admin_reorder_reserves

**Symptom (latent, would hit any VC):** the session-49 open follow-up. A Vice Captain
operates AdminView via `/p/<vc_token>`, so their 21-char player token is passed as
`adminToken`. `admin_go_live` ("Open Next Week") and `admin_reorder_reserves` (drag-reorder
reserves) still authenticated with a bare `SELECT id FROM teams WHERE admin_token = p_admin_token`
— a VC's player token never matches a 28-char team admin_token → `invalid_admin_token`, silent
failure. The audit confirmed these were the **last two** of the 28 casual admin_* RPCs still on
the bare lookup (the mig-075 sweep + migs 116/162 fixed the other 26; `admin_go_live_for_team`
is cron/service-role only).

**Fix (mig 208):** both now resolve the caller via `resolve_admin_caller(p_admin_token)`
(admin_token OR VC player_token), with the existing `IF v_team_id IS NULL THEN RAISE
'invalid_admin_token'`. Audit rows now use the resolved `actor_type`/`actor_identifier`
(a VC action logs as `vice_captain`, not a hardcoded `team_admin`). Bodies otherwise re-applied
byte-for-byte; admin_go_live keeps its mig-204/207 squad-reset + guest-cleanup block. No grant
change — both already granted anon + authenticated (the token check is the security gate, as on
all sibling admin RPCs).

**Verified:** deterministic (both use resolver, no bare lookup, SECDEF, single overload, grants
preserved) + ephemeral-verify (seeded `_e2e_` team with a VC + 2 reserves: resolver recognises
VC token, VC reorders reserves, VC opens the week, audit logs `vice_captain`, bad token still
rejected — 5/5 PASS) + `_e2e_%` leak-check = 0.

**Follow-up resolved (mig 210):** `admin_upsert_schedule` — the only remaining bare-lookup
admin RPC — was fixed once the operator confirmed VCs are full deputies (see below).

## RESOLVED (session 71, mig 211 + JS) — self-pay was treated as fully paid; payment model reworked to "pending claim"

**Symptom:** when a player tapped "I've paid" (`set_player_paid`), the system marked them
fully paid and zeroed `owes` — so a self-declared claim vanished from the admin's outstanding
list before the admin had confirmed receiving the money. The ledger-based total (Gaffer /
per-player history) and the flat `Σ owes` total disagreed (live: team_KPaoX £45 owes vs £55
ledger). Root cause: debt-clearing lived in `set_player_paid` (the claim), while
`admin_confirm_payment` (the confirmation) didn't touch `owes` at all — backwards.

**Decision (operator):** a player's "I've paid" is a PENDING CLAIM awaiting admin confirmation,
kept visibly outstanding until confirmed. Guests stay confirmed-on-declare (no admin-confirm
path exists for guests).

**Fix (mig 211 + JS):**
- `set_player_paid` → flags `self_paid` only; **owes unchanged, ledger untouched** (claim).
- `admin_confirm_payment` → now also `owes = 0` (confirmation is the real money event).
- `admin_reset_payment` → restores `owes` by the charge amount when undoing a CONFIRMED
  payment (a mere claim leaves owes alone).
- `set_guest_payment` → added the missing `audit_events` row (HARD RULE 9 / finding B2), and
  fixed a **latent bug**: `v_ledger_id` was declared `text` but `payment_ledger.id` is `uuid`,
  so the UPDATE branch (`WHERE id = v_ledger_id`) raised `uuid = text` whenever a guest_fee
  row already existed — masked by the WHEN OTHERS catch. Now `uuid`.
- Engine/UI: `getPaymentState` adds a `claimed` state; PaymentsScreen shows "claims paid ·
  CONFIRM" (amber) and keeps claimers in the outstanding list (`isPaid` = confirmed only);
  PlayerView shows "Awaiting confirmation" and no longer optimistically zeroes owes on self-pay.
- **Hygiene fix (same cycle):** the 5 payment `supabase.rpc()` calls in `packages/core/engine/
  payments.js` were moved into named `supabase.js` wrappers (`setPlayerPaid`, `setGuestPayment`,
  `resetPayment`, `waiveDebt` + existing `confirmPayment`) — a pre-existing violation of the
  raw-rpc-only-in-supabase.js rule the hygiene hook surfaced. Behaviour identical.
- **One-off reconciliation:** a confirmed-paid player (paid=true, owes=0) with a stale unpaid
  game_fee ledger row (Bidz `p_4ef07e08`) — the row marked paid so Σ owes == unpaid ledger.

**Verified:** ephemeral-verify 4/4 PASS (claim keeps owes & self_paid; confirm clears owes +
ledger paid; reset restores owes + ledger unpaid; guest uuid-fix + audit + flag) + `_e2e_%`
leak-check = 0; live reconciliation team_KPaoX **£45 owes == £45 unpaid ledger**, 0 stale rows;
build clean, hygiene 7/7 on all changed files.

## RESOLVED (session 71, mig 210) — admin_upsert_schedule rejected Vice Captains (VC parity complete)

**Symptom:** `admin_upsert_schedule` (save schedule + save reminders, both via
`upsertSchedule`) authenticated with a bare admin_token lookup, so a VC editing the schedule
or reminders via `/p/<vc_token>` got `invalid_admin_token`. The last casual admin_* RPC on the
old pattern.

**Decision:** operator confirmed Vice Captains are full deputies (may edit schedule/reminders).

**Fix (mig 210):** resolves via `resolve_admin_caller`; audit actor_type reflects `vice_captain`.
Re-granted EXECUTE to anon + authenticated — mig 207 had revoked anon as a tidy-up, leaving this
the only admin RPC not granted to anon; the security gate is the SECDEF + token check (an anon
caller still needs a valid admin/VC token), consistent with all 27 siblings and required for an
unauthenticated VC/admin (PWA cold-start, mig-125 lineage). mig-207 BST fix preserved.

**Verified:** deterministic (resolver in, bare out, SECDEF, single overload, anon+auth granted)
+ ephemeral-verify 4/4 PASS (VC upserts schedule, kickoff persisted, audit logs vice_captain,
bad token rejected) + `_e2e_%` leak-check = 0. **VC parity now complete across all 28 casual
admin_* RPCs.**

## RESOLVED (session 70, commit e6f9459) — stale guest row blocks Plus One button on weekly rollover

**Symptom (operator):** Gurnam couldn't add Pav as a guest for this week's game — the "Plus One"
button was missing. He had added Pav the previous week. The workaround was to tap "Remove" on the
old guest card, then add Pav fresh. This would have hit any player who regularly brings a +1.

**Root cause:** `add_guest_player` creates a `players` row with `is_guest=true`. On weekly
rollover `admin_go_live` / `admin_go_live_for_team` reset all player statuses to `'none'` but
never deleted the guest rows. The next week, `PlayerView` found the stale row via
`squad.find(p => p.isGuest && p.guestOf === myId)` and rendered "your +1 — Pav" (status='none')
instead of the Plus One button. The host had no way to add a new guest until they manually
removed the old one first.

**Fix (mig 207):** both go-live RPCs now delete all `is_guest=true` rows for the team inside
the new-match-creation block (`IF v_match_id IS NULL`), before the bulk status reset. Order:
DELETE from `team_players` first (NO ACTION FK on `players.id`), then DELETE from `players`
identified via `guest_of` pointing to a host still on the team. Idempotent re-taps (reusing a
live match) hit the `v_was_existing` path and skip the delete entirely — a guest added mid-week
is safe. All other FKs on `players.id` are SET NULL or CASCADE; no manual cleanup needed.
RPC security sweep PASS. No JS changes.

**Verified:** DB query confirms the stale guest rows from Footy Tuesdays (including `p_RZDRbZyj`
which Gurnam had to manually remove this morning) are gone from the `players` table. Gurnam
manually worked around it at 12:04 today; Pav (`p_Wi6P2ddr`) is correctly in for Tuesday.

---

## RESOLVED (session 69, commit 4e351b6) — BST timezone offset: all cron notifications 1hr late in summer

**Root cause:** Two separate UTC-vs-BST failures, both harmless in winter (GMT = UTC) but 1hr wrong from late March onwards. (1) `admin_upsert_schedule` built `game_date_time` as `(date || ' ' || kickoff || ':00')::timestamptz` — a bare cast that PostgreSQL interprets as UTC on the Supabase server. Admin enters "20:00" meaning 8pm UK; system stored 20:00 UTC = 21:00 BST. Every kickoff-relative cron job was therefore 1hr late: `oneHrBefore` fired at kickoff, `lineupLock` fired 1hr into the game, `bibs45min` fired after kickoff, `potmVotingOpen` 2hrs after real kickoff. This was a documented "Known limitation (Phase 1)" in mig 013. (2) `notify.js` `gameDay9am` used `now.getHours() === 9` — UTC hours on Vercel, so fired at 9am UTC = 10am BST.

**Fix:** SQL now uses `(date || 'T' || kickoff || ':00') AT TIME ZONE 'Europe/London'` (DST-aware, auto-adjusts each year at clocks change). JS `gameDay9am` now uses `Intl.DateTimeFormat` with `timeZone: 'Europe/London'` matching the pattern already used in `cron.js`. One-off data migration subtracted 1hr from the 3 live schedule rows (Jun 9 + Jun 10 games). Also corrected a stale REVOKE/GRANT: prior migrations referenced the 13-param function signature; live function has 14 params (p_game_is_live, added session 27), so REVOKE never applied — anon had EXECUTE on an admin-only RPC. Fixed to authenticated-only. Files: `rls_migrations/207_fix_game_date_time_timezone.sql`, `apps/inorout/api/notify.js`. Commit: 4e351b6.

## RESOLVED (session 69, commit 5edd64f) — live updates stale after PWA returns from background

**Symptom (operator):** had to fully close and reopen the installed PWA to see the
latest info — live in/out updates didn't come through after the app had been
backgrounded on iOS. Live updates were fine while the app stayed open.

**Root cause:** iOS suspends the PWA and tears down the realtime WebSocket when
backgrounded. The only `visibilitychange` handler refreshed the auth token and
nothing else — never reconnected the socket, never re-fetched state. Broadcast /
postgres_changes events that fired during suspension are ephemeral and lost
forever, so the app stayed frozen until a full relaunch re-ran the initial load.

**Fix:** (1) `packages/core/storage/supabase.js` — realtime client given a short
capped `reconnectAfterMs` backoff + 20s timeout. (2) `apps/inorout/src/App.jsx` —
extracted a shared `refreshTeamData()` catch-up (player/admin/demoadmin), reused
by the team_live broadcast handler; replaced the auth-only visibility effect with a
resume handler on `visibilitychange`/`pageshow`/`focus` that refreshes auth (still
throttled 5 min), reconnects realtime when disconnected, and runs an **unthrottled**
full re-fetch on every foreground. `isRefreshing` ref dedupes the overlapping
resume events. Declared above the resume effect to avoid a TDZ on its dep array.

**Verified:** real iPhone home-screen install, Footy Tuesdays — change made during a
90-second suspension appeared instantly on foreground, no relaunch. Live code
confirmed serving on www.in-or-out.com (fix markers present in the deployed bundle).
Not a PWA limitation; Capacitor not required. See GO_LIVE_ISSUES.md §7.2,
DECISIONS.md, and [[project_inorout_deploy_and_pwa_update]] (memory).

## RESOLVED (session 68, mig 206 + JS) — follow-ups: admin_locked_in stuck-lock, Stats bib-duty, POTM avatar, orphaned-guest Remove

Smaller fixes around the migs 204/205 cluster (below):

- **admin_locked_in stuck across weeks (mig 206).** End-of-session audit found result-save
  reset `status='none'` but left `admin_locked_in=true`; go-live (204) clears it only on
  new-match creation, so the idempotent double-tap reuse path could leave a force-in player
  locked next week. mig 206 adds `admin_locked_in=false` to the fresh-save reset. EV'd.
- **Stats "Bib Duty" always empty.** `StatsView` league-table rows were built without a
  `bibCount`, so `filter(p => p.bibCount > 0)` matched nothing. Now accumulated from
  `matchHistory.bibHolder` (id-first/name-fallback, period-filtered) like POTM.
- **POTM trophy missing on avatar.** `Avatar` had a bib dot but no POTM badge, and the in/out
  list never told it who the POTM was. Added `hasMotm` 🏆 badge (bottom-right) wired across the
  squad list via `isLastMotm` (id-first/name-fallback).
- **Orphaned-guest "Remove" (host dropped out)** called `deletePlayer` → blocked by the
  has_history guard and would delete the squad row. Now `adminSetPlayerStatus(...,'none')` —
  un-enters them for the week, keeps the squad row. (First shipped as `'out'`, corrected to
  `'none'` per operator: 'out' reads as an active decline.)
- **MY IO tab blank for recent matches.** `computeDeeperIntel` (packages/core/engine/deeperIntel.js)
  resolved teammates/opponents by NAME only against matchHistory.teamA/teamB (now IDs) → all 6
  insight cards (most-played-with, nemesis, partnership, most-faced, impact, reliability ranking)
  came back empty. Also `computeStatsFromHistory` (App.jsx) keyed the player's own win/loss/goals/
  scorers + squad form-dots by name (admin route only — the player route gets these server-side
  from player_match, which was always correct). Both made id-first/name-fallback. **Stats tab was
  already safe** (table fixed earlier; form/reliability + H2H are player_match-backed).

See DECISIONS.md "Casual result-save pipeline — settled invariants" and
[[project_result_save_invariants]] (memory).

## RESOLVED (session 68, mig 205) — result-save did nothing: £0 outstanding, empty payment history, dead admin Bib tracker

**Symptoms (Footy Tuesdays):** after a £5/player game with 9 non-payers, the admin
panel showed **£0 outstanding**; nobody appeared as owing; the admin **Bib tracker was
empty**; and per-player payment history had no charge rows for the game.

**Root cause:** `admin_save_match_result`'s "fresh save" guard was
`v_is_fresh_save := (player_match row count = 0)`. The kickoff lineup-lock cron
pre-creates `player_match` rows, so every real result save read as a **re-save**
(`is_fresh_save=false`, confirmed in audit_events) and **skipped the entire
end-of-match block**: owes for non-payers, the new-week payment reset, and stats.
Separately, the result-save never cascaded the bib holder into `bib_history` (the
table the admin Bib tracker reads — it had 0 rows), and the fresh block carried a
**latent ambiguous-column bug** (`attended`/`goals` unqualified while `player_match`
also has those columns) that only surfaced once the block actually ran.

**Fix (mig 205):**
- Freshness now keys on `matches.winner` — NULL until the first finalisation (the
  lineup-lock doesn't set it) — a correct one-shot signal the pre-lock can't defeat.
  Already-finalised matches (winner set) read as re-saves → never double-charge.
- Qualified `p.attended`/`p.total`/`p.goals`/`p.w/l/d/owes` in the fresh block.
- Added a `payment_ledger` `game_fee`/`unpaid` charge row per unpaid non-guest
  attendee (mirrors the owes condition; `admin_confirm_payment` promotes it to
  `paid`; `get_my_payment_history` surfaces it) so the charge shows in each player's
  payment history.
- Cascaded the bib holder into `bib_history` (+ `bib_count`) so the admin Bib
  tracker reflects the holder chosen at result entry.
- **Live backfill** of last week (m_WXZHG): 9 unpaid non-guest attendees charged £5
  (= £45 outstanding) with matching ledger rows, idempotently (NOT EXISTS guard); the
  bib holder (rockybram) written to `bib_history`. Payment flags carried over per the
  established model — guests and already-paid players excluded.

**Verified:** ephemeral-verify proved the save is fresh **despite pre-existing
player_match rows**, owes/ledger/bib_history all populate, and a re-save does not
double-charge; rollback + `_e2e_%` leak-check = 0. Single overload, SECURITY DEFINER,
grants preserved.

**Lesson:** never key "first time" idempotency on a side-effect table that another
job also writes. Use a column that only the finalising action sets (here, `winner`).

## RESOLVED (session 68, mig 204) — post-game-completion trio: locked board, stats show only POTM, share results show IDs

**Symptoms (operator-reported, Footy Tuesdays `team_KPaoX8oJYMQ` after match `m_WXZHG_SM9Zc`):**
(1) last week's teams still "locked" — players couldn't say in/out this week; (2) the Stats tab
showed only the POTM, nobody else; (3) Results → Share Results listed raw player IDs under Team A/B
while POTM and Bibs showed names.

**Root causes — two, one shared:**
- **Locked board:** opening a new casual week never reset player `status`. The whole squad still
  carried `status='in'` from last week, so the squad read as **full** → `set_player_status` threw
  `squad_full` for anyone trying to come in, and the already-`in` players saw the "🔒 Locked in"
  badge. Only cancel-reopen and the **demo-only** cron ever reset status; the real go-live RPCs
  (`admin_go_live`, `admin_go_live_for_team`) did not.
- **Stats + Share (shared cause):** the save path writes player **IDs** into
  `matches.team_a/team_b/scorers/motm/bib_holder` (required — `player_match` keys on `player_id`),
  but two display consumers still resolved by **name only**. `StatsView` rebuilt its table from
  `matchHistory` with a name-only `lookup()`, so every outfield player resolved to null and only the
  POTM block (id-first) survived. `HistoryView`'s share-text joined the raw ID arrays.

**Fix:**
- **mig 204** adds a status/team reset to both go-live RPCs, gated to the *new-match-creation* path
  only (idempotent re-calls/double-taps never wipe a week already in progress). Resets
  `status='none'`, `admin_locked_in=false`, `team=NULL`. **Payment flags carry over by design**
  (paid/self_paid/paid_by/paid_at/owes) so the "Owes" balance keeps working — this intentionally
  differs from the cancel-week reset.
- **StatsView.jsx**: added `resolve = v => byId[v] || lookup(v)` (id-first, name-fallback) for team
  rosters and scorers, mirroring the existing POTM line.
- **HistoryView.jsx**: share text now resolves Team A/B + scorers via the existing `findPlayer`
  helper (name-first, id-fallback) → shows `nickname || name`.
- Both display fixes are backward-compatible with legacy name-stored matches (e.g. demo seed).
- One-off live repair reset the stuck Footy Tuesdays squad (24 players → `status='none'`, payment
  preserved) so this week works without waiting for the next open.

**Verified:** ephemeral-verify on `admin_go_live` (reset ✓, locks cleared ✓, teams cleared ✓,
payment carried ✓, rollback ✓, `_e2e_%` leak-check = 0); both RPCs `SECURITY DEFINER`, single
overload, grants preserved; clean build.

**Lesson:** when a write path migrates from names to IDs, grep every *read* consumer — a returned/
stored ID is silent in a name-keyed lookup. Resolve id-first with name-fallback so old + new rows
both work.

## RESOLVED (session 64, mig 182) — HQ health score returned but never rendered in the UI

**Symptom:** the mig-179 (session 63) Health Score work added `health_score` / `health_reason` /
`health_axes` to `hq_get_company_state` and the commit message (cc06212) stated "Consumer apps/hq
VenueHealthGrid now shows the score." It did not — the commit touched **only** the two SQL files.
An independent grep found **zero** consumers of those fields anywhere in apps/hq, so the score and
reason were invisible; only the red/amber/green dot reflected the score.

**Root cause:** a session-63 tooling-lag incident (Read/Bash output hallucinating/lagging) — the
frontend edit was believed applied but never landed, and the commit's own success message was
trusted instead of an independent grep. Classic [[feedback_verify_tool_success]] failure mode.

**Fix:** Payments V4 (mig 182) wires `health_score` (a band-coloured badge) + `health_reason`
(a line under the venue name) into `VenueHealthGrid.jsx`. Confirmed by grep (`health_score`,
`health_reason`, `healthClass` all present) + clean build. The same cycle added the revenue axis,
so the score the badge now shows already includes collection-rate.

**Lesson reinforced:** after any commit claiming a frontend wire-up, grep the consumer for the new
field — never trust the commit message. A returned-but-unconsumed field is silent.

## RESOLVED (session 56, mig 162) — Vice Captains got `invalid_admin_token` on the Teamsheet

**Symptom (latent, never user-reported):** a Vice Captain opening the 5.6 Teamsheet via
`/p/<vc_token>` would have hit `invalid_admin_token` — both the card read
(`get_team_next_fixture_lineup`) and the submit (`team_admin_submit_lineup`) resolved the
caller with a bare `SELECT id FROM teams WHERE admin_token = p_admin_token`. A VC's 21-char
player token is not a 28-char admin_token, so the lookup missed every time. Same class as the
mig-116 `admin_delete_player` bug; violated the session-49 dual-lookup DECISION. Masked because
the testbed used the team owner's admin_token, never a VC's.

**Fix (mig 162, Cycle 5.7):** both RPCs (and the new `team_admin_check_eligibility`) now resolve
the caller via `resolve_admin_caller(p_token)` — admin_token OR VC player_token. The helper
RETURNS empty (doesn't raise) on a bad/NULL token, so each call is followed by an explicit
`IF v_team_id IS NULL THEN RAISE 'invalid_admin_token'`. Audit rows on submit now carry the
resolved `actor_type` (`team_admin` / `vice_captain`) instead of a hardcoded `team_admin`.

**Verification:** ephemeral-verify `vc-path` assertion PASS — submit via a VC player token
resolves and writes the lineup. **Rule extended:** any new `team_admin_*` RPC keyed on an admin
token must use `resolve_admin_caller` (see DECISIONS.md session 56).

---

## RESOLVED (session 55, mig 158) — global players.status dual-context edge

**Original concern (session 54, Cycle 5.5):** Cycle 5.5 made competitive availability
reuse the casual IN/OUT board, with a trigger (`reset_team_status_on_fixture_played`,
mig 157) that clears a team's `players.status` to `'none'` when a league fixture is
played. The flagged risk was that one `team_id` being both casual AND competitive would
have its casual in/out answers wiped on fixture completion.

**Correction to the original diagnosis:** the original framing ("the shared status
cross-talks between any two teams a player is in") was inaccurate. There is ONE
`players` row per (user, team) pair (migs 065–069), each with its own token, so
`players.status` is already scoped per (player, team). A person on a casual team AND a
separate competitive team has two distinct rows — they cannot collide. The ONLY real
edge was a *single* `team_id` being both casual and competitive, which could happen only
because `join_register_team` (mig 098) promoted an existing casual team in place
(`UPDATE teams SET team_type='competitive'`).

**Resolution (mig 158):** a league team is ALWAYS a separate squad. `join_register_team`
no longer promotes a casual team — a casual `existing_team_id` is rejected
(`casual_team_cannot_register`); only an already-competitive team may re-register (cup
reuse, Phase 11). A casual group joining a league creates a NEW squad (own team_id,
LEAGUE pill, second MY SQUADS entry). A casual `team_id` therefore can never be in a
competition, so the mig-157 trigger can only ever touch competitive squads — the
dual-context edge is structurally impossible. `players.status` and the casual read/write
paths are unchanged. See DECISIONS.md (session 55) for the decision rationale.

---

## TECH DEBT (LOW) — No in-app admin entry from MY SQUADS (session 54)

A signed-in admin has no in-app path from the player view to a team's admin view.
Admin mode is only reachable by opening the team's `/admin/<admin_token>` URL —
`isAdmin` is set solely on that route (`apps/inorout/src/App.jsx:496-506`); the
`/p/<token>` player view always renders as a player. MY SQUADS shows an ADMIN tag
but tapping a row goes to `/p/<token>`, never `/admin/...`.

**Surfaced:** session 54, setting up the Competitive FC testbed — the operator
expected to reach admin from the player view.
**Workaround:** open the team's admin link directly (e.g. Competitive FC =
`/admin/democomp_fc_admin_token`).
**Enhancement (own small cycle):** make the ADMIN tag / row in `MySquads.jsx` tap
through to that team's admin view (resolve the admin_token for teams where
`is_team_admin`). Low priority; useful for admins juggling multiple teams and for
competitive admins reaching the teamsheet (cycle 5.6).

---

## Note — pitch booking Stage 6 + hardening pass (session 53)

Stage 6 venue UI shipped (mig 150 + commits `df7764f`/`7503d11`/`6378c40`). A
pre-Stage-7 audit against GO_LIVE_ISSUES.md classes then found and fixed three
latent bugs (`202d16a`), none yet user-reported:

1. **Casual bookings list never refreshed on venue broadcasts.** `App.jsx`'s
   `team_live` subscriber refreshes team state but not the bookings list, and
   `ScheduleScreen` only loaded bookings on mount — so a team admin saw
   "Requested" forever after the venue confirmed/declined/cancelled. Fixed by a
   `team_live` subscriber in ScheduleScreen that re-fetches bookings on broadcast
   (`liveChannelKey` threaded App → AdminView → ScheduleScreen).
2. **Date off-by-one (toISOString/UTC).** `BookPitchModal` built date strings via
   `toISOString().slice(0,10)`; in BST (UTC+1) the midnight hour yields the prior
   day, writing a weekly-block start a day early. Same class as GO_LIVE §6.7 / §9.5.
   Fixed with a local-components formatter. (Same bug also fixed venue-side in
   `bookingUtil.isoDate`.)
3. **"Invalid Date" in venue booking detail/inbox** — formatted a tstz with the
   YYYY-MM-DD date-string helper; caught in the verify browser pass, added
   `fmtDayShort`. Never shipped.

Also added: venue cancel-from-grid (tap booking block → detail modal) and casual
cancel hardening (confirm + error surface + double-fire guard).

**Stage 7 (session 53, migs 151–152):** renewal right-of-first-refusal holds
(`create_renewal_holds`/`confirm_renewal`/`expire_renewal_holds`, 09:00-UK cron) +
push to admins for renewal-held/expired + fixture-superseded (`superseded_at` poll).
ephemeral-verify 7/7 + trigger verify + rpc-security-sweep all green. **Booking complete.**

**Known follow-ups (not bugs):** push-on-confirm deferred; transactional email is
Phase 9; off-system-venue outbound notify needs a sender. **Operator owes** the
real-squad + real-device pass incl. the three booking pushes (GO_LIVE §6 + §11).

---

## RESOLVED — notify_venue_change regressed in mig 121, fixed in mig 127 (session 51)

**Symptom (latent — server logs):** every Phase 2 RPC that calls
`notify_venue_change` (e.g. `venue_update_fixture_status` posting
`fixture_postponed`, `fixture_voided`, `fixture_walkover`,
`fixture_forfeit`) has been logging WARNING `unknown reason "X"`
since mig 121 landed a week ago. Realtime broadcasts still fired
(the warning is non-blocking), but every Phase 2 venue write was
spamming the Postgres log.

**Root cause:** mig 121 introduced the `notify_venue_change`
broadcast helper for Phase 3 ref events and inadvertently
overwrote the existing mig 101 body. Mig 101 had a 26-reason
whitelist (Phase 2 venue/league/fixture/ref/pitch/team events).
Mig 121's `CREATE OR REPLACE` shrunk the list to 3 reasons
(`match_started`, `match_event_recorded`, `match_result_saved`).
Every pre-existing reason started hitting the WARNING branch.

**Fix (mig 127, session 51):** since cycle 3.6 was rewriting
`notify_venue_change` anyway to add `'result_corrected'`, restored
the full Phase 2 list + added Phase 3 reasons in one body. Down
migration deliberately re-introduces the regression (a down must be
a strict revert of its up; the regression-fix is a side-effect of
127 that should go away if 127 is rolled back). Documented in mig
127 header. Commit: `563201b`.

**Audit reveals:** the same failure class could affect other
`notify_*` helpers if a future Phase rewrites them. Mitigation:
the existing `check-rpc-columns.sh` doesn't catch whitelist
shrinkage. Worth a future deterministic check (`check-notify-whitelist.sh`?)
but not in scope for any active cycle.

---

## RESOLVED — Reserve drag-to-reorder never persisted (session 51, feature wire-up)

**Symptom (latent — admin UX):** the admin home screen's reserves
section let admins drag-reorder reserve players. The drag worked
visually but the order was pure local React state. Refresh, route
change, or any realtime broadcast wiped it. There was no DB column
to store the order in at all, only a boolean `priority` flag.

**Verdict (per product decision):** the drag is supposed to persist
— the order means "who comes off the bench first when a spot opens".
Wired up as a new feature.

**Fix:**
- **mig 130:** `ALTER TABLE team_players ADD COLUMN reserve_priority_order int NULL`,
  plus a trigger `manage_reserve_priority_order_trg` on `players AFTER
  INSERT OR UPDATE OF status` that auto-maintains the column:
  - status becomes 'reserve' → append at MAX+1.
  - status leaves 'reserve' → clear that row's order, compact remaining
    reserves so there are no gaps.
  The trigger covers every status-change path because every RPC that
  changes status runs `UPDATE players SET status=…` (verified across
  set_player_status, admin_set_player_status). Backfill skipped — zero
  reserves existed in prod at apply time.
- **mig 131:** `admin_reorder_reserves(p_admin_token, p_reserve_ids text[])`
  SECDEF. Validates admin token, no duplicates, full reserve set
  (concurrency guard), every id is currently a reserve on the admin's
  team. Atomically writes positions 0..N-1. Audits via
  `admin_reorder_reserves` action. Broadcasts `player_updated`.
  Granted to anon + authenticated per parity-sweep pattern (mig 075).
- **mig 132:** added `reserve_priority_order` to the squad jsonb in
  `get_team_state_by_admin_token` and both branches (privileged +
  non-privileged) of `get_team_state_by_player_token`. Also extended
  `v_player` so the user's own bench position is available without
  depending on the squad payload (non-priv branch excludes self).
- **JS:** `dbToPlayer` mapper picks up `reservePriorityOrder` (HARD
  RULE 12). New wrapper `adminReorderReserves(adminToken, reserveIds)`
  in supabase.js, exported via the barrel. New helper
  `sortByReservePriority(players)` in `@platform/core/engine/availability.js`,
  used inside `groupByStatus` and at the three admin-display /
  spotOpened sites (App.jsx, PlayerView.jsx, AdminView/index.jsx).
- **AdminView/index.jsx `moveReserve`:** rewritten — async, optimistic
  local update (writes new `reservePriorityOrder` onto every affected
  squad row), calls `adminReorderReserves`, rollback on error. Same
  shape as today's reserveGuest fix.

**Smoke tests (DB-side, pre-deploy):**
- Trigger append: 3 demo players flipped to 'reserve' in sequence →
  trigger assigned 0, 1, 2 ✓
- Trigger gap-close: promoted middle reserve to 'in' → that row
  cleared to NULL, third compacted from 2→1 ✓
- `admin_reorder_reserves` shuffle: reordered [03,01,02] → pg state
  matched 0,1,2 in that order ✓
- `get_team_state_by_admin_token` returned `reserve_priority_order`
  on each squad row ✓
- Restore: all demo players back to 'none', orders NULL ✓

**Verification target (UI):** on /admin/ with ≥2 reserves, drag one
reserve above another. Refresh the page — new order persists. On a
second device viewing the same team, the order matches. Promote the
top reserve to 'in' — second reserve compacts to position 0.

**Free win:** PlayerView's `spotOpened` notification (when an "in"
player drops out) sends to `reserves[0]`. With the new sort,
`reserves[0]` is now the highest-priority reserve per admin's chosen
order, not whatever happened to be first in the raw squad array.

---



---

## RESOLVED — Admin rendered as another player on PWA cold-start (session 51)

**Symptom:** rockybram (team creator + admin of "Footy Tuesdays")
opened his iOS PWA today and was rendered as Pritpal — a regular
squad member. Affected every team creator whose access token had
expired client-side at PWA cold-start. Player and VC routes
unaffected (different code path).

**Root cause — twin latent bugs:**
1. `get_team_state_by_admin_token` (mig 070) and
   `get_team_state_by_player_token` (mig 080) built their squad
   via `jsonb_agg(jsonb_build_object(...))` with no `ORDER BY`.
   Squad order was non-deterministic — every call could return
   players in a different order.
2. App.jsx:1168 had a "best-guess" fallback when `myPlayer` was
   null: `myId = myPlayer?.id || (isAdmin ? squad[0]?.id : null)`.
   Combined with (1), unauthed admins on /admin/<token> were rendered
   as whoever squad[0] happened to be that millisecond.

iOS PWA cold-start was the trigger: refresh_token works but the
session attaches asynchronously, so `auth.uid()` was null when
the team-state RPC fired → `is_self=false` on every row → fallback
fired → Pritpal won the dice roll.

**Fix (mig 125, commit a1c13d0):** added `ORDER BY tp.created_at, p.id`
to all three squad `jsonb_agg` calls (admin RPC + privileged and
ordinary branches of the player RPC). Team creator is always first
now. Belt-and-braces JS-side guard exists on branch
`fix/admin-impersonation-guard` (kills the `squad[0]` fallback +
adds an "ADMIN VIEW ONLY" placeholder) — held until iPhone PWA test.

**Verification target:** open any admin link on a fresh iPhone Safari
in private mode → don't sign in → Add to Home Screen → open from
icon. Should see your own admin's PlayerView, not another player.
audit_events should show `app_boot` with `actor_user_id=null` AND
the rendered identity matching the team creator (squad[0] from
deterministic order).

---

## RESOLVED — "No active match" on admin Make Teams after cron auto-open (session 51)

**Symptom:** rockybram tapped Make Teams from /admin/. TeamsScreen
rendered "No active match — go live first before picking teams".
`schedule.game_is_live` was true (players had been marking in/out
all day) but `schedule.active_match_id` was null and no
non-cancelled matches row existed.

**Root cause:** `autoOpenGameJob` in api/cron.js (15-min cron that
opens the week at opens_day/opens_time) flipped `game_is_live=true`
via a raw `supabase.from("schedule").update(...)` but did NOT create
a matches row or set `active_match_id`. Mig 077 had fixed this for
the admin-UI go-live path by adding `admin_go_live(p_admin_token)`,
but the cron has team_id not an admin token, so it bypassed
admin_go_live entirely.

Latent since mig 077 shipped (the cron path was never updated to
match). Every team whose week is opened by cron (rather than by an
admin manually tapping Go Live in the UI) is in the broken state
from opens_time until lineupLockJob backfills the match 60 min
before kickoff.

**Fix (mig 126, commit c29b20d):** added `admin_go_live_for_team(p_team_id)`
RPC — team_id-keyed sibling of admin_go_live with the same
idempotence and matches-row ownership, plus `auto_open_pending=false`
(cron-specific). Service-role-only grant (anon + authenticated
REVOKED). Audit row uses `actor_type='system'` /
`actor_identifier='cron:auto_open_game'` to distinguish cron-driven
opens from admin-driven opens. cron.js change: replace the raw
update + notify with a single
`supabase.rpc('admin_go_live_for_team', { p_team_id })` call.

**Verification target:** wait for next Wednesday 14:34 (Footy
Tuesdays' opens_time). Confirm `audit_events` shows a `week_opened`
row with `actor_type='system'`,
`actor_identifier='cron:auto_open_game'`, and that the schedule has
`active_match_id` set to a non-cancelled match. Admin Make Teams
should be usable immediately, not blocked until 19:00.

**Recovery for rockybram (in-session):** called
`admin_go_live(admin_0OcDVOpcoGnujleetMhGYw)` manually via MCP to
backfill match `m_WXZHG_SM9Zc`. No data loss; no UI restart
required (realtime broadcast updated his client).

---

## RESOLVED — `reserveGuest` admin handler never persisted to DB (session 51)

**Symptom (latent, niche):** when a player who brought a "+1"
guest changes their own status away from "in", the guest becomes
an orphan and appears in the admin home screen's orphan panel.
The panel offers two buttons: "Remove" (worked) and "Move to
reserve" (didn't). Tapping "Move to reserve" visually moved the
guest out of the orphan list but the status flip lived only in
local React state — no RPC call. Within seconds the next realtime
broadcast (any teammate's status change, cron tick, anything)
re-fetched the squad from the DB, the guest reverted, and the
orphan re-appeared. Groundhog Day for the admin.

**Root cause:** [AdminView/index.jsx:146]
(apps/inorout/src/views/AdminView/index.jsx#L146) `reserveGuest`
was a one-liner: `setSquad(squad.map(...status:"reserve"));
dismissOrphan(id);` — exactly the same shape as today's earlier
`saveNote` bug. Pure local state, zero persistence. The wrapper
`adminSetPlayerStatus(adminToken, playerId, status)` existed at
supabase.js:1265 but was never imported into this file.

**Fix:** import `adminSetPlayerStatus`, make `reserveGuest` async,
optimistic local update first, RPC call, rollback `setSquad(prev)`
on error. Audit + broadcast are handled inside the RPC.

**Verification target:** as admin, with a +1 currently in the
squad whose host has dropped to "out"/"maybe", tap "Move to
reserve" on the orphan panel. Within seconds the guest's
`players.status` in DB should be "reserve", an `audit_events` row
should appear with `action='admin_set_player_status'`, and the
admin's view should NOT re-show the orphan on the next broadcast.

**Audit context:** found via the methodical re-audit (Category 1
silent-persistence sweep). Same class as the player-note bug
fixed earlier today; that suggests pure-state handlers were a
mini-pattern in admin orphan-handling code, not a one-off.

---

## RESOLVED — `link_player_to_user` missing realtime broadcast (session 51)

**Symptom (latent, niche, surfaced via re-audit):** user has
`/p/<token>` open in one tab and `/admin/<token>` open in another
(or PWA + browser tab). Signs in on the player tab → `user_id`
gets set in the DB. Admin tab's cached squad payload still has
`user_id=null` for that row → server-computed `is_self=false` →
`needsSelfAuth = isAdmin && !me?.isSelf` at PlayerView.jsx:96
stays true → OTP modal keeps popping on admin tab until manual
refresh.

**Root cause:** `link_player_to_user` UPDATEs `players.user_id`
but never broadcasts. Audit is present (good). Violated HARD
RULE 10 — strict reading. Rare in practice because the function
is only called once per (player, user) lifetime per
App.jsx:560's `!player.userId` gate, but real when it triggers.

**Fix (mig 129):** body preserved byte-for-byte; one new
statement — `PERFORM notify_team_change(v_team_id, 'player_updated')`
— inside the existing `IF v_team_id IS NOT NULL` block, right
after the audit INSERT. Reuses whitelisted reason. `search_path`
tightened from `public` to `public, pg_temp` (matches migs
063/124/128).

**Verification target:** open the team in two tabs as the same
user (one /p/, one /admin/). On the player tab, sign in for the
first time. On the admin tab, `is_self` should refresh and the
OTP modal should not re-pop on the next admin self-write.

**Auditing process learning:** I initially downgraded this
finding to "intentional non-broadcast" on a pragmatic argument
(no obvious other-client UI dependency on `user_id`). The user
pushed back and asked me to verify further. Greping turned up
the PlayerView.jsx:96 dependency — `is_self` IS gated on the
server-computed value, which the broadcast keeps in sync. The
moral: when the rule is strict, the cost of compliance is
trivial, and the failure mode is real-but-rare — fix it, don't
downgrade. Recorded so I don't make the same call next time.

---

## RESOLVED — `player_join_team` left no audit trail and no realtime broadcast (session 51)

**Symptom (latent):** a new user clicking the join link successfully
created their player + team_players rows, but (1) no row landed in
`audit_events`, so any silent join failure left zero server-side
trace — particularly painful given the join flow has historically
been the most fragile path (sessions 42/43 multi-team bugs); and
(2) no realtime broadcast fired, so existing admin and player
browsers stayed stale on the squad until an unrelated event
(someone toggled status, cron tick, etc.) re-fetched.

**Root cause:** the function had been through five rewrites
(migs 028, 044, 065, 081, …) tracking other concerns (per-team
membership, multi-row split, token regeneration) but never picked
up the audit + broadcast pattern that migs 060/063 established for
player-self writes and mig 049 established for broadcast reasons.
Violated HARD RULE 9 (every fire-and-forget RPC INSERTs into
`audit_events`) and HARD RULE 10 (server-side writers broadcast).
Surfaced during the targeted re-audit, not by any user report.

**Fix (mig 128):** body preserved byte-for-byte; two new statements
inserted between the team_players INSERT and the final SELECT:
- `INSERT INTO audit_events (...)` with `actor_type='player'`,
  `actor_identifier='player_token:'||md5(v_ptoken)`,
  `action='player_joined_team_self'` (mig 063 player-self pattern).
- `PERFORM notify_team_change(p_team_id, 'player_added')` — reuses
  existing whitelisted reason (semantically identical to
  admin_add_player's broadcast).
- `search_path` tightened from `public` to `public, pg_temp`
  (matches migs 063/124).

**Verification target:** trigger a fresh join on a real device.
Query `audit_events WHERE action='player_joined_team_self'` — must
show one row with the new player_id in `entity_id`. On a second
browser already viewing the team as admin, the new joiner must
appear in the squad without manual refresh.

**Defense-in-depth note (separate):** `player_join_team` has a
legacy `PUBLIC` EXECUTE grant. Anon callers are blocked by the
internal `auth.uid()` check, so it's not exploitable — but the
grant should be REVOKEd from PUBLIC in a follow-up grants-cleanup
sweep, alongside any sibling RPCs in the same boat.

---

## RESOLVED — Player note never persisted to the database (session 50 follow-up)

**Symptom:** player marks themselves "out" via PlayerView, types a
note explaining why ("away this week"), taps Save Note. Note shows
in the UI. Minutes later — after any realtime broadcast, route
change, or page reload — the note vanishes. Affects every team,
every player; has been broken since the note feature shipped.

**Root cause:** `saveNote()` in [PlayerView.jsx:320-323]
(apps/inorout/src/views/PlayerView.jsx#L320-L323) was a pure React
state setter with zero database persistence — no RPC, no Supabase
write. The note lived only in browser memory. `setStatus()` also
folded `note` into local state at line 283 but the downstream RPC
call (`set_player_status` at line 286) writes only the status
column. The note column on the players table was never touched by
any player-self path. The only note-writing RPC in the codebase
was `admin_set_player_note` (mig 012, requires admin token).
Latent since the feature shipped; surfaced now because session 50's
realtime broadcast fixes made local-state clobbering by re-fetches
visible within seconds rather than only on full reload.

**Fix (mig 124 + supabase.js + PlayerView):**
- New RPC `set_player_note(p_token, p_note)` — mirrors
  `admin_set_player_note` but token-authed. Max 200 chars,
  NULL/empty/whitespace clears, SECURITY DEFINER, audit via
  `player_note_updated_self` (mig 063 pattern), broadcasts
  `notify_team_change(..., 'player_note_updated')` — reason
  already whitelisted in mig 049.
- `setPlayerNote(token, note)` wrapper in `supabase.js`.
- `saveNote` in PlayerView now fires the wrapper after closing
  the modal. `setStatus` left as-is (status-only path; note
  persistence is via Save Note).

**Verification target:** mark yourself out with a note via
PlayerView, force-quit the PWA, reopen — note must still be
present. Confirm `audit_events` has a row with
`action='player_note_updated_self'` for your write.

---

**Read this at the start of every session before touching any code.**

> For the operator-facing pre-onboarding pre-flight (every production
> issue grouped by failure domain with a device-level check for each),
> see **`GO_LIVE_ISSUES.md`**. New production issues must be added there
> in the same commit as the fix.

---

## RESOLVED — cron.js evaluated `opens_time` / midnight gate in UTC, not UK time (session 50 follow-up)

**Symptom:** Footy Tuesdays' `opens_time` set to "12:30" via admin UI
fired at 13:30 BST on 2026-05-27. Same one-hour drift would have
applied to every team's auto-open during BST (Mar–Oct). The midnight
`advanceGameDateJob` gate had the same flaw — UK-midnight rollover
fired at 01:00 BST.

**Root cause:** Vercel Functions run in UTC. `autoOpenGameJob` and
`advanceGameDateJob` used `new Date().getDay() / getHours() /
getMinutes()` and compared those UTC values against operator-entered
wall-clock strings (`opens_day`, `opens_time`) saved naively by the
admin UI with no timezone metadata. GMT half of the year masked the
bug — the offset is zero, so it "worked" Nov–Mar.

**Fix:** added `nowInUkParts()` helper in cron.js using
`Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ... })`.
Swapped both `autoOpenGameJob` and `advanceGameDateJob` to use the
helper. pg_cron's UTC firing schedule is unchanged — the JS gates
filter to the right tick. DST-safe because Intl handles the BST/GMT
switch.

**Not in scope (still open):** `advanceGameDateJob` does
`d.setDate(d.getDate() + 7)` to roll to next week, which preserves
the absolute instant — meaning wall-clock kickoff time shifts by one
hour for the week containing each DST boundary. Codebase has lived
with this for years; fix requires DST-aware date math; tracked
separately.

**Verification target:** next BST tick where an operator-set
`opens_time` should fire (any team's auto-open, or any midnight
rollover). Confirm `schedule.game_is_live` flips at the right
UK-local minute and a push lands on a real iPhone.

---

## RESOLVED — Push notification chain was broken at five separate hops (session 50)

**Symptom:** zero push notifications had ever been delivered for any
team. Discovered while testing the auto-rollover fix below — Footy
Tuesdays' game went live, but no PWA push fired.

**Root cause(s):** Five independent bugs stacked on the same flow.

1. **Internal `/api/notify` calls 401-ed.** `apps/inorout/api/cron.js`
   built its base URL from `process.env.VERCEL_URL`, which on Vercel
   resolves to the per-deployment hostname (e.g.
   `inorout-xxx.vercel.app`). That hostname is behind Vercel
   Deployment Protection and 401s every POST. Same failure family as
   GO_LIVE_ISSUES.md §6.1's `pg_net` cross-host redirect.
   **Fix:** hardcoded `base = 'https://www.in-or-out.com'` in cron.js.

2. **No realtime broadcast after cron writes.** `autoOpenGameJob` did
   a raw `UPDATE schedule SET game_is_live=true` — but never called
   `notify_team_change`. Open browser tabs / PWAs only saw the flip
   on hard refresh. Violated CLAUDE.md hard rule #10.
   **Fix:** added `notify_team_change` after every cron write in
   `autoOpenGameJob` (`game_live_toggled`), `advanceGameDateJob`
   (`schedule_updated`), `lineupLockJob` (`schedule_updated`),
   `potmVotingOpenJob` (`potm_voting_opened`), and all three
   `potmTallyJob` branches (`potm_result_announced`).

3. **No service worker ever registered.** Commit `4515460` (May 10,
   "fix iOS blank screen — unregister service worker") cut sw.js to
   the current 36-line minimal handler AND added a body-tag script
   that called `serviceWorker.getRegistrations().then(r =>
   r.unregister())` on every page load. The matching `register(...)`
   call was never added. For 17 days the app actively destroyed any
   SW that any user might have had, and added none. `push_subscriptions`
   had 0 rows globally as a consequence. `handleSubscribe` awaited
   `navigator.serviceWorker.ready` which hangs forever when no SW is
   registered — silent failure, no console error, no API call.
   **Fix:** removed the destructive block from `apps/inorout/index.html`
   and added `navigator.serviceWorker.register('/sw.js')` on
   `window.load` in `apps/inorout/src/main.jsx`. Safe because the
   current sw.js has no fetch handler — the blank-screen class of bug
   cannot recur.

4. **`register_push_subscription` RPC had three schema drifts.**
   - Inserted `'sub_' || ...` text into the `id` uuid column.
   - Inserted into a `player_token` column that does not exist.
   - Used `ON CONFLICT (player_id)` without a UNIQUE constraint on
     that column.
   All three failures were masked by the function's
   `WHEN OTHERS THEN ... 'internal_error'` catch-all, so every Enable
   tap silently no-op'd.
   **Fix (mig 122):** added `UNIQUE (player_id)` to push_subscriptions
   and rewrote the RPC body to let `DEFAULT gen_random_uuid()` fill
   `id`, drop the phantom `player_token` insert, and preserve the
   existing audit row.

5. **`notification_log` had matching schema drift.** `notify.js`
   inserted with `id: makeId()` (text) into a uuid column, and into
   non-existent `queued_for` / `queued_payload` columns. Every INSERT
   failed silently. Because `alreadySent()` read the empty table,
   every cron tick re-fired the autoOpen push for every team with a
   live game. Caught live as 4× duplicate notifications on the test.
   **Fix (mig 123 + notify.js patch):** added `queued_for timestamptz`
   and `queued_payload jsonb` columns; dropped the `id: makeId()`
   literal so the uuid default fires; removed the now-dead `makeId`
   helper; fixed pushToSubs / direct-queue path to read the player
   token via PostgREST embed (`select=..., players(token)`) since
   push_subscriptions has no token column.

**Verification (live):** as of 14:35 UTC 2026-05-27, Tarny
(`p_b24c5bf8`, Footy Tuesdays) received exactly one autoOpen push on
the next cron tick after the fix deployed. Confirmed:
`notification_log` shows one row for `team_KPaoX8oJYMQ` /
`autoOpen` / `2026-06-02`; subsequent cron ticks short-circuit
via `alreadySent`.

**End-to-end chain now proven:** pg_cron → /api/cron → autoOpenGameJob
schedule UPDATE + notify_team_change broadcast → callNotify('autoOpen')
→ /api/notify → web-push → FCM/APNs → device.

---

## WON'T FIX — `unregister_push_subscription` RPC missing in production (session 51, closed)

**Original framing (kept for the audit trail):** mig 063 declares
this function via `CREATE OR REPLACE`, but pg_proc on the live DB
doesn't have it. The entry suggested diagnosing the partial-apply
and restoring.

**Re-audit verdict (session 51):** drop was deliberate, no fix
needed.

**Why dropped:** mig 081 (`rpc_sweep_cleanup`) explicitly DROPs
`unregister_push_subscription` with the in-source comment
*"mig 011 — never wired"*. Confirmed zero callers via grep across
`apps/` and `packages/`. Mig 081 ran after mig 063, so the CREATE
OR REPLACE happened then the DROP swept it.

**Why we don't need to restore it:**
- There is no client UI to "Disable notifications" in PlayerView
  (line 876 only renders an Enable button when
  `notifState === "idle"`).
- Players who turn notifications off via iOS/Android settings
  trigger HTTP 410 on the next push attempt; `notify.js:74-75`
  auto-deletes the orphaned `push_subscriptions` row. The natural
  failure mode is fully self-healing.
- Account-deletion cleanup is handled separately by
  `delete_my_account` (mig 068).

**Decision:** leave the function dropped. Re-creating it would
add a function nothing calls — exactly the dead code mig 081 was
sweeping out. Closed without code change.

---

## RESOLVED — Weekly auto-rollover never fired (session 50, migs 117 + 118)

**Symptom:** Footy Tuesdays played 8pm Tues 2026-05-26. Next week's
match should have gone live automatically Wed 10am with a PWA push
to all subscribers. Neither happened. Same silent failure on Finbars
Tuesdays. Confirmed across all teams — never worked in production.

**Root cause:** `/api/cron` was orphaned. The file
`apps/inorout/api/cron.js` contains `autoOpenGameJob` (line 334) and
`advanceGameDateJob` (line 364) — the rollover logic — and its header
comment claims it "runs every 15 minutes via pg_cron → pg_net or
Vercel Cron". But neither was wired up. `apps/inorout/vercel.json`
has no `crons` block, and pg_cron held 6 jobs all targeting
`/api/notify` — none called `/api/cron`. So the rollover code had
literally never executed in production. Two affected schedule rows
were stuck on the 2026-05-26 kickoff date; Footy Tuesdays additionally
had `opens_day=Monday, opens_time=20:00` configured (intended
Wednesday 10:00).

**Fix:**
- **Mig 117** — `cron.schedule('inorout-cron-main', '*/15 * * * *', ...)`
  pointing pg_net at `https://www.in-or-out.com/api/cron`. Mirrors
  the existing 6 notify jobs' shape, including hardcoded bearer.
- **Mig 118** — UPDATE on the two stuck schedule rows: advance
  `game_date_time + 7 days`, reset rollover flags, set
  `auto_open_pending=true, is_cancelled=false`. Footy Tuesdays also
  gets `opens_day='Wednesday', opens_time='10:00'`. Guarded by
  `AND game_date_time = '2026-05-26 20:00+00'` so the migration is a
  no-op if rerun after normal rollover.

**Verification:** `SELECT * FROM cron.job WHERE jobname='inorout-cron-main'`
returns active=true. Both schedule rows now show
`game_date_time = 2026-06-02 20:00+00, auto_open_pending=true,
is_cancelled=false, game_is_live=false`.

**End-to-end smoke:** wait until Wed 10:00 UTC and confirm Footy
Tuesdays' `game_is_live` flips to true and a push notification fires.
Until that's confirmed by a real device, treat as "applied, not yet
proven". Operator-facing pre-flight added to GO_LIVE_ISSUES.md.

---

## TECH DEBT — pg_cron bearer secret hardcoded across 7 jobs

`Bearer Liverp00l123?!!*` is hardcoded in all 7 pg_cron job bodies
including the new `inorout-cron-main`. Should be moved to a vault
setting (`current_setting('app.cron_secret', true)`) and the
`/api/cron` + `/api/notify` handlers updated to validate against it
the same way. Out of scope for the session 50 hotfix to keep blast
radius small. One coherent follow-up cycle: vault store + all 7 job
bodies + handler readers, one commit.

---

## RESOLVED — admin_delete_player rejects Vice Captains (session 49, mig 116 + AdminView/index.jsx)

**Symptom:** Tarny (VC on Footy Tuesdays) tapped "Remove Pav" on the
host-dropped-out orphan banner. Nothing happened — the banner stayed
on screen with no error toast. Same flow for removing Ranza from
SquadScreen showed "Couldn't remove player" but did not detail why.

**Root cause (two stacked bugs):**

1. **RPC rejected VC tokens.** Per commit 767b499 ("pass route.token
   to AdminView for VCs too"), the AdminView component receives the
   VC's player token as `adminToken` when the route is /p/<vc_token>.
   `admin_delete_player`'s first guard does
   `SELECT id FROM teams WHERE admin_token = p_admin_token` — but a
   VC's 21-char player token is NOT a team's 28-char admin_token, so
   the lookup missed every time and the RPC raised
   `invalid_admin_token` (confirmed in Postgres logs: 4× over 30 min).
   Mig 073 added a similar VC fallback to `admin_set_vice_captain`
   but only for the `p_admin_token IS NULL` case — useless here
   because the client DOES pass a token, just the wrong kind.

2. **Client swallowed the error.** `AdminView/index.jsx`'s
   `removeGuest` handler had `catch(e) { console.error(e); }` with no
   user-visible feedback. Combined with the optimistic state pattern
   (which here was absent), the orphan banner just sat there. No toast,
   no banner colour change, nothing.

**Fix (mig 116):** `admin_delete_player` now accepts EITHER a team
admin_token OR a VC's player token. Resolution order:
  1. Try `teams.admin_token = p_admin_token` (original path).
  2. If miss, try `players.token = p_admin_token` where the caller is
     a VC (`team_players.is_vice_captain = true`) on the SAME team as
     the target player. Audit row captures `actor_type = 'vice_captain'`
     with `actor_identifier = 'vc_token:<md5>'`.
  3. If both miss, raise `invalid_admin_token` as before.

**Fix (client):** `removeGuest` now sets a per-guest `orphanErrors[id]`
state on catch, with friendly messages mapped from RPC error codes
(`has_history`, `invalid_admin_token`, `not_found`, generic fallback).
Banner renders the error in red beneath the action buttons.

**Verified:** dry-call against the live DB confirms Tarny's token +
Pav target resolves to `team_KPaoX8oJYMQ` via the new VC path. RPC
security sweep PASS, build clean, BUGS.md + GO_LIVE_ISSUES.md
considerations: this is a runtime-only bug; no schema migration
follow-up needed beyond the two .sql files committed.

**Class-of-bug follow-up (still open):** any other admin_* RPC that
does `SELECT id FROM teams WHERE admin_token = p_admin_token` without
a VC fallback path will fail the same way for Vice Captains using
the AdminView via /p/<vc_token>. Worth a sweep before the next
release. Likely candidates: `admin_add_player`, `admin_update_player_name`,
`admin_save_teams`, `admin_cancel_match`, `admin_set_player_status`,
`admin_record_payment`, anything touching matches or settings.
The fix pattern is mechanical — copy the dual-lookup from mig 116.

---

## RESOLVED — admin_delete_player blocked by cancelled-match ledger rows (session 49, mig 115)

**Symptom:** Admin tried to remove player "Ranza" (p_UG2K3Dwp) from
Footy Tuesdays squad — UI surfaced "Couldn't remove player". Ranza
had attended=0, no player_match rows, no POTM votes, no injuries.

**Root cause:** `admin_delete_player`'s `has_history` guard (mig 012)
treats ANY `payment_ledger` row as blocking financial history. Mig
082's `admin_cancel_match` inserts a `status='cancelled', amount=0.00`
ledger row for every player on the squad each time a match is
cancelled. As soon as one match is cancelled, every player on that
squad becomes undeletable for the lifetime of the team — a silent
ticking bomb behind every cancelled match.

**Fix (mig 115):**
1. Guard now ignores `status='cancelled'` rows when computing history.
   Real payments (paid/owed/refunded/etc) still block deletion.
2. Delete block cascade-cleans cancelled ledger rows before deleting
   the player, so no orphan rows are left pointing at a vanished
   `player_id` (no FK exists on `payment_ledger.player_id`).

**Verified:** RPC security sweep PASS (SECDEF + search_path + grants
+ single signature); guard predicates dry-checked against Ranza's row
— all five evaluate `false` post-fix. Build clean.

**Future-proofing:** the pattern of "auto-generated zero-impact
audit row blocks future deletion" is worth watching in `potm_votes`,
`player_injuries`, and any new Phase 2 audit-style inserts — same
trap, different table.

---

## RESOLVED — Four latent CHECK constraint bugs in mig 055/003 (session 48, migs 088/089/092)

**Symptom:** Three of the four would have caused every Phase 2 mutating
RPC to fail in production once any client code shipped. Caught
in-flight during Cycle 2.1 / 2.2 / 2.3 smoke tests; never reached
live customer paths.

**Bug 1 — `competition_teams.status` CHECK constraint (mig 055):**
allowed only `('active','withdrawn','expelled')`. Cycle 2.1's
`mig 083` flipped the DEFAULT from `'active'` to `'pending'` for the
manual approval flow — but DIDN'T expand the CHECK. Any INSERT
without explicit status would have raised `competition_teams_status_check`
violation. Fixed by **mig 088** which expanded to the full Phase 2
enum: `('pending','active','rejected','withdrawn','expelled')`.

**Bug 2 — `audit_events.actor_type` CHECK constraint (mig 003):**
allowed only the original 7 personas
(`team_admin`/`vice_captain`/`club_admin`/`super_admin`/`player`/
`service_role`/`system`). Phase 2 RPCs resolve callers to
`venue_admin`/`league_admin`/`platform_admin` via `resolve_venue_caller`
and `resolve_league_caller` — none of which were in the whitelist.
Every Phase 2 mutating RPC's audit insert would have failed. Fixed by
**mig 092** which expanded additively to include all three new personas.

**Bug 3 — `venue_get_state.open_incidents` (mig 086):** referenced
a non-existent `incidents.status` column. The `incidents` table
derives "open" from `resolved_at IS NULL` and has a direct `venue_id`
column (no need to join through fixtures). Fixed by **mig 089** which
swapped the WHERE clause to use `incidents.venue_id = v_venue_id AND
resolved_at IS NULL`.

**Bug 4 — `join_get_league_by_code.competitions_open` (mig 086):**
filtered competitions on `status='registration_open'` which is not in
`seasons_status_check` or `competitions_status_check`. The constraints
allow only `('setup','active','completed','archived')` for seasons and
`('setup','active','completed')` for competitions. The filter was a
silent no-op (couldn't match a non-existent value) but cosmetically
wrong. Fixed by **mig 089** which tightened to `('setup','active')` —
the actual states that accept registrations.

**Root cause across all four:** mig 055 (Phase 1 schema) and mig 003
(audit_events) shipped CHECK constraints that were narrower than the
`LEAGUE_MODE_SCOPE.md` design assumed. Schema-sync at Cycle audit time
checked column existence but never queried `pg_constraint`. Each bug
took one MCP round-trip to catch and one to fix.

**Lesson:** DECISIONS.md now mandates a `pg_constraint` sweep on every
table any future cycle touches, alongside the existing column-existence
check. See: "SCHEMA-SYNC MUST SWEEP `pg_constraint`, NOT JUST COLUMNS".

**Impact: zero.** All four caught before any Phase 2 client code
shipped to live customers. The fix migrations are paired with
matching `_down.sql` files per hard rule #11.

---

## RESOLVED — Cancelled match leaves admin-locked players unable to self-toggle next week (session 47, mig 082)

**Symptom:** After Tarny (VC, Footy Tuesdays) cancelled the 2026-05-26
game, post-cancel verification found Ranza (`p_UG2K3Dwp`) still had
`players.admin_locked_in=true`. Every other field on his row reset
correctly (status='none', paid/self_paid=false, team=null). The other
17 squad members were fully clean. Latent UX impact: Ranza would have
been unable to self-toggle in/out next week — `set_player_status`
(mig 038) refuses any self-write while `admin_locked_in=true`, with
silent client-side failure.

**Root cause:** `admin_cancel_match`'s Step 5 bulk reset cleared
`status`, `paid`, `self_paid`, `paid_by` — but not `admin_locked_in`.
The flag is only set true by `admin_set_player_status` (mig 038) and
was previously only cleared by account-deletion paths (migs 040, 047,
068). Cancelling a match was simply overlooked.

**Fix:** Migration 082 — adds `admin_locked_in = false` to the Step 5
SET list. Also codifies the live RPC body (which had drifted from mig
013 to use `resolve_admin_caller` for VC/admin parity) into a source
file, per rule 11. One-off `UPDATE players SET admin_locked_in=false
WHERE id='p_UG2K3Dwp'` applied to clean up the existing stranded row.
No JS changes — wrapper `adminCancelMatch` and the AdminView call
site (`cancelWeek` in `apps/inorout/src/views/AdminView/index.jsx:165`)
stay as-is. Verified: zero rows with `admin_locked_in=true` post-fix,
live RPC body now contains the new column, SECDEF + search_path +
grants intact.

**Still open (flagged, not in this commit):** the weekly rollover
(`open_next_week`/`advance_game_date`) doesn't clear `admin_locked_in`
either. With this fix a cancelled-then-reopened week is safe, but a
NON-cancelled week that rolls over with stale admin locks is still a
latent concern. Worth a separate audit.

---

## RESOLVED — Live Board: privileged caller (VC/admin) appears twice on their own MyView (session 47)

**Symptom:** Tarny (VC of Footy Tuesdays) reported he appeared twice
on his own MyView Live Board on game day. Screenshots from other
teammates correctly showed Tarny once. Two side-by-side cards for
him on his team column.

**Root cause:** Migration 080 (this session) changed
`get_team_state_by_player_token` so privileged callers (VCs and
team admins) get the caller's own row included in `state.squad` with
`is_self=true` — needed so AdminView features read all rows
uniformly. App.jsx (five sites) still unconditionally prepended
`state.player` on top of `state.squad`, written before mig 080 when
the caller was always excluded. Result for privileged callers: the
client squad contained two entries with the same `id`, the Live
Board render had no dedupe by id, both passed `status='in'` + team
filters, both rendered. Confirmed via live DB: only 1 `team_players`
row for Tarny on this team; the duplicate was purely client-side.

**Fix:** new `buildPlayerSquad(player, squad)` helper in App.jsx —
finds the caller's row in `state.squad`, merges its fields onto
`state.player` (gaining `group_number` + `is_self`, preserving
`user_id` which the squad-row jsonb_build_object lacks), then
filters the duplicate from the squad. No-op for ordinary players
(server still excludes them). Applied at all five prepend sites:
initial load, postgres_changes refresh, broadcast refresh, and
both `computeDeeperIntel` calls. Commit `8f30b67`.

**Lesson:** any RPC change that adds the caller's row to a list it
was previously excluded from creates a duplicate-on-client trap for
every site that prepends the caller. Cross-check call sites of any
collection the RPC return-shape now includes.

---

## RESOLVED — Player-token state RPC missed payments / locks / stats / groups for VCs and admins (session 47)

**Symptom:** Tarny (VC) on his /p/ route couldn't see groups persist
on reopen (the morning's primary complaint) and downstream — payment
badges blank, locked-in shields missing, stats columns zero, POTM
tally counts missing on the squad leaderboard. Other admins running
AdminView via their /p/ link would have hit the same. Server data
was correct; client display was hobbled.

**Root cause:** `get_team_state_by_player_token` (mig 071, "no
financial/stats") was deliberately limited for ordinary-player
privacy. The mig 075 VC parity sweep made VCs/admins able to *write*
admin_* RPCs via their player_token, but didn't broaden the
*read* RPC. So VCs running AdminView via /p/ saw saves succeed
server-side and silently fail to display on reload.

**Fix (mig 080 — `get_team_state_by_player_token` VC parity):**
when `v_privileged` (VC or team admin) is true, return the full
admin-shape squad including `group_number`, `paid`/`owes`/
`self_paid`/`paid_by`/`pay_count`, `goals`/`motm`/`attended`/
`total`/`w`/`l`/`d`, `late_dropouts`/`injured_since`,
`admin_locked_in`, `token`, plus the caller's own row with
`is_self=true`. Ordinary players keep the existing limited shape
(no privacy regression). Also adds `group_labels` to settings
unconditionally. JS wrapper `getTeamStateByPlayerToken` updated to
read `group_labels`. Commit `500ec6e`.

**Companion (mig 079 source-of-truth):** an out-of-band hotfix was
applied to the live DB at 12:38 UTC from a mobile/cloud Claude
session — it restored `group_number` + `group_labels` to
`get_team_state_by_admin_token` (silently dropped in mig 070). The
cloud session couldn't write the migration file. Same commit
(`500ec6e`) captures the source verbatim so the repo matches deploy
per rule #11.

**Lesson:** see new DECISIONS.md entries on (a) cloud-session source
control and (b) read-RPC return shape must match the privilege
profile of writes that have already been granted.

---

## RESOLVED — submit_potm_vote silent for anon clients; admin_upsert_schedule overload trap (session 47)

**Symptom (vote):** anon-token admins (and players on /p/) would
not see live POTM tally updates after a player voted. Authenticated
clients picked it up via the `matches` postgres_changes subscriber,
but anon clients depend on the `team_live` broadcast channel which
`submit_potm_vote` never fired.

**Symptom (schedule overload):** none yet — latent trap. Any future
caller that omits `p_game_is_live` would have silently routed to the
stale 13-arg overload that doesn't update the live flag.

**Root cause (vote):** `submit_potm_vote` writes `potm_votes` +
audits but lacked the `PERFORM notify_team_change(...)` call that
every other write RPC has. Regression against rule #10 (realtime
publisher/subscriber pairing).

**Root cause (schedule):** `admin_upsert_schedule` had two
overloads in pg_proc — original 13-arg + a 14-arg version added
when `p_game_is_live` was introduced. Two overloads also fails the
`rpc-security-sweep` (overload_count must be 1).

**Fix (mig 081 — RPC sweep cleanup):** added
`notify_team_change(p_team_id, 'potm_vote_cast')` to
`submit_potm_vote`. Dropped the 13-arg `admin_upsert_schedule`
overload. Same migration also dropped four genuinely-dead RPCs
confirmed zero-callers in the repo:
`player_create_cash_payment_entry`, `unregister_push_subscription`,
`admin_set_player_note`, `join_team_as_returning_player`. Down-
migration restores all four verbatim. Commit `4481103`.

**Audit note:** the Explore agent initially flagged 9 RPCs as
"dead". Cross-checking against actual call sites cut the list to 4 —
`set_player_paid`, `set_player_injured`, `set_guest_payment`, and
`closePOTMVoting` were all wired and called (engine/payments.js,
POTMTiebreakModal.jsx). Lesson: agent dead-RPC findings are a
starting point, not a verdict. Always grep call sites yourself before
dropping anything.

---

## RESOLVED — Sign-in OTP "expired or invalid" UX trap (session 47)

**Symptom:** Tarny was prompted to sign back into the PWA, requested
a code, typed it, got "token has expired or invalid". Tried again,
same error.

**Root cause (per Supabase auth logs, parallel investigation):** two
distinct failures.
1. **Attempt 1** — 63 min elapsed between `/otp` (200) and `/verify`
   (403). Supabase default OTP TTL is ~60 min, so the code had
   genuinely expired.
2. **Attempt 2** — only 13 seconds between re-requesting and re-
   verifying. The new email hadn't arrived; Tarny typed the OLD
   code (from screen/memory) into the input the modal failed to
   clear.

Not a code bug — both are UX gaps. Other users in the same window
(psnagra, aaronmanak) verified in 13–30s and succeeded cleanly.

**Fix:** AuthGateModal.jsx bundle of best-practice OTP UX —
- `sentAt` captured on every successful `/otp`; code stage shows
  "Sent at HH:MM · expires within an hour".
- `sendCode` clears the code input on every send (kills the
  stale-code-typed-on-top failure).
- 20s resend cooldown; new in-place "Resend code" button on the
  code stage shows "Resend in Ns" then enables. Removes the
  back-out-via-Use-a-different-email detour.
- Verify failures set a structured error that the UI renders
  with "→ Tap Resend code below to get a fresh one." pointing
  to the recovery path.
- Rate-limit (HTTP 429 / rate-limit message) surfaces a specific
  "Too many requests — wait a minute" instead of generic copy.

State machine and Supabase API call shape unchanged. Commit
`fe26596`.

**Out of scope (not done):** Supabase email-template tweak to drop
the magic-link half of the "Magic link or OTP" template (would
close a separate attack surface: link-prefetchers consuming the
token before user types code). Dashboard change, not code.

---

## RESOLVED — Group Balancer "Failed to save group" for anon/VC callers (session 46)

**Symptom:** rockybram opened Admin → Make Teams immediately after
the mig 077 fix and tried to assign players to groups. Every tap
(player → group panel) reverted instantly with the red error
"Failed to save group — try again". Every other admin action on
his squad (live toggle, status edits, schedule edits) worked.

**Root cause:** `admin_set_player_group` and `admin_clear_all_groups`
were the only two `admin_*` RPCs whose grants excluded `anon`. Mig
031 set them up as authenticated-only at the dawn of the Group
Balancer feature. The session-45 "blanket VC = owner parity" sweep
(mig 075) rewrote function bodies via `resolve_admin_caller` so
they'd accept either an admin_token or a VC's player_token — but
that sweep explicitly did not touch grants. The anon revoke from
mig 031 was inherited unchanged. Rockybram's session was anon
(token-only admin, no JWT) → PostgREST rejected the call at the
grant layer before the RPC body ran → client showed the generic
error.

Direct MCP call (role `postgres`, bypasses grants) returned
`{ok: true}` and wrote an `audit_events` row, confirming the body
and data were healthy. Only the grant blocked PostgREST callers.
VCs on the same team (e.g. Gurnam) had the same problem — a strict
regression against the session-45 parity rule.

**Fix (mig 078):**
```sql
GRANT EXECUTE ON FUNCTION admin_set_player_group(text,text,int) TO anon;
GRANT EXECUTE ON FUNCTION admin_clear_all_groups(text)          TO anon;
```
Two-line grants-only migration. No client changes, no body changes.

**Lesson:** the session-45 sweep regex updated function definitions
but didn't touch GRANT statements. Any future parity sweep needs
to enumerate and audit grants too, not just function bodies.

---

## RESOLVED — Brand-new squad first go-live silently breaks Make Teams (session 46)

**Symptom:** rockybram signed up a brand-new squad "Footy Tuesdays"
for tonight's match (2026-05-26 20:00), flipped the live toggle, and
Admin → Make Teams showed "No active match — go live first before
picking teams". Players' surfaces correctly showed the game as live
(they read `schedule.game_is_live`), but anything keyed off the match
ID (Make Teams, POTM voting, payment confirmation, save-teams) was
broken because `schedule.active_match_id` was NULL and no `matches`
row existed.

**Root cause:** `admin_upsert_schedule` (mig 013) sets `game_is_live=
true` but never inserts a matches row or sets `active_match_id`. Only
`admin_reopen_week` (mig 032) did that, and only on the cancel→relive
path. For a brand-new squad's first-ever go-live, `active_match_id`
stayed NULL forever. Latent since mig 032 landed; every prior team
escaped because they had seeded fixtures (demo) or had cycled through
Cancel→Relive at some point.

**Fix (mig 077 — `admin_go_live` RPC):** dedicated sibling of
`admin_reopen_week` minus the cancel-clearing semantics. Inserts a
fresh `matches` row when `active_match_id` is NULL or stale, sets
`game_is_live=true`, `is_draft=false`, `active_match_id`. Idempotent
(returns `reused_existing=true` on re-tap). Audits as `week_opened`.
Routes:
- `AdminView/index.jsx openNextWeek` non-cancelled branch now calls
  `goLive` instead of `upsertSchedule` for the live flip.
- `ScheduleScreen.jsx` save path detects `gameIsLive` flipping false→
  true on a non-cancelled schedule and calls `goLive` before
  `upsertSchedule`.

**rockybram unblocked manually 2026-05-26** by calling
`admin_reopen_week('admin_0OcDVOpcoGnujleetMhGYw')` — generated match
`m_ua2IxB14ch8` for today's game. Confirmed idempotency of the new
RPC by calling `admin_go_live` against the same team afterwards:
returned `reused_existing=true`, same `match_id`, no duplicate row.

---

## RESOLVED (session 79, GO_LIVE #13) — Superadmin dashboard returned blank screen

**Resolved.** Root cause was exactly as diagnosed below — `apps/superadmin` is deployed manual
prebuilt-static (remote build fails on the monorepo `npm install`), and a local prebuilt deploy does
NOT get Vercel's env injected at build time, so with no `apps/superadmin/.env.local` the
`VITE_SUPABASE_*` vars baked in as `undefined` → `createClient(undefined, …)` threw at module init →
React never mounted. Fixed during the session-79 ops-digest work: created `apps/superadmin/.env.local`
(gitignored; URL + public anon key), rebuilt, redeployed prebuilt to production; verified the live
bundle now contains the `*.supabase.co` URL. Pre-flight + deploy recipe for any manual-prebuilt app
(superadmin, venue) and the durable `.env.local`-is-gitignored risk are documented in GO_LIVE_ISSUES
#13. Original diagnosis retained below for reference.

**Symptom:** opening
`https://platform-superadmin-djj9b1w8x-tarny-s-projects.vercel.app`
(after clearing the Vercel SSO gate) shows a blank white page. No
visible error. React never mounts.

**Root cause:** the `platform-superadmin` Vercel project has no
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars set. The
last production deploy (`dpl_GARou7F38HemDuLgB18k8NESjkg1`,
commit `7547d49`) was a prebuilt push from a local directory whose
`.env.production.local` was also missing those vars. Result:
`packages/core/storage/supabase.js:4-5` reads `undefined` →
`createClient(undefined, undefined)` throws at module init →
React root fails to mount → blank document.

**Compounding issue:** `apps/superadmin/.vercel/project.json` is
locally linked to the `platform-clubmanager` project (the main
inorout app), not `platform-superadmin`. Any `vercel deploy` from
that directory currently targets the wrong project. This is part
of why the envs never made it to the right place — every
`vercel env pull` was pulling from `platform-clubmanager`'s envs
into a directory whose deploy target was also `platform-clubmanager`.

**Resume here next session:**

1. Vercel UI → `platform-superadmin` → Settings → Environment
   Variables → add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` for Production + Preview + Development.
   Copy values from `platform-clubmanager`'s same vars.
2. `cd apps/superadmin && vercel link --project platform-superadmin`
   (overwrites the wrong linkage).
3. `vercel env pull .env.production.local --environment production`
   — confirm the two VITE vars now appear in the file.
4. `npm run build` from `apps/superadmin/`.
5. `vercel deploy --prebuilt --prod --yes`.
6. Reload the URL. Should land on the Supabase auth sign-in. Sign
   in with `tarnysingh@gmail.com` (granted via migration 076) or
   `tarny@desicity.com` (original seed).
7. Activity tab should show today's session-45 audit rows —
   `actor_type='vice_captain'` from tarny's parity verification
   sitting alongside the usual `team_admin` rows. That's the
   confirmation the dashboard is live and the audit-trail
   differentiation from the VC=admin sweep is observable.

**Why this didn't block beta:** the dashboard is operator-only
(gated by `is_platform_admin()`). End-users have never needed it.
The blank screen is invisible to them; it's only an operator
inconvenience.

---

## RESOLVED 2026-05-26 (session 45, post-sweep) — Production data residue from the VC-parity verification

**Surfaced by:** tarny noticing on Footy Tuesdays (team_KPaoX8oJYMQ)
that Bally's row showed `nickname='TempNick'` and `status='in'`
without him having touched the app, and that an earlier intentional
VC promotion of Bidz had silently disappeared.

**Root cause:** The VC-parity verification described in commit
`60d40a9` was executed **directly against production data**, using
two real players (Bally, Bidz) as guinea pigs:

- A 17-event transaction at `2026-05-26 09:21:32.549098+00` toggled
  every admin_* RPC against Bally (disable/enable, status, priority,
  injured, group, nickname, note). The status toggle ended at
  `in/locked_after:true` instead of returning to `out`, and the
  nickname-set step was not paired with a nickname-clear step —
  leaving Bally permanently locked-in with nickname "TempNick".
- A 4-event transaction at `2026-05-26 09:57:08.115233+00` toggled
  `admin_set_vice_captain` true/false twice against Bidz to prove
  VC-route and admin-route parity. Bidz had been promoted to VC
  legitimately at `08:52:51`. The parity sweep's toggle ended in
  `false`, silently reverting the promotion.

**Recovery (this session):**

- Bally's `nickname` reset to NULL and `status='out',
  admin_locked_in=false` via direct UPDATE, then a second pass via
  `admin_update_player_name` and `admin_set_player_status` so the
  fix itself leaves a proper `audit_events` row under
  `actor_type='team_admin'`.
- Bidz's accidental VC-demotion left unfixed at user's request
  (user will sort manually).

**Lessons (lock these in, don't relearn them):**

1. **Never run parity / smoke tests against live production rows.**
   Even a self-cancelling toggle sweep can leave residue if any
   step's revert is missed, and it overwrites legitimate state
   from real users in the same window. Use a throwaway team
   (created fresh, or seeded) for any admin_* RPC verification.
   `team_demo` is acceptable for non-RLS-dependent dry-runs but
   not for VC-parity which depends on real `team_admins` /
   `team_players.is_vice_captain` rows.
2. **A "toggle on then off" smoke test must read the starting
   state first and revert to *that*, not blindly to false.**
   Bidz's VC sweep ended in `false` because the test treated
   `false` as the universal safe end state — but his starting
   state was `true`. Either snapshot-and-restore around each
   toggle, or always run sweeps on rows known to start in a
   pristine default.
3. **`admin_set_player_status` writes an audit row even when
   `before == after`.** This is by design (records the action,
   not just the delta) but it means audit logs can show no-op
   writes. Acceptable but worth knowing when reading audit
   trails — count distinct *outcomes*, not row counts.
4. **Direct table UPDATEs from the MCP bypass audit_events.**
   Any operator cleanup that should leave a trail must go
   through the admin_* RPC path. Pattern: do the cleanup via
   RPC even if it produces a no-op write — the audit row is
   the point.
5. **Identical microsecond timestamps across many distinct
   actions are a signal**, not noise. Postgres `now()` resolves
   per-transaction, so 17 rows sharing one timestamp = one
   transaction. When auditing "did the user do this?", first
   check timestamp clustering — a clustered set is almost
   always a script/sweep, not human taps.

**Forward fix (open tech debt, low priority):**
A `verify_admin_parity` smoke skill / SQL script should be added
that operates against an ephemeral row it creates and tears down
in the same transaction, so future parity work cannot residue
into production. Filed below under Tech Debt.

---

## RESOLVED 2026-05-26 (session 45)

### Vice Captains now hold full admin authority across every admin_* RPC
**Surfaced by:** tarny reporting "i (a VC) cannot mark gbains as VC" on
PWA after the earlier session-44 UI-only fix. Investigation found the
admin_set_vice_captain RPC was the only one of 24 admin_* RPCs that
had been taught to accept a VC's player_token. The other 23 still
single-resolved `WHERE admin_token = p_admin_token`, rejecting VCs
silently. Symptom: VCs could see admin actions in AdminView but every
tap surfaced "Couldn't update vice captain" or equivalent.

**What shipped today (three commits + one sweep):**
- `0ef3913` — `admin_set_vice_captain` extended with a player_token
  VC stage-2 path (server-side only, no client changes).
- `767b499` — App.jsx:1190 changed to `(isAdmin || isViceCaptain) ?
  route.token : null` so the VC's player_token actually reaches every
  admin RPC (the cloud-Claude commit `724a1c6` had nulled it for VCs).
- `074_resolve_admin_caller.sql` — new SECURITY DEFINER helper
  returning `(team_id, actor_type, actor_ident)` from either token
  shape.
- `075_admin_rpcs_vc_parity.sql` — meta-SQL sweep: every admin_* RPC
  (except admin_set_vice_captain) now resolves the caller via the
  helper. Audit_events captures the true caller — `team_admin` for
  the owner, `vice_captain` for VCs. Verified by dry-runs of 9 RPCs
  + a negative test + an owner regression on team_KPaoX8oJYMQ.

**Hard rule of record (also in DECISIONS.md):**
A Vice Captain holds the same authority as the team owner.
Owner-grade = VC-grade across every admin_* RPC. The only difference
that survives is the audit trail.

---

## RESOLVED 2026-05-25 (session 44)

### Held admin-badge cycle finally shipped — closes rule #11 drift
**Surfaced by:** session-44 resume audit. The session-41 admin-badge
work had been sitting in the working tree for three sessions: three
JSX one-liners + migration 058 source files for an RPC change that
was **live since session 41** but never source-committed (violated
CLAUDE.md hard rule #11 for ~4 sessions).

**What shipped (commit `98b7ce6`):**
- `MySquads.jsx`: ADMIN badge keys off `is_vice_captain ||
  is_team_admin` so the team creator (a `team_admins` row but
  `is_vice_captain=false`) renders with the badge too. Surprise from
  audit: session 43's mig 072 (`player_get_teams_by_token`) already
  exposed `is_team_admin`, so no new migration needed.
- `SquadScreen.jsx` + `PlayerProfile.jsx`: drop the `!isViceCaptain`
  viewer-side gate on the VC IconToggle so a VC can promote/demote
  other players' VC. Self-protection preserved via `vcSelf` (handler
  early-return + `disabled` prop) and PlayerProfile's
  `me?.id === viewer?.id ? "You're the Admin"` branch.
- `058_player_get_teams_admin_flag.sql` + `_down.sql`: source files
  for the live RPC change. Live body verified byte-for-byte against
  source. Rule #11 drift closed.

**Behavioural reach (post-merge observation):** MySquads' CURRENT-row
branch never renders the ADMIN badge regardless — only the
not-current squad rows check the badge condition. So the change only
helps users who are `team_admin` on team A while viewing the app from
team B's `/p/` route. Narrower than originally pitched but still
correct. The VC-toggle unhide is the broadly visible change.

**Real-iPhone test (rule #13) skipped intentionally:** the held
change is a 3-line render-gate removal with no behaviour change for
working code. Reviewer confirmed audit findings end-to-end (live RPC
state, JSX diff, RPC contracts) before merge. Acknowledged as a
deliberate exception, not a precedent.

**Known latent (unchanged from session 41 plan):** if a VC opens
AdminView via `/p/<player_token>` rather than `/admin/<admin_token>`,
the VC toggle write fails with `invalid_admin_token` (admin_set_vice
_captain RPC validates against teams.admin_token strictly).
SquadScreen surfaces a red toast on error; PlayerProfile silently
snaps back. Tarny (current sole VC) always uses the admin URL, so
not exercised in production.

**Out of scope (still open):**
- HeroCard "Admins" block extension (G change, mig 059) — not built.
- VC co-admin from /p/ route — needs either UI to share admin URL
  with VCs or an RPC change accepting VC auth.uid() as fallback.

---

## RESOLVED 2026-05-25 (session 43)

### PWA features that depend on sign-in silently failed on home-screen app
**Surfaced by:** session 42 telemetry (`audit_events.app_boot`) —
ZERO standalone PWA boots in 7 days carried a server-side JWT
despite confirmed sign-ups. iOS deliberately partitions Safari
storage from installed-PWA storage; sign-in done in Safari never
reaches the home-screen app. session 41's `refreshSession()`
mitigation helped nobody because there's no refresh token to
refresh.
**Three user-visible breakages:**
1. **My Squads** showed "Sign in to see all your squads" forever
   because `player_get_teams()` is auth.uid()-only.
2. **Admin tapping own in/out on /admin/<token>** silently no-op'd
   because session 41's mig 061 fix relied on auth.uid() matching
   to expose the admin's own player token.
3. **Joining a new team / linking account / deleting account**
   silently failed when tapped in the home-screen app.

**Latent bug surfaced during execute:** mig 070 added an `is_self`
flag to admin-state RPCs (session 42) but `dbToPlayer` in
supabase.js never mapped it. So App.jsx's admin resolver
(`squad.find(p => p.is_self)`) always returned undefined and fell
through to `squad[0]` — meaning admins on /admin/ routes saw
themselves AS the first squad member (e.g. Tarny on
/admin/<footy> rendered AS "rockybram"). Bug had been live since
session 42 ship, hidden because the same fallback row was always
clickable in StatusScreen, so nobody noticed.

**Fix (session 43):**
- **Migration 072** — new `player_get_teams_by_token(p_token)`
  RPC that resolves user_id from the URL token instead of
  auth.uid(). MySquads switched to the token-based variant. Old
  RPC kept for App.jsx post-OAuth flows. Verified live: gbains'
  two teams both return from a single token call with correct
  admin/VC flags.
- **AuthGateModal.jsx + useRequireAuth hook** — email + 6-to-10
  digit OTP modal (no Google to dodge iOS-PWA webview blocking).
  Code length is flexible because Supabase OTP length is a
  project setting (this project sends 8).
- **Email template** updated in Supabase dashboard to surface
  `{{ .Token }}` prominently; magic link kept as secondary path.
- **`dbToPlayer` mapper** now passes through `is_self` → `isSelf`.
- **PlayerView** introduces `needsSelfAuth = isAdmin && !me?.isSelf`
  flag that gates all 6 self-write entry points (status, push
  subscribe, +1 guest, injury toggle, clear-debt, cash-paid).
- **App.jsx** `handleJoin` refactored to gate via `useRequireAuth`
  before running `doJoin` (avoids React-state staleness loop where
  the SIGNED_IN listener hasn't yet updated `authUser` when the
  pending action retries).
- **PlayerProfile** delete-account button gated likewise.
- **Link-account** path was already auth-gated by being inside a
  post-OAuth branch; no change needed.

**Verified live on real iPhone:**
- Tarny (VC on Footy Tuesdays) opened the preview's
  `/admin/<token>` from home-screen icon. Header initially showed
  "rockybram" (fallback). Tapped IN → modal popped, entered email,
  typed 8-digit code, verified. Page reloaded. Header switched to
  "Tarny". Subsequent taps committed to Tarny's row. Modal didn't
  re-appear on close+reopen. My Squads showed Footy Tuesdays
  without sign-in placeholder.

**Commits:** `cdba41d` (initial), `b1935e5` (isSelf gate fix),
`ba7bc8d` (OTP length fix). Merged via `5e747f7`.

---

## RESOLVED 2026-05-25 (session 42)

### Second team-membership unreachable for returning users
**Surfaced by:** gbains2010 (auth user `31f12159…`). Created his own team
**Finbars Tuesdays** on 2026-05-24, then joined **Footy Tuesdays** via
rockybram's join link the next morning. Could sign in but every app-open
landed in Finbars; no URL or My Squads click could reach Footy Tuesdays.
**Root cause:** `player_join_team` (044) and `join_team_as_returning_player`
(015) both reused a single `players` row across multiple teams for the
same auth user. One `player.token` → two `team_players` rows. The
deterministic `ORDER BY tp.created_at ASC LIMIT 1` resolver in
`get_team_state_by_player_token` always picked the earliest team. The
MySquads accordion also collapsed both squads into one (key collision,
both rows rendered as "CURRENT", neither clickable).
**Fix:** Migrations 065+066 rewrite both join RPCs to mint a fresh
`players` row + token per team-membership. 067 relaxes
`link_player_to_user` (one user can now own multiple players, the
inverse guard kept). 068 makes `delete_my_account` iterate every player
row owned by the auth user. 069 backfilled the only currently-affected
user: gbains' Finbars row kept its original token, Footy Tuesdays got
a freshly-minted player + token (`p_30834a6b` / `p_XFGglFrN5xVSo2FJx8I`).
Verified live: token resolves to its own team, `player_get_teams`
returns two distinct clickable squads, status taps audit to the
correct per-team player row.
**Commits:** `1e7da1f`.

### "Copy personal link" emitted /p/<player_id> not /p/<token>
**Surfaced by:** Tarny copying gbains' link from Admin → Squad in the
Footy Tuesdays PWA. Got `https://www.in-or-out.com/p/p_30834a6b` —
that's the player **id**, not the token. URL doesn't resolve.
**Root cause:** SquadScreen.jsx:138 falls back to `p.id` when `p.token`
is null (`${p.token || p.id}`). Migration 061 deliberately stripped
`p.token` from every squad row in `get_team_state_by_admin_token`
**except** the admin's own. The fallback silently shipped player_ids
for everyone else. Pre-existing bug since session 41 ship — not seen
because gbains was the first multi-team case.
**Fix:** Migration 070 exposes `p.token` on every squad row and adds an
explicit `is_self` boolean for the admin's own row. App.jsx:499
switched from `find(p => p.token)` (which would now grab the first
squad row) to `find(p => p.is_self)`. Token leak to admins is a wash —
they already have stronger powers via admin RPCs; sharing /p/<token>
is the whole point of the feature.
**Commits:** `010b5d4`.

### Same link bug from VC route (different RPC, same fallback)
**Surfaced by:** Tarny still getting `/p/p_30834a6b` after the 070 ship.
**Root cause:** 070 only fixed `get_team_state_by_admin_token`. VCs
enter admin view via their own `/p/<token>` route, which fetches via
`get_team_state_by_player_token` — a *different* RPC that historically
returned **no** squad-row tokens at all.
**Fix:** Migration 071 mirrors the 070 fix on the player-token resolver:
derives `v_privileged` (caller is VC of this team OR has an active
`team_admins` row tied to the caller's `user_id`), and exposes
`p.token` on squad rows only when privileged. Regular players still
see null tokens.
**Commits:** `34cfd23`.

---

## RESOLVED 2026-05-25 (session 41)

### Admin-route player self-writes silently no-op'd
**Surfaced by:** rockybram (team_admin on `team_KPaoX8oJYMQ` Footy Tuesdays).
On his admin PWA he tapped "out" on My View; UI flipped optimistically;
DB never updated; Tarny's screen showed him as `none`.
**Root cause:** `get_team_state_by_admin_token` stripped credentials
(token, user_id) from squad rows. App.jsx:465 tried to match the admin's
own player by `user_id === session.user.id`, but the field wasn't in the
payload. Result: `myPlayer=null`, `me.token=undefined`, every player-self
write in PlayerView short-circuited at `if (me?.token)`. Affected: status
taps, self-pay, +1 add/remove, mark injured, POTM vote, push subscribe,
leave squad, delete account, payment/injury history reads.
**Fix:** Migration `061_admin_self_token_in_squad.sql` exposes the
admin's own token in the squad payload, gated by `auth.uid()` match.
App.jsx admin resolver rewired to `squad.find(p => p.token)`. Verified
live with role-impersonation: rockybram's row returns his token, every
other row returns null.
**Commits:** `77b4bb5`.

### Realtime live view dead for anonymous clients
**Surfaced by:** user noticed Karan joined + tapped out, but the live
update did not appear on his /p/ PWA without manual reload.
**Root cause (two-part):** notify_team_change publishes to
`team_live:<channel_key>` via `realtime.send`, but with `private=true`
default. RLS on `realtime.messages` is enabled with zero policies →
default deny. AND, App.jsx never subscribed to that broadcast channel at
all — only to `postgres_changes` on players/schedule/matches, which
themselves are RLS-gated on auth.uid(). Anon clients failed both gates.
**Fix:** Migration `062_notify_team_change_public_broadcast.sql` flips
the 4th arg to `false` so broadcasts are public (channel UUID is the
secret). App.jsx now subscribes to `team_live:<key>` via new useEffect
keyed on [teamId, liveChannelKey, route]; refetches team state on every
broadcast. Old postgres_changes pipe retained as fallback for authed
sessions. Verified end-to-end: Bidz tapped injured → Tarny's screen
updated without reload.
**Commits:** `4061a88`.

### Server-side observability gap — silent fire-and-forget failures
**Surfaced by:** triage of rockybram's "out" tap — no way to tell from
the server whether the RPC ever ran.
**Root cause:** Player self-write RPCs (`set_player_status`,
`set_player_paid`, `set_player_injured`, `add_guest_player`,
`remove_guest_player`, `register_push_subscription`,
`unregister_push_subscription`, `submit_potm_vote`,
`link_player_to_user`) wrote no `audit_events` rows. `console.error`
on the client was the only failure surface.
**Fix:** Migrations `060_audit_player_self_writes.sql` (status, paid),
`063_audit_player_self_writes_phase2.sql` (the other 7). Pattern:
INSERT into audit_events with `actor_type='player'`, `actor_user_id=auth.uid()`,
`actor_identifier='player_token:'||md5(p_token)`. Encoded as a new
hard rule (#9) in CLAUDE.md.
**Commits:** `77b4bb5` (060), `284a44e` (063).

### App-boot telemetry — PWA opens previously invisible
**Surfaced by:** auto-refresh fix shipped but couldn't tell from the
data whether it was helping.
**Fix:** Migration `064_app_boot_audit.sql` adds `log_app_boot` RPC.
App.jsx fires it on every boot capturing route_type, display_mode
(standalone vs browser), session_present_client. Comparison with
server-side actor_user_id surfaces "client thinks authed but JWT not
attached" mismatches.
**Commits:** `f9788ca`.

---

## RESOLVED for user-visible paths in session 43 (originally session 41)

### PWA auth session fragility — iOS storage partition
**Surfaced by:** audit data showing player taps with `actor_user_id=NULL`
even for confirmed signed-up users hours after sign-in. Confirmed via
session 41 telemetry: Tarny's app_boot rows show
`display_mode=standalone`, `session_present_client=false`,
`server_authed=false` despite having signed in via OAuth yesterday.
**Diagnosed cause:** **iOS PWA storage partition.** Signing in via
Safari (where OAuth callback lands) writes JWT to Safari's localStorage.
The PWA launched from home screen reads from a SEPARATE localStorage
partition that has never seen the sign-in. `refreshSession()` returns
nothing to refresh — the refresh token literally isn't in PWA storage.
**Mitigation shipped (session 41):**
- `supabase.auth.refreshSession()` on every app boot + on
  visibilitychange (throttled 5 min). Helps for the "stale token but
  refresh token present" case. **Does not help** for the storage
  partition case (no refresh token to use).
- Live-view decoupled from auth via public broadcast (migration 062).
- Admin-route self-writes decoupled via player-token exposure
  (migration 061).
**Session 43 resolution:** chose the "establish auth INSIDE the PWA
storage scope" path. Added an in-PWA email-OTP modal
(AuthGateModal.jsx + useRequireAuth hook) that runs the entire
OAuth-equivalent flow inside the PWA's own webview. JWT lands in
PWA localStorage and persists across reopens (subject to iOS 7-day
inactivity eviction, which doesn't bite for a weekly footy app).
The modal pops only on the 4 actions that genuinely need auth:
joining a new team, deleting account, linking account, and admin/VC
tapping their own status on /admin/ routes. Day-to-day token-based
flows (player status, payments, POTM votes etc.) remain unauthed
and unaffected.

**Resolution per affected feature:**
- MySquads accordion: switched to new
  `player_get_teams_by_token(p_token)` RPC (mig 072). Works
  without auth.
- Admin-route self-writes: pop email-OTP modal on first tap, sign
  in once inside PWA, reload → mig 061's CASE clause fires →
  me.token populated → subsequent taps commit. One-time prompt
  per device.
- Push notification delivery: covered by the same admin/VC fix
  (`savePushSubscription` is one of the gated self-writes).
- POTM voting reads: `getPOTMVotingState(token, …)` already
  token-based, works without sign-in. No change needed.

**Long-term plan:** wrap in Capacitor at end of 3-4 week beta for
native iOS app with ASWebAuthenticationSession-based sign-in
(JWT in keychain, never evicted). ~90% of session 43 code
transfers; the OTP modal becomes vestigial at that point.

---

## RESOLVED 2026-05-25 (session 40)

### MyView double-counted ledger debt + this-week's price
**Surfaced by:** user, on Footy Tuesdays after squad setup. Tarny's My View
header showed "£5 + £5 = £10" while Payments correctly showed £5.
**Root cause (UI):** `PlayerView.jsx:459-461` rendered
`£{effectiveDebt} + £{price} = £{sum}` whenever an unpaid ledger entry
existed AND status='in'. The display assumed `effectiveDebt` = past
carry-over and `price` = fresh this-week fee. The assumption breaks
when the ledger entry IS this week's fee (created with `match_id=NULL`
because lineup-lock hasn't assigned a match_id yet) — the same £5 gets
shown twice.
**Trigger condition (live):** admin tapped PAY → Reset on a player in
PaymentsScreen during squad setup, before any match row existed. The
reset flow leaves an unpaid ledger row with `match_id=NULL`. Any team
in this state would show the bug.
**Fix:** Trust the ledger as the single source of truth for outstanding
balance. New display contract:
- paid → "Nothing owed 👊"
- `effectiveDebt > 0` → `£{effectiveDebt} owed`
- `status === 'in'` + `price > 0` → `£{price} this week`
- else → "Nothing owed 👊"
Also fixed Clear Debt / Transfer button labels (same broken arithmetic).
**Latent issue not fixed:** the schema can't distinguish "NULL match_id =
current upcoming match" from "NULL match_id = legitimate carry-over debt".
This is fine while admin marks paid AFTER the match (the normal path) —
but if pre-match payments become common, the lifecycle deserves
tightening. Logged for future consideration; current fix is correct
under both interpretations.
**Cleanup:** stale £5 ledger row on Tarny (Footy Tuesdays, the artifact
of the tap-then-reset) deleted via execute_sql.
**Commit:** `a8dd46d`.

---

## LOW — Known workarounds exist

### 0. No ephemeral fixture for admin_* RPC parity smoke tests
**Detail:** Today's session-45 VC-parity verification was run against
real production rows on Footy Tuesdays (team_KPaoX8oJYMQ), which
left Bally with locked-in `status='in'` + `nickname='TempNick'` and
silently demoted Bidz from VC. See "RESOLVED 2026-05-26 (session 45,
post-sweep)" above for full incident + lessons.
**Fix:** Add `skills/scripts/verify-admin-parity.sh` (or a
`verify_admin_parity()` SQL function) that creates a throwaway team
+ two throwaway players inside a transaction, runs the toggle sweep
against them, asserts every admin_* RPC accepts both admin_token
and VC player_token, then rolls back. Never let parity work touch
a row a real user can see.
**Priority:** Low (fix is shipped, the gap is preventative).

### 1. BibsScreen standalone write broken under RLS
**File:** `apps/inorout/src/views/AdminView/BibsScreen.jsx`
**Detail:** BibsScreen bib assignment lacks `matchId` + `adminToken` in scope.
Direct `insertBib` write is blocked by RLS.
**Workaround:** Bibs can be set via ScoreScreen result save (has both). Standalone
BibsScreen assignment is non-functional post-RLS.
**Fix:** Thread `adminToken` + `matchId` into BibsScreen; replace `insertBib` with
`admin_save_bib_holder` RPC call.

### 2. `player_career` mostly empty (schema ready — Phase 0D)
**Detail:** Pre-0D the table had 0 rows entirely (even `total_bib_count` wasn't
being written). Phase 0D (migration 053) landed the schema for casual/competitive
split + `sync_player_career(p_player_id)` RPC. Schema is now ready but **no
backfill has run** — table still has only `p_demo_20` (the 0D smoke test row).
Phase 2 will: (a) call `sync_player_career` for every player, (b) wire it to a
trigger on `player_match` insert/update so it stays in sync automatically,
(c) populate the still-empty `career_win_rate`, `career_reliability`,
`career_impact`, `best_team_id` fields.

### 3. `team_demo` has no `team_admins` row ✅ RESOLVED (session 36)
~~Demo team predates the `team_admins` table.~~ Backfilled session 36 — added row
for `tarny@desicity.com` auth uid. Now mostly moot: the H2H + StatsView RPC
fixes (041, 042) mean `/demoadmin` works for unauthenticated visitors too via
the admin_token SECURITY DEFINER path.

### 4. `scoring.js` filename mismatch
**File:** `packages/core/engine/scoring.js`
**Detail:** File hosts `periodCutoff` (a non-scoring helper) alongside `hasGoalData` +
`resolveDominantType`. Low priority until file grows further.
**Fix:** Rename to `stats-helpers.js` when adding more helpers.

### 5. Cross-browser / in-app-webview install loses token breadcrumb ✅ MOSTLY RESOLVED (session 37)
**Original detail:** localStorage breadcrumbs (`ioo_last_visited` / `ioo_redirect_to`) didn't
survive cross-browser handoffs OR (more critically) the Safari → installed-PWA
storage boundary on iOS. Installed PWAs opened at `/` with no breadcrumb → PWAWelcome.
**Resolution (session 37):** session 37 shipped the **per-install dynamic manifest**
pattern (Option E from the original "fix not yet built" list). `/api/manifest?admin=<token>`
and `/api/manifest?player=<token>` emit a manifest whose `start_url` is `/admin/<token>`
or `/p/<token>`. An inline `<script>` in `index.html` injects the right
`<link rel="manifest">` at HTML parse time (iOS reads the manifest at parse, ignoring
later JS mutations — that's why the previous React-effect swap silently failed).
Post-create and post-join flows hard-redirect to `/admin/<token>?just_created=1` and
`/p/<token>?just_joined=1` so the URL path matches what the inline script needs to
inject the personalised manifest. Verified end-to-end on real iOS device for both
admin and player installs. **Still potentially affected:** cross-context cases where
the user installs from a different browser than they joined in (in-app webview →
Chrome install). For those, the localStorage breadcrumb + the new PWAWelcome
polymorphic paste box (accepts p_/admin_/join links) act as escape hatches.
Server-side cookie fix (originally proposed as Option B) is no longer required for
the core flow.

### 6. PlayerView direct `matches` table read 401s on every page load ✅ RESOLVED (session 36)
The 401s on the `from('matches')` reads were from `getHeadToHead` and
`getPlayerLeagueTable`, not PlayerView itself — both were wrapped in
SECURITY DEFINER RPCs (migrations 041 + 042) with adminToken threading.
Same pattern applies to authenticated player sessions which hit the
direct-read fallback path. Console clean post-fix.

---

---

## RESOLVED THIS SESSION (May 24 2026 — session 39 — push fix + admin_save_teams scoping + notify whitelist + superadmin Phase 1+2 + workspace-deps guard)

Triggered by a 73.7% Vercel dashboard error rate. Investigation cascaded
into one latent production bug and three smaller fixes.

- **Push notifications silently dead since deploy of platform-clubmanager**
  — three-layer bug, all three layers fixed:
  1. All four VAPID env vars on Vercel platform-clubmanager production
     were stored as empty strings (set 13 days ago but with no value;
     dashboard masked this as "Encrypted" so we couldn't see). Generated
     a fresh keypair, set via `vercel env add --value`, redeployed.
  2. All six `pg_cron` notification jobs called `https://in-or-out.com`
     (apex) which 307-redirects to `www`. `pg_net` (like all sane HTTP
     clients) STRIPS the `Authorization` header when following a
     cross-host redirect. So the cron's bearer never reached the
     function → 401 → never delivered. Latent since cron setup, masked
     by parallel VAPID 500s until those were fixed. Rewrote all 6 jobs
     via `cron.alter_job` to use canonical www URL.
  3. `pg_cron` job 5 (`notif-bibs-24hr`) had `Liverp00l123?!!*` pasted
     mid-body, causing a `syntax error at or near ":="` ERROR every
     hour on the hour. Fixed via `cron.alter_job` with clean body.
  Verified end-to-end at the 19:45 UTC cron tick: 4× HTTP 200 vs
  4× HTTP 401 at 19:30 (apex/auth-strip baseline). `push_subscriptions`
  still 0 — Beta hasn't yet exercised the in-app subscribe flow, so the
  proof-on-device test is deferred.

- **admin_save_teams cross-team write surface (migration 048)**
  — defense-in-depth fix flagged in the pre-Beta audit. The CLEAR
  statement in 043 correctly scoped `UPDATE players SET team=NULL` via
  `team_players` join, but the two subsequent SET statements
  (`team='A'`/`team='B'`) trusted the client-supplied arrays against
  the global `players.id` namespace. A legit admin for team X could
  pass foreign player_ids from team Y in `p_team_a`/`p_team_b` and
  flip their team column. Verified live: team_demo admin successfully
  wrote `team='A'` to a Finbars player (rolled back). Migration 048
  adds the same `team_players` scope to both SET statements. Foreign
  IDs now silently update 0 rows. Adversarial test re-run post-fix
  confirmed leak blocked; happy-path test confirmed legit calls still
  work. Commit `156dc84`.

- **notify_team_change whitelist missing `player_account_deleted`
  (migration 049)** — session 37's migration 047 (`delete_my_account`
  FK purge) passes this reason to `notify_team_change`. The function
  has a hard whitelist for log-warning purposes only — broadcast still
  worked, but every account deletion logged
  `notify_team_change: unknown reason "player_account_deleted"`.
  Added the reason to the whitelist. Commit `5a1a0e3`.

- **Pre-Beta launch blocker: `player_join_team` never generated a
  player token (migration 044)** — found during the pre-Beta audit
  and fixed before the invite link went out. The new-player INSERT
  branch omitted the `token` column, so first-time joiners landed
  with `player.token=NULL`, `JoinSuccess.jsx` fell back to `/`,
  stranded them on the landing page. Now generates a token using
  the same helper `create_team` uses. Commit `cec9975`.

- **Super-admin dashboard Phase 1 + 2 shipped (migrations 045, 046)** —
  separate Vercel-SSO-protected app at `apps/superadmin`, deployed at
  `https://platform-superadmin-djj9b1w8x-tarny-s-projects.vercel.app`.
  New `platform_admins` table + `is_platform_admin()` helper + four
  read RPCs (`superadmin_whoami`, `superadmin_list_teams`,
  `superadmin_team_detail`, `superadmin_recent_activity`). Three UI
  tabs: live audit_events tail, teams overview, per-team drilldown.
  Read-only — write tools (token rescue + data fix) deferred to a
  future Phase 3/4. Commits `9b7bda8` (initial), `a6fe2a8` (workspace
  dep recovery).

- **Workspace-deps guard hook + alias cleanup (commit `7547d49`)** —
  the superadmin scaffold's first commit listed `@platform/supabase`
  as a real npm workspace dep, but it was only a Vite alias. Local
  builds passed (Vite resolves at build time), Vercel CI failed
  workspace-wide because npm couldn't resolve it from the registry.
  This cascaded to break platform-clubmanager's deploy pipeline too
  (`www.in-or-out.com` kept serving the prior good build because
  Vercel only promotes on success). Fix: removed the fake dep,
  eliminated the alias entirely (22 source files migrated to import
  from `@platform/core/storage/supabase.js`), added
  `Skills/scripts/check-workspace-deps.sh` wired into the pre-commit
  build gate to make this bug class structurally impossible going
  forward. The check verifies every `@platform/*` dep maps to a real
  workspace package; sub-second, jq-based. Negative-tested by
  re-adding fake deps and confirming the check blocks the commit.

- **One 401 on direct `matches` read** — investigated, **not a code
  bug.** Query signature matched `getHeadToHead`'s direct-read
  fallback (intentional code for authenticated player sessions),
  called with a team_id (`team_54awfyl7TQY`) that has never existed
  in this database. Source: stale PWA install / localStorage
  breadcrumb / pre-DB-wipe artefact. RLS correctly rejected. User
  sees empty H2H section, no crash. Decided to skip — revisit if
  real Beta users report empty H2H.

---

## RESOLVED THIS SESSION (May 24 2026 — session 37 — beta P0 cascade)

Beta launched. First real customer hit a chain of bugs in the first hour.
Session 37 was a long bug-fix cascade — fixes in order of discovery:

- **OAuth loop on `/join/CODE`** — JoinTeam rendered "Continue with Google" on
  first paint with `authUser=null` because App.jsx hadn't resolved the initial
  session yet. User tapped Google, completed OAuth, came back, saw the same
  sign-in screen. Fix: JoinTeam self-checks via `supabase.auth.getSession()` on
  mount (renders a neutral loading state until probe resolves) + App.jsx gains
  an `authReady` flag that holds every route until the top-level session check
  has resolved. Commit: `2cd33c9`. Plus regression fix in `5c2cae2` (load()
  needed `session` restored after the refactor) and `/create` hardening (dual
  sessionStorage + localStorage write from useEffect).
- **JoinTeam wordmark rendered "INOROUT"** — `.join-brand` was `display: flex`
  which collapses whitespace between flex items. Swapped to `display: block`.
  Commit: `a5cf076`.
- **PWA installed from SquadReady opened to "Paste your link"** — biggest bug
  of the session. Initial fix (write `ioo_last_visited` to localStorage in
  SquadReady) FAILED because iOS Safari partitions PWA localStorage from
  Safari's. Next attempt (swap `<link rel="manifest">` via React useEffect)
  FAILED because iOS reads the manifest at HTML parse time and ignores
  subsequent mutations. **Actual fix** (commits `11614ee`, `2d12db3`,
  `b7236ca`): new `/api/manifest` Vercel serverless function emits a
  personalised manifest with `start_url=/admin/<token>` based on a `?admin=`
  query param (regex-validated); inline `<script>` in `index.html` runs
  during HTML parse and injects the right `<link rel="manifest">` URL
  before iOS can fetch a manifest; useOnboarding hard-redirects to
  `/admin/<token>?just_created=1` after create succeeds, so the URL path
  matches what the inline script needs. App.jsx top-level renders SquadReady
  as a session-storage-backed overlay on `?just_created=1`. Verified live on
  iPhone — home-screen icon opens directly to admin panel.
- **PWA installed from JoinSuccess opened to "Paste your link"** — same root
  cause as admin install, same architectural fix mirrored. `/api/manifest`
  extended to accept `?player=<p_token>`. Inline script in `index.html`
  also matches `/p/<token>` paths. handleJoin hard-redirects to
  `/p/<token>?just_joined=1` after `playerJoinTeam` succeeds. App.jsx
  renders JoinSuccess as overlay on `?just_joined=1`. Commits: `f62cc7c`
  (endpoint + inline script + App.jsx player swap), `90bba41` (handleJoin
  redirect + overlay). Verified live on iPhone.
- **Player invite link in admin panel used team_id instead of join_code** —
  `SquadScreen.jsx:404` rendered `in-or-out.com/join/${teamId}`. Bug was
  masked because `get_team_by_join_code` has a fallback that matches against
  team_id, but the share traces were leaking team_ids and the displayed URL
  was the wrong identifier. Fixed: SquadScreen now fetches the team via
  `getTeamByAdminToken` on mount and uses `team.join_code`. Commit: `a8b803e`.
- **OAuth "User not found" loop on /join after delete-account** — separate
  diagnostic finding. A previous `delete_my_account` for tarnysingh@gmail.com
  had succeeded at the SQL layer but failed silently at `auth.admin.deleteUser`
  (Stage 2). Returned `ok:true,authDeleted:false`. The auth.users row +
  auth.identities row stayed forever, blocking that email from ever signing in
  again — Google verified the identity, Supabase looked up the missing
  user_id → 404 "User not found" → silent OAuth loop. Root cause: the 040
  RPC version anonymised the player row and *revoked* (not deleted)
  team_admins rows, and never touched user_profiles. Postgres refused to
  delete auth.users because those FKs (NO ACTION) still pointed at it.
  Fix: migration 047 rewrites the RPC to DELETE team_admins rows (not just
  revoke), NULL out granted_by/revoked_by references, NULL platform_admins
  granted_by, and DELETE the user_profiles row. After 047, `auth.admin.deleteUser`
  succeeds and auth.identities cascades naturally. Verified by calling the
  real `/api/delete-account` endpoint and confirming `authDeleted:true` plus
  zero rows remaining in auth.users / auth.identities / user_profiles.
  Migration: 047. Edge function comment: `155f0ee` documents the gotcha
  and the manual cleanup SQL for any future stuck account.
- **JoinTeam wordmark CSS hex fixes, SignIn pre-existing hex tokens,
  Google brand hex allowlist** — incidental hygiene fixes forced by the
  post-edit hook on touched files. Commits: `12d0ceb`, `b041f38`.

**Bundle commits (in order):** `12d0ceb` → `2cd33c9` → `692d84a` → `a5cf076`
→ `5c2cae2` → `b041f38` → `11614ee` → `2d12db3` → `9673934` → `b7236ca`
→ `7c36dc7` → `a8b803e` → `155f0ee` → `f62cc7c` → `42c54e8` → `90bba41`.

## RESOLVED (May 24 2026 — session 36)

- **H2H on /demoadmin showed "you haven't played in the same game yet"** —
  `getHeadToHead` did three direct `.from()` reads on `matches` +
  `player_match`. Under post-session-24 RLS those returned zero rows for
  anon callers; the modal silently rendered empty. Migration 041 added
  `get_head_to_head_raw_by_admin_token` (SECURITY DEFINER, derives team
  from admin_token, returns three jsonb arrays). JS branches on
  adminToken; existing computation untouched. Threaded adminToken
  through App.jsx → PlayerView/StatsView → HeadToHead. Commit: `a95e074`.
- **StatsView form chips + reliability column always blank** — same root
  cause. `getPlayerLeagueTable` did direct `.from()` reads → RLS-blocked
  on anon. StatsView's local tableData hard-coded `reliability:null` +
  `form:[]` because `matchHistory + squad` props can't derive either
  (need ordered player_match rows + all-time attended counts). Migration
  042 added `get_player_league_table_raw_by_admin_token`; StatsView now
  augments local tableData with form + reliability from the RPC. Also
  fixed HeadToHead Section 4 Overall Comparison bars on demoadmin via
  same threading. Commit: `ed92e2f`.
- **TeamsScreen — buttons "do nothing", duplicate CONFIRMs, no
  REGENERATE option** — three related UX gaps. The confirm RPC was
  firing fine but visual feedback was a tiny green toast easy to miss;
  button text never changed; admin couldn't tell anything happened.
  Plus two confirm buttons (top + bottom) doing the same thing. Plus
  BUILD TEAMS gated on `groupsDirty` so admin couldn't re-shuffle
  without first editing groups. Combined fix: dropped the duplicate
  top button + the toast; bottom button is now state-aware (assign
  first / confirm / confirming / ✓ confirmed). BUILD TEAMS always
  visible when SMART is open, with adaptive label (BUILD TEAMS when
  groups dirty, REGENERATE TEAMS otherwise). Commits: `a7e3e96`, `b257ae3`.
- **PlayerView Live Board team sheet empty after confirm** —
  `admin_save_teams` only wrote `matches.team_a/team_b` (the persistent
  match row), never `players.team` (the denormalised column PlayerView's
  Live Board reads at line 203). Migration 043 extends the RPC to clear
  + set p.team on every confirm, scoped to team via team_players join.
  Commit: `a14590b`.
- **TeamsScreen CONFIRM TEAMS button reverted to "CONFIRM" on return** —
  race condition between matchId hydration effect (which set
  teamsConfirmed=true from the loaded match) and the auto-Smart effect
  (which read empty `assignments` from its stale closure, decided
  "nothing assigned", ran the algorithm, called setTeamsConfirmed(false)).
  Whichever setState committed last won. Fix: hydration now sets
  `hasAutoFiredRef.current=true` when it detects an already-confirmed
  lineup, so auto-Smart bails before running. Commit: `a14590b`.
- **/demoadmin "me" defaulted to a leftover Test Player row** —
  the squad lookup matched `userId === session.user.id` for the auth
  user. For accounts with an orphan p_* row pointing at their uid,
  this surfaced a meaningless test player as the header avatar and
  broke every player-centric surface. demoadmin is a public showcase
  route, not identity-bound — hard-coded "me" to Hassan (`p_demo_01`),
  the demo protagonist with the richest seeded history. Commit: `dd14c6e`.
- **Dead IO Intelligence query block** — 10 supabase.js functions
  (`getPlayerMatchStats`, `getWinRate`, `getCurrentRun`,
  `getReliabilityScore`, `getMostPlayedWith`, `getOpponentStats`,
  `getNemesis`, `getBestPartnership`, `getPlayerImpact`,
  `getPOTMVoteStats`) with zero callers. Pre-session-32 leftovers; the
  proper IO deeper-intel lives in `packages/core/engine/deeperIntel.js`
  now. Removing ~298 lines closes a latent RLS-blind-spot risk
  (every one used direct `.from()` reads). Commit: `9c17d4d`.

**Sweep verified clean:** post-fix, every direct `.from()` call left in
client code is either dead, demo-scoped, or hygiene-exempt. No more
RLS-blind-spot pathology in live customer read paths.

## RESOLVED (May 23 2026 — session 32)

- **B7: IO Intelligence deeper-intel cards were dead UI** — Most Played With (6+),
  Team Impact (7+), Nemesis (8+), Best Partnership (8+) all rendered the
  "Not enough data yet" placeholder in production, despite FEATURES.md
  marking them ✅ built. Root cause: `useIOIntelligence.js` hard-coded
  `mostPlayedWith`, `impact`, `nemesis`, `bestPartnership` to `null` and
  no upstream path computed them (RPC `get_team_state_by_player_token`
  returns only `match_stats`, `win_rate`, `reliability`;
  `computeStatsFromHistory` matched). Fixed by adding a pure client-side
  engine `packages/core/engine/deeperIntel.js` that computes all six
  deeper-intel metrics from `matches[]` + `squad[]` (already in state on
  every route). Wired into `computeStatsFromHistory` and both
  player-token state fetches in App.jsx. Hook stops nulling the keys.
  Shipped alongside two new cards (Most Faced Opponent 4+, Reliability
  Ranking 5+). Commit: `04877de`.

## RESOLVED (May 22 2026 — session 31)

- **B6: Status confirmation banners persisted on page refresh** — "🔒 Locked in",
  "👍 No worries we'll find cover" etc. all rendered on mount and only
  disappeared if the user happened to tap a status (firing the 5s timer).
  `hideConfirmation` initial value flipped from `false` to `true`; banners
  now only render in the 5s window after an actual `setStatus` call. Commit:
  `19abed9`.
- **B5: Player tile said "Are you in this Tuesday?" on a Wednesday match** —
  `gameDay` derived from `schedule.gameDateTime` first (which had drifted
  to a Tuesday in the demo schedule), falling back to `schedule.dayOfWeek`.
  Reversed the precedence: admin-configured `dayOfWeek` wins; the timestamp
  weekday is only a fallback. Commit: `c436992`.
- **B4: Smart Teams prediction stuck on "Even game" when one team is empty** —
  `computePrediction`'s `mean([]) ?? 0.5` defaulted both averages to 0.5,
  producing a draw verdict regardless of how lopsided the split was. Now
  returns `winner=null` when either side has 0 players; render guard hides
  the chip; confirm path saves NULL to `predicted_winner` rather than a
  misleading 'draw'. Commit: `d7cfa2f`.
- **B3: Manually-edited Smart Teams splits saved a stale prediction** — the
  algorithm's prediction was passed to `confirmTeams` even when the admin
  swapped players after Generate. Now the prediction is recomputed on every
  manual move (live), so the saved value always reflects the actual
  confirmed lineup. The "STALE / crossed-out" UI state was removed.
  Commit: `b31af19`.
- **B2: Game-is-live toggle blocked after Cancel This Week** — admin couldn't
  re-enable the game once cancelled. Root cause: `admin_upsert_schedule`
  writes day/kickoff/venue/etc but does NOT write `is_cancelled` or
  `active_match_id`. After `admin_cancel_match` set both, flipping
  `game_is_live=true` through the toggle left the schedule in conflicting
  state (`is_cancelled=true && game_is_live=true`, `active_match_id=null`)
  and the screen continued to render the cancelled state. New
  `admin_reopen_week` RPC (migration 032) owns the full reopen
  transaction: clears the cancelled state, inserts a fresh `matches`
  row, points `active_match_id` at it, writes a `week_reopened`
  audit_events row. JS `reopenWeek(adminToken)` wrapper. AdminView
  `openNextWeek` and ScheduleScreen `save` both branch through it when
  `schedule.isCancelled` is true. Verified against `team_demo`
  end-to-end via MCP. Commits: `5061508`, `e2f67ea`.

## RESOLVED (May 21 2026 — session 29)

- **B1: Stale `p.is_vice_captain` in 10 deployed RPCs** — `players.is_vice_captain` was
  removed in migration 026 (session 27) but 10 SECURITY DEFINER functions still referenced
  it in their SELECT clause. PL/pgSQL validates column references at runtime, not definition
  time, so all 10 failed silently with `internal_error`. Affected: all Manage Squad buttons
  (INJURED, DISABLE, PRIORITY), player attendance (`set_player_status`), payment marking
  (`set_player_paid`, `set_guest_payment`), injury self-report (`set_player_injured`),
  and admin tools (`admin_set_player_note`, `admin_set_player_status`,
  `admin_update_player_name`). Fixed via `apply_migration` — removed stale
  `'is_vice_captain', p.is_vice_captain,` line from all 10 SELECT clauses. Verified via
  `execute_sql` — all 10 return non-null. Schema cache reloaded. `admin_set_vice_captain`
  was already correct (uses `tp.is_vice_captain` via JOIN). No JS changes needed.
- **CreateTeam email field redundant** — `authUser` now flows App.jsx → Onboarding →
  `useOnboarding`, seeding `adminEmail` from OAuth email. Input field and validation
  removed from UI. RPC call unchanged. Commit: `419fba2`
- **"Make game live" hint** — Dismissible banner added to AdminView showing when
  `gameIsLive` is false and `ioo_game_live_hint_dismissed` not set. CTA links to
  Match Settings. Permanent dismiss via localStorage. Commit: `419fba2`

## RESOLVED (May 21 2026 — session 28)

- **ScoreScreen bib eligibility 401** — replaced `getBibEligiblePlayers` direct
  `player_match` read with synchronous derivation from `squad` prop (`bibsSorted`). No new
  RPC needed. `getBibEligiblePlayers` deleted from supabase.js. Commit: `8aaae57`
- **Admin Decide button** — confirmed non-bug. `POTMTiebreakModal` auto-detects
  `adminDecisionPending` on return to AdminView. Flow works correctly.
- **insertMatch 401** — App.jsx call site removed (`setMatchHistory` made pure);
  `insertMatch` deleted from `supabase.js`.
- **upsertSchedule dead import** — removed from App.jsx imports.
- **TeamsScreen hardcoded colours** — all 5 fixed with CSS variables.
- **App.jsx dead imports** — `insertMatch`, `upsertSchedule`, `addCoverPlayer`,
  `removeCoverPlayer`, `updateCoverPlayer`, `getUser`, `getUserProfile`,
  `getTeamByPlayerToken` all removed.
- **Raw RPC in AdminView/index.jsx** — `admin_confirm_payment` extracted to
  `confirmPayment()` wrapper in supabase.js.
- **Gold hardcoded colours in AdminView/index.jsx** — replaced with `var(--goldb)` / `var(--gold2)`.
- **console.warn in App.jsx** — changed to `console.error`.
- Dead functions removed from `supabase.js`: `bulkCancelLedgerEntries`,
  `bulkResetPlayerStatuses`, `deletePlayerMatchRows`, `findPlayerByUserId`,
  `findPlayersByName`, `getPlayerByUserId`, `updateCareerBibCount`, `insertBib`,
  `addCoverPlayer`, `removeCoverPlayer`, `updateCoverPlayer`, `getBibEligiblePlayers`
- Dead payment functions removed from `payments.js`: `handleClearDebt`, `handleStripePayment`
- `IsThisYou.jsx` deleted (never routed to or imported)
- Commits: `1784b44`, `3e2bfde`, `9003865`, `6df6fcf`, `9441888`, `957f63d`, `8aaae57`

---

## PREVIOUSLY RESOLVED (for reference)

| Bug | Fixed in |
|---|---|
| NameStep discards returning player name | Session 22 |
| `handleAddPlayer` missing `teamId` | Session 22 |
| `players.deputy` DB column (renamed, now gone) | Session 23 |
| `owes` double-increment risk | Session 26 |
| `App.jsx:639` join call signature mismatch | Session 27 |
| `getPlayerTeams` RLS bypass | Session 25 |
| Stats + My IO showing no data post-RLS | Session 25 |
| Realtime callbacks using direct table reads | Session 25 |
| `is_vice_captain` in wrong table (players → team_players) | Session 27 |
| POTM voting RLS (submit_potm_vote + get_potm_voting_state RPCs) | Session 25 |
| `add_guest_player` + payment RPCs referencing `players.is_vice_captain` | Session 27 |
| `carryForwardDebts` dead code removed | Session 26 |
| B1: 10 RPCs referencing removed `players.is_vice_captain` — all Manage Squad buttons + `set_player_status` + payments broken | Session 29 |
