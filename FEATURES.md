# In or Out — Feature Tracker

## REFEREE EPIC — full plan in `REFEREE_HANDOFF.md`

Referee home in `/hub` + `apps/ref` officiating. **SHIPPED (merged):** referee role/My-fixtures/
in-app officiating iframe (#133) + auto-link on sign-in (#133) + LiveMatch polish (#134).
**NEXT — four PRs, each its own PR, priority order:** (1) push-notify ref on assignment
*(next session)* → (2) history/past matches → (3) availability + accept/decline → (4) tournament
officiating. Next free mig = **441**. See `REFEREE_HANDOFF.md` for the per-PR audit + boundaries.

## PILOT BACKLOG — multi-team football club feedback (2026-06-22)

First face-to-face feedback from the multi-age football club pilot (Club/Org SKU).
Positioned as a **replacement for 360Player + MatchDay Admin + Tournify**. Wider-management
demo ~2026-06-29. Full feedback, prioritised backlog table, competitor pricing and the FA
Full-Time feasibility verdict live in **STRATEGY.md → "PILOT MEETING FEEDBACK (2026-06-22)"**.

**Working through the 17 asks one-by-one. STATUS (s180):** ✅ DONE = #2 org/team structure (migs
389–393), #4 coach invoice-chasing (mig 398), #8 opposition-coach matchday link (migs 394–396),
#9 embed code (mig 397), #10 Simplify Venue OS UI + #11 modularity (full Venue OS nav epic, migs
399–402), #1 FA spike (NO-GO verdict), #14–17 (already loved). 🟢 PARTIAL/addressed = #3 mass
invoicing (built, dormant — needs live Stripe keys) + season/fixed-term billing (Stripe Phase 4, mig
406 — season-length plans auto-stop, future start-date anchoring, mid-season equal instalments; built &
tested on TEST keys, runtime test-clock walk owed before merge) + lifecycle (Stripe Phase 5, mig 407 —
self-service Billing Portal, bulk price change [Option A: applies next renewal, no mid-cycle proration],
Stripe refunds [full / pro-rated-unused / custom]; built & tested on TEST keys, test-mode walk owed),
**🏁🏁 PITCH PRIORITY #5+#6 — EPIC COMPLETE (3 phases, migs 416–418), P3 SHIPPED s197** (`PITCH_PRIORITY_HANDOFF.md`):
P3 (mig 418, tiny additive) = CALENDAR SURFACING — `_pitch_occupancy_detail` gains `priority_rank` →
⭐/#n rank badge on club occupancy blocks across all 3 venue grids (ScheduleGrid/AllGroundsGrid/DayAgenda)
+ the suggested-slot Accept/Decline prompt surfaced for BOTH the operator (venue `BumpProposalsBanner`,
reads `venue_list_bump_proposals`/`venue_resolve_bump`) AND the club manager (inorout `SessionsScreen`
bump card, reads `club_manager_list_bump_proposals`/`club_manager_resolve_bump`); tentative/bumped events
hold no occupancy and drop from the scheduled list, so the bump banner IS the needs-attention surface.
P3 gates: rpc-security PASS, build venue+inorout + hygiene 7/7 + hex, casual-regression PASS (only
manager-gated SessionsScreen card, not in casual inventory), Playwright PASS (⭐ badge + Decline walk →
DB declined → banner clears, 0 errors), EV N/A (no new write RPC). ⛔ owed venue deploy + signed-in
inorout-manager device walk.

P1 = reserved-window foundation — `pitch_reserved_windows` table + venue config RPCs + "Reserved times"
editor + advisory calendar shading. **P2 (mig 417) = enforcement + rank bumping IS LIVE:** external gate
via `_pitch_window_blocks` (`book_pitch_adhoc`/`_series` → `slot_reserved`; `venue_create_booking*` →
`warning:'reserved'` operator override), and rank-driven club-team bump (`_reserve_club_occupancy` → worse
`priority_rank` yields → `tentative` + release + `_closest_available_slot` across same-company venues →
`pitch_bump_proposals` + `_notify_bump` via club_announcements → Accept/Decline RPCs
`club_manager_resolve_bump`/`venue_resolve_bump` + list readers). Bumping is club-vs-club ONLY — paying
hires never auto-evicted; `club_sessions`/`club_fixtures` status gained `tentative`. **P3 (calendar UI)
SHIPPED s197 (mig 418) → epic complete.** P2 gates: rpc-security PASS (4 public + 7 helpers),
EV 14/14+leak0, casual-regression PASS (additive), build venue+inorout + hygiene 7/7, Playwright boot
0 errors. ⛔ owed venue deploy + real-device two-token walk.
**Original ask:** #5 pitch priority/reserved times (internal club use vs external/casual hire) +
#6 team prioritisation (`club_teams.priority_rank` ⭐ display-only since mig 389; make it *drive* pitch
priority so a higher-ranked team wins a contested slot / gets first call on reserved windows),
#7 multi-venue (access layer shipped mig 401; activity layer scoped s188 → `MULTI_VENUE_HANDOFF.md`,
same-operator only. **🟢 PHASE 1 SHIPPED+MERGED s189 (mig 412, PR #84→main) — venue-anchor club_sessions:**
`club_sessions`/`_series` += `venue_id`/`playing_area_id` (backfilled byte-identical), new same-operator
guard `_venue_in_club_operator`, 5 session write RPCs gain the venue (validated, old overloads dropped),
readers return venue+address, venue-app venue/pitch picker + venue filter + labels, inorout manager venue
picker (Option B) + member card shows venue. **🟢 PHASE 2 BUILT s190 (mig 413, PR pending) — cross-venue
fixtures:** function-only (NO schema/guard change, reuses the Phase-1 guard) — `venue_upsert_club_fixture`
pitch gate relaxed to "pitch ∈ caller venue OR a same-operator club venue" (own-venue short-circuit keeps
single-venue clubs byte-identical), `venue_list_club_fixtures` += venue_id/name/address, and a LATENT BUG
FIXED — `get_club_fixture_matchday` now derives the ground from the pitch's venue (`COALESCE(pitch.venue,
league.venue)`) so an away-site home game shows the right ground (was always the league's home venue).
Venue FixturesTab gains the same-operator venue + pitch picker. Gates all PASS (rpc-security 3 fns, EV
9/9+leak0, casual-regression N/A [no core/inorout change], build+hygiene, Playwright matchday+FixturesTab
smoke). **🏁🏁 PHASE 3 SHIPPED s191 (mig 414) — EPIC COMPLETE — pitch occupancy / clash protection +
cross-site calendar:** club sessions + fixtures with a pitch now reserve `pitch_occupancy` via per-table
TRIGGERS (`tg_sync_club_session_occupancy`/`tg_sync_club_fixture_occupancy`, covering every create/update/
cancel/void/delete path), so they show busy on the venue calendar AND a clashing activity is hard-blocked
`slot_unavailable` (EXCLUDE constraint, no displacement). NEW reader `get_operator_pitch_occupancy` feeds a
cross-site **ground switcher** in venue BookingsView (all same-`company_id` sites, others view-only); blocks
render with an ICON + Training/Match tag + team + manager initials (not colour-alone); Training/Match filter
chips added. Gates ALL PASS (rpc-security 2 readers + 2 helpers locked, EV 8/8+leak0 own `_e2e_` 2-venue
same-co club, build venue+inorout + hygiene, casual-regression additive-only [inorout untouched, manager
path passes no pitch], Playwright smoke 0 errors: Match block renders, filters exclude, switcher works).
⛔ owed venue deploy + real-device walk. **🟢 ALL-GROUNDS SINGLE-CALENDAR VIEW SHIPPED s194 (UI-only, no
mig):** BookingsView ground switcher gains an "All grounds" option laying every same-company venue on ONE
pitch calendar grouped by venue (`AllGroundsGrid.jsx`), home site bookable + others view-only; also clarified
Training/Match block visuals (colour-filled badge + glyph chip) + calmed the pitch-visibility chips.
**🟢 UNIFIED RESOURCE CALENDAR PHASE 1 SHIPPED s198 (mig 419, read-only):** the "(NOTE: PITCH calendar only)"
caveat above is now LIFTED — the Bookings calendar gains a "Show: Pitches/Rooms/Trainers/All" switch that lays
**pitches + rooms + classes + trainers across every operator venue** on ONE calendar (shared `GroupedColumnGrid`
engine; `AllGroundsGrid` refactored onto it, regression-safe) + an **equipment availability strip**, all
filterable. Read-only (tap→detail, empty→no-op). New reader `get_venue_resource_occupancy` + `ResourceCalendar`/
`ResourceBlockModal`/`EquipmentStrip`. Pitches mode = existing pitch console unchanged. Gates all PASS (EV
3/3+leak0, Playwright 0 err, rpc-security, hygiene 7/7). ⛔ owed venue MANUAL deploy + device walk.
**LAYOUT REWORK s198 (UI-only, no mig) after operator feedback** (grid terrible for big venues + kept
resizing + equipment fell below fold): now a **Grid/Agenda view toggle** (persisted; mobile=Agenda) —
Grid = fixed-height pane (62vh, constant window from opening hours → no resize), empty resources hidden +
"Show all" toggle, live now-line + auto-scroll; Agenda = denser per-resource rows of time chips
(`ResourceAgenda`). Equipment strip pinned (always visible). Pitch Requests/Cancellations hidden in unified
modes. Both views Playwright-verified 0 err, height-stable; Pitches mode unchanged.
**Phase 2 (next) = book/create from the calendar, desktop + mobile.** DEFERRED follow-up (now Phase 2):
create-a-session/match-from-a-calendar-tap + mobile booking polish for that flow,

**🟢 CALENDAR & MOBILE PHASE 3a — MANAGER SEES CLUB LEAGUES FIXTURES (mig 420, s200).** The team
manager's inorout Agenda (`SessionsScreen`) previously showed `club_sessions` only; operator-created
Club Leagues fixtures (`club_fixtures`) were invisible to them. New read-only reader
`member_list_club_fixtures(p_club_id)` folds the caller's managed-team fixtures into the same
day-grouped Agenda as read-only `FixtureCard`s (Club League badge, vs-opponent, KO time, pitch/venue,
home/away) → tap → read-only `FixtureDetail` sheet + "View matchday page" link. Operator owns the
schedule; manager reads only.

**🟢 CALENDAR & MOBILE PHASE 3b — HOME-FIXTURE MANAGER EDIT (mig 421, s201).** The Phase-3a
`FixtureDetail` now lets a HOME-team manager edit logistics in place — kickoff time, pitch (from the
allowed venue set = league home venue ∪ same-operator club venues), and referee (a named venue
official OR free-text). Away fixtures + date/opponent/scores/status stay operator-owned/read-only.
NEW guarded write `club_manager_update_home_fixture` (manager+is_home gated) **reuses** the mig-414
`tg_sync_club_fixture_occupancy` trigger for clash protection (`slot_unavailable` — a manager can't
double-book) + an options reader `club_manager_get_home_fixture_options` feeding the form's pitch +
official pickers. Gates all PASS (EV 8/8 + leak 0, rpc-security, build/hygiene, casual additive,
Playwright boot). ⛔ owed Hard Rule #13 device walk + venue deploy. **Next = P4 push** for comms +
bumps; **Phase 2b** operator room-hire/trainer-appointment create. Full phase log in the
`project_calendar_mobile` memory.
#13 season setup (partial). ⬜ NOT STARTED = #12 reporting/data (biggest remaining gap). The full prioritised table with effort
+ demo priority lives in **STRATEGY.md → "PILOT MEETING FEEDBACK (2026-06-22)"**.

**Venue OS nav epic (closes backlog #10 nav + #11 modularity) — Phase 0 SHIPPED (s178, no mig).**
IA cleanup only, pure venue-app UI: rail regrouped to Run · People · Programmes · Competition ·
Club & admin (renames Sessions→"Club sessions", Table→"Standings"); Fixtures surfaced under
Competition (internal `club_fixtures` editable vs FA embed read-only, enforced by the data
model); MembershipsView 13 chips → 5 grouped chips w/ sub-tabs; the per-club coach/DBS Staff tab
MOVED into top-level Staff (not a duplicate of venue-ops Staff); venue-hex tech-debt tokenised.
**Phase 1 — flag foundation SHIPPED (mig 399).** Two boolean flag tables `venue_features`
(bookings/spaces/room_hire/equipment — per venue) + `club_features` (memberships/competition/
coaching/tournaments/public_web — per club, OR'd across the venue's clubs via `club_venues`),
all DEFAULT true with no-row = on → existing venues zero-touch, all-on. Reader
`get_venue_feature_flags(credential)` + `getVenueFeatureFlags` wrapper, loaded in the venue app.
**3-layer gate, all live:** nav (rail filter on a `flag` per item + empty-group hide), route
(deep-link/SearchPalette bounce + content short-circuit), server (`feature_disabled` guard on **74**
gated write RPCs — venue-feature via `_venue_feature_enabled`, club-feature via the union
`_venue_club_feature_enabled` or specific `_club_feature_enabled` where a club_id is in scope).
Customer CRUD intentionally NOT gated (always-on Customers screen). Verified: line-level baseline
diff proved guard-only changes across all 74 (REMOVED=0); EV proved flag-off rejects + flag-on
passes through, self-rolled-back + leak-clean; helpers revoked from anon/authenticated; venue build
+ hygiene clean; Playwright boot smoke (rail identical all-on, Bookings vanished when toggled off,
restored). ⛔ owed real-device venue walk (s178 Phase 0 walk still owed too).

**Phase 2 — A+B+C SHIPPED (mig 400, s180).** The operator can now flip features safely (backlog #11).
**A — toggle UI:** new venue rail item **Features** (Club & admin group, `manage_facility`-gated) →
`FeaturesView` lists facility features (venue) + one section per club (org features) with on/off
toggles. New RPCs: read `venue_get_feature_settings` + writes `venue_set_venue_feature` /
`venue_set_club_feature` (manage_facility-gated, audited; a flag row is written ONLY when something is
OFF and pruned once all-on again → the no-row=on / zero-backfill invariant is preserved exactly).
**B — dependency graph** enforced server-side in `venue_set_club_feature`: enabling Coaching
auto-enables Memberships; disabling Memberships is blocked (`dependency_required`) while Coaching is
on (the UI reflects it — Memberships toggle locked with a reason). Payments is always-on core (not a
flag) so its edges (Memberships→Payments, Tournaments→Payments) are satisfied-by-construction; encoded
as comments for a future `payments` flag. **C — discipline axis** (relevance, a SECOND rail gate kept
separate from the purchased flag): `get_venue_feature_flags` extended with `disciplines`; new
`lib/featureRelevance.js` `itemDisciplineRelevant()` hides Classes/Trainers from football-only venues
and Leagues/Standings/Fixtures/Cups from non-team venues, union across the venue's clubs, fail-open on
unknown/'other'. Gates: rpc-security PASS (single-overload/SECDEF/search_path; anon+authenticated
grant — the shared backdoor token calls every venue_* RPC as anon, a smoke-caught fix from an initial
wrong authenticated-only lock), EV 10/10 + leak 0 (toggle persists, auto-enable + unsafe-disable both
fire, default-all-on preserved), venue build + hygiene 7/7, hex hand-check, discipline logic 15/15
unit, Playwright boot smoke on demo (Features renders 3 clubs, Bookings OFF → rail+screen+server all
reject with `feature_disabled` → ON restores, demo_venue back to 0 rows, 0 console errors).
casual-regression PASS via additive-diff (packages/core +34 lines/0 removed, no apps/inorout touched).
⛔ owed real-device venue walk (now Phase 0+1+2). **Next free mig = 401.**

**Phase 2.5 — membership-scope refactor SHIPPED (mig 401, s180).** Membership eligibility now resolves
across the club's venues, not a single `venue_id`. Live audit pinned the surface to **6 gates** (not
the feared ~17): `member_book_class_session`, `member_book_appointment`, `member_purchase_class_package`,
`member_join_club_team`, `member_list_trainers`, `member_get_venue_membership_pass`. **No new column** —
the scope key already exists (`venue_memberships.club_id`, set on all 23 live rows). Two STABLE helpers:
`_membership_covers_venue(club_id, venue_id, target)` (club → target ∈ `club_venues`; club-less →
own venue, defensive) + `_member_entitled_at_venue(profile, target)` (active/ending membership whose
scope covers target). Each gate's single `… venue_id = target …` predicate swapped onto the helper via
a whitespace-tolerant, exactly-once-asserted `regexp_replace` on the live body (mig-075 precedent),
**baseline-diff verified** (post-apply md5 == predicted; only the predicate changed; stale predicate
gone). Cross-CLUB passes deferred entirely (option 1, s180) — the helper seam keeps them expressible.
Gates: rpc-security PASS (2 helpers SECDEF/STABLE/search_path/internal-only; 6 gates kept their exact
authenticated-only grants), EV PASS + leak 0 (full truth-table: the fix [member enrolled at the club's
2nd venue is entitled at the 1st], the no-op [not entitled at an unrelated club's venue], status filter
[cancelled membership rejected], non-member rejected), no JS change (return shapes unchanged → casual
byte-identical, SQL-only). On today's single-venue data behaviour is byte-identical — the change only
ever ADMITS a 2nd venue of the SAME club. ⛔ owed real-iPhone walk (a member of a multi-venue club books
at the 2nd venue; needs a real 2-venue club). **Next free mig = 402.**

**Phase 3 — package presets SHIPPED (mig 402, s180).** Named preset bundles ("Quick setup") that apply
a whole flag-set at once — shortcuts on top of the flags (flags stay the source of truth; the commercial
tier/pricing decision stays deferred, no `tier` enum). Two atomic, audited bulk RPCs
`venue_set_venue_features(token, jsonb)` + `venue_set_club_features(token, club_id, jsonb)` (manage_facility,
anon+authenticated for the backdoor; only present keys change; dependency closure — Coaching on forces
Memberships on — so a preset can never land an invalid state; a row written only to hold an OFF and pruned
once all-on, no-row=on preserved). The preset CATALOGUE lives client-side in FeaturesView (VENUE_PACKAGES:
Full facility / Bookings only; CLUB_PACKAGES: Full club / League club / Memberships & coaching / Match-day
only) so re-bundling/renaming is a one-line edit, no migration. UI: a "Quick setup" button row per scope
with the matching preset highlighted. Gates: rpc-security PASS, EV 6/6 + leak 0 (bundle applies, closure
forces memberships, partial-apply leaves absent keys, full bundle prunes the row, unknown key rejected),
venue build + hygiene 7/7, Playwright boot smoke on demo (applied "League club" to Finbar's FC → coaching/
tournaments/public_web off, memberships lock lifted, DB matched, highlight moved; "Full club" restored to 0
rows; 0 console errors), casual-regression PASS via additive-diff (packages/core +2 wrappers, no apps/inorout).
⛔ owed real-device venue walk (Phases 0–3). **Next free mig = 403.**

**Phase 4 — rail modulation wiring SHIPPED (s180, NO migration). 🏁 VENUE OS NAV EPIC COMPLETE (closes
backlog #10 nav + #11 modularity).** The flag+discipline rail gates were already live (Phases 1–2); Phase 4
gated the last always-on items that belong to a feature — **Teams + Players** (the league/competition
roster: "every team active across the venue's competitions") now carry `flag: "competition"` (nav + route,
auto via VIEW_FLAG) + the discipline `competition` kind in `featureRelevance.js` (so a non-team-sport venue
hides them too). Everything else verified genuinely core (Operations/Payments/Customers/Staff/QR/Integrations)
or already gated. Read-only directories → no write RPC to guard → no migration. Gates: venue build + hygiene
7/7, discipline logic 7/7 unit (Teams/Players: football shows, gym/boxing hide, union shows, none/other
fail-open), **Playwright collapse proof on demo** (set all 3 clubs "Match-day only" + venue "Bookings only"
→ rail collapsed 21→**9** items: Programmes + Competition groups fully hidden, Memberships/Teams/Players
gone, only Run·Customers·Staff·admin left → restored to full rail + 0 feature rows, 0 console errors),
casual-regression trivially clean (apps/venue only — no packages/core, no apps/inorout). The "18→~8 per
configured club" target is met (9 here, →~7 once Access/Features hide for a non-manager login). ⛔ owed
real-device venue walk (Phases 0–4). Full phased plan in **MODULAR_PLATFORM_HANDOFF.md**.

**#8 Opposition-coach matchday link + the FA-import spine — Phase A SHIPPED (mig 394).** New
`club_leagues` + `club_fixtures` RPC-only tables let a club hold its own home/away games vs
free-text external opponents, with assigned pitch + ref + per-venue matchday ground rules
(`venues.matchday_info`). Operator surface = new **Fixtures** tab in the venue MembershipsView
(create league → add/edit fixture → assign pitch & ref → set ground rules). Each fixture mints a
public `share_code` for the opposition-coach link (Phase B). FA-import columns added dormant for
Phase C. 8 venue-token RPCs (EV 13/13 + leak 0, rpc-security PASS). Sprint plan + go/no-go in
PILOT_DEMO_SPRINT_HANDOFF.md / STRATEGY.md. ⛔ owed real-device venue walk of the Fixtures tab.

**#8 Phase B SHIPPED (migs 395 + 396).** Public `/matchday/<code>` opposition-coach link —
`get_club_fixture_matchday(share_code)` (anon read) + branded `MatchdayScreen` (home team,
kick-off, pitch, ref, venue address/directions, ground rules; tokens-only). Venue "Share matchday
link" button per home fixture. Mig 396 = idempotent demo seed (Finbar's FC U12 Falcons v Riverside
Rangers, stable code `demofalcons01`) — live populated render Playwright-verified. ⛔ owed
real-iPhone walk. Phase C = FA AI-import (snippet-gated, mig 398+).

**#9 Embed code SHIPPED (mig 397).** Per-league `embed_code` + public `get_club_league_public` +
chrome-free `/embed/league/<code>` widget (our fixtures+results, iframe-friendly). Venue "Put these
fixtures on your website" panel: ready-to-paste `<iframe>` snippet + an FA Full-Time snippet field
stored per league (`fa_embed_code`) for the club's own site. FA = display-only (spike NO-GO on a
feed; STRATEGY/DECISIONS s178). Live render Playwright-verified (`/embed/league/5b59146bb5`).

**#4 Coach paid/unpaid pill SHIPPED (mig 398).** Reminder cron already covers membership arrears
(`get_membership_reminders_due` `payment_due` kind — no change). New `club_manager_team_payments`
(authenticated, manager-scoped, read-only) powers a **Subs & payments** roster under "Message your
team" in the consumer club view — green Paid / red Owes £X pills, auto-reminders messaging. Demo
user manages First Team (2 owing + 3 paid → real mix). ⛔ owed authed/real-iPhone walk.

**#10 Venue OS nav + #11 modularity — SCOPED as the full Modular Platform nav epic (next session).**
Done fully (not half-IA): Phase 0 IA cleanup + Epic A flag engine (Phases 1–4), phase-by-phase.
Two flag tables (venue_features + club_features → resolves multi-venue clubs); club-scoped
memberships (resolves cross-venue memberships); default-all-on; tiers deferred. Full phased plan +
effort + feature-ownership model in **MODULAR_PLATFORM_HANDOFF.md** ("VENUE OS NAV — FULL PHASED
PLAN"). Demo-sprint items #8/#9/#4 SHIPPED (migs 394–398); FA AI-import (Phase C) snippet-gated.

### MODULAR PLATFORM — packaging + FA fixtures + public web + ref-as-module
Scoped session 174 (2026-06-22) off the GNP Sports FC target + Pitchero/MyClubPro review. Full plan
in **MODULAR_PLATFORM_HANDOFF.md**. **FOUR sequenced epics A→B→C→D**, each merged before the next.
**STATUS (s213):** Epic A flag foundation ✅ SHIPPED (Venue OS nav epic, migs 399–402 — incl. the
`public_web` flag B needs; only the package/preset presentation layer remains). **Epic B = NEXT, now
AUDITED + planned** (3-agent audit s213; 4 decisions locked + 5-phase build plan in the handoff;
Claude Design briefed for the public page + wizard + edit dashboard). Phases 1–3 (DB + RPCs, migs
444–446) are wireframe-independent and start next session. C depends on B's FA ingest; D is
independent (Event OS engine already built). The epics:
- **A — `club_features` modular toggles (FOUNDATION).** Per-club on/off gated at 3 layers
  (nav+route+RPC — fixes the audited "hidden-but-still-reachable" trap), dependency graph
  (Memberships→Payments etc.), package layer (presets over flags; tiers-vs-pick-and-mix deferred,
  it's just presentation). Extends the existing `multi_context_nav`/`get_team_feature_flags` pattern.
  Discipline × package = two orthogonal axes. Default all flags ON (additive, zero regression).
- **B — Public Web + league fixtures (provider model).** Lightweight branded club page + FA
  Full-Time fixtures/results/table via the FREE club-admin Season/Group-ID feed (option 2 — NO
  partner API, that's "Deferred" 4+ yrs). Build the cheap 80% only; don't become Pitchero. Real
  value = fixtures as a TRIGGER into auto-create-match → auto-open-availability (incumbents can't).
  `league_fixtures` as a pluggable provider (FA = adapter #1; cricket/hockey later).
- **C — FA-fixture → ref-assignment loop + RefSix-parity tools.** Ingested fixtures attach to the
  mig-369 official arm; ref companion in app/watch (NOT official write-back — honest boundary).
  **Ref = standalone module** (audited: league/official arm needs zero squad/club/membership; sells
  independently). RefSix decisions: GPS heatmap/sprint MATCH, video analysis BUILD, multi-watch
  DEFER (Apple-only); add sin-bins + auto match reports. Detail in [[project_watchos_companion]].
- **D — venue-operator tournament create.** Surface the ALREADY-BUILT Event OS engine (migs 314–328:
  round-robin/group→KO/single+double-elim/sports-day, registration, auto-schedule, live scoring,
  H2H standings, brackets, cards, sponsors/branding, public hub) in the VENUE dashboard via
  venue-token auth (today club-admin-only, in the consumer app). Auth + UI, not new engine. Gated by
  `tournaments` flag.
- **Competition model (cross-cutting):** internal (we own — League Mode + Event OS, full write) vs
  external (FA Full-Time — read-only mirror + match-day trigger). One "Competition" nav umbrella
  collapses Leagues+Table+Cups+tournaments; ⚠️ external must be read-only (no FA write-back) and
  never blended with internal standings.
- **Venue nav simplification** = a deliverable of Epic A (flag + discipline gating, 18→~8 items) +
  a small standalone IA merge pass (Sessions/Classes, Competition umbrella, People grouping).

### #2 Org/team structure — Phase 1: Structure (venue console) — SHIPPED (mig 389)
The club's org chart, editable in the venue console. **Migration 389** (additive):
- `club_cohorts.category` (youth|adult|mixed) — the explicit age-group type, drives a badge.
- `club_teams.gender` (girls|boys|mixed) + `priority_rank int` (1 = top side, ⭐) +
  `archived_at` (soft-archive).
- Six venue-token SECURITY DEFINER RPCs: new `club_create_team` / `club_update_team` /
  `club_list_teams` / `club_archive_team`; `club_create_cohort` + `club_update_cohort`
  extended with `p_category`; `club_list_cohorts` return shape gains `category`. All follow
  the `resolve_venue_caller` → `manage_memberships` cap pattern + audit_events insert.
- Venue UI: new **Structure** tab in MembershipsView — org-chart tree (club → age group →
  team) with create/edit age groups (type + optional ages) and teams (gender + ⭐ priority),
  helper text + a worked example on every input. Membership-plan form gained helper text too.
- Gates: rpc-security PASS (7 RPCs, all SECDEF/search_path/single-overload, anon+auth grant
  intentional, public REVOKEd), EV 11/11 + leak 0, build clean, no new hygiene violations.
  Venue app only → casual-regression not required. Demo `club_demo` cohorts/teams backfilled.
  ⛔ real-device venue walk owed.

### #2 Org/team structure — Phase 2: Team join link + QR — SHIPPED (mig 390)
Each club team gets its own join link + printable QR. **Migration 390** (additive):
- `invite_links` CHECKs widened: `entity_type` += `club_team`, `action` += `join_club_team`
  (a *distinct* action, not a reuse of casual `join_team` — keeps a club-team code out of
  the casual `/join` flow; dispatch in `InviteResolve` is keyed on `action`).
- `resolve_invite_link` gains a `club_team` branch returning club / cohort / team context
  (archived team → status `inactive`). `redeem_invite_link` gains a `club_team` scope branch
  (audit scope = venue, via `club_venues`) — wired now, fires post-join in Phase 3.
- New `club_ensure_team_invite_link(venue_token, team_id)` — get-or-create the one canonical
  code, club-domain ownership (`club_teams.club_id → club_venues.venue_id`); mirrors
  `venue_ensure_invite_link`. JS wrapper `clubEnsureTeamInviteLink` + barrel.
- Venue UI: each team row in the **Structure** screen gains a **"Join link / QR"** action →
  modal with a `react-qr-code` for `/q/<code>` + Copy / **Poster** / **Table-talker** (reuses
  `printAssets.js`). Consumer: `InviteResolve` shows a tidy resolved "joining <team>" screen
  for `join_club_team` (real membership-gated join = Phase 3, deliberately not the casual path).
- Deliberately NOT extended: the generic `venue_owns_entity` / QR-codes management panel —
  the Structure screen owns one canonical code per club team. Keeps the two QR surfaces apart.
- Gates: rpc-security 3/3 PASS (SECDEF / search_path pinned / single-overload / anon+auth
  grant intentional, public REVOKEd), EV 8/8 + leak 0, both builds clean, hygiene clean on
  in-scope files (venue MembershipsView carries only pre-existing GradingTab hex tech-debt).
  Playwright smoke on demo venue: Structure → team → QR modal mints code + resolves to
  club-team context, console clean. Venue app + additive consumer dispatch → casual-regression
  not required. ⛔ real-device venue walk owed (stacks on Phase 1).

### #2 Org/team structure — Phase 3: Membership-gated join — SHIPPED (mig 391)
A scanned club-team QR runs a new player through registration + payment, then lands them on
the team — gated on holding a club membership. **Migration 391** (additive, 2 RPCs):
- `club_team_join_context(p_code)` — anon+auth resolver: club-team code → team/cohort/club +
  the club venue's `venue_landing` code (drives the existing 360 wizard) + the signed-in
  caller's membership/on-team status for self + accepted children. Statuses incl.
  `signup_not_configured` when the venue has no active landing code.
- `member_join_club_team(p_code, p_for_profile_id)` — authenticated-only writer. Joins self
  or an accepted child; **server-side membership gate** (active/ending `venue_membership` at
  the team's venue, else `no_membership`); idempotent `club_team_members` insert + audit.
- Consumer: new `ClubTeamJoin` screen replaces the Phase 2 placeholder in `InviteResolve`
  (`/q/<code>`). Flow: resolve → sign in (reuses `AuthGateModal`) → membership check → if
  none, **reuse `MembershipSignup`** (register incl. child/guardian → pick tier
  `get_venue_signup_tiers` → pay Stripe **test mode**, live keys off) → land on the team →
  `redeem_invite_link` post-join. Already-a-member / already-registered children get a
  one-tap "Join". `MembershipSignup` gained additive `clubTeamCode` (Stripe return path) +
  `onEnrolled` props; `stripeInitMemberCheckout`/`api/stripe-member-checkout.js` gained an
  optional `returnCode`. Self-heals on re-scan (the gate sees the now-live membership), which
  also covers a Stripe payer who closes the tab before returning.
- Gates: rpc-security PASS (2 RPCs SECDEF/search_path/single-overload; context anon+auth,
  writer authenticated-only with anon explicitly REVOKEd), EV 12/12 + leak 0, build clean,
  hygiene 7/7 on every changed file, casual-regression PASS via additive-diff (no casual
  surface touched; new `MembershipSignup` props default null → VenueLanding byte-identical),
  Playwright smoke on demo club-team code (anon context renders, invalid code → not-found,
  no code-related console errors). ⛔ real-iPhone walk owed (member flow / apps/inorout/src;
  Hard Rule #13). Phase 5 (pro-rating) unbuilt.

### #2 Org/team structure — Phase 4: Team-manager comms — SHIPPED (mig 392)
A team manager can message their own team's players + guardians from the consumer app; the
club-wide broadcast stays the venue-admin tool. **Migration 392** (additive):
- `club_manager_send_announcement(p_team_id, p_title, p_body)` — authenticated, manager-of-team
  check (mirrors the mig-304 `club_manager_*` pattern: `auth.uid()→member_profiles→
  club_team_managers is_active`, else `not_manager`). **Reuses the comms spine, no parallel
  system:** inserts a queued `club_announcements` row (`audience='team'`, `created_by=auth.uid()`,
  `venue_id` derived from `club_venues`) so the existing cron (`get_pending_club_broadcasts` →
  `apps/inorout/api/cron.js`) delivers it and the existing member feed
  (`member_list_club_announcements`) surfaces it. Audit per Hard Rule #9; anon REVOKEd.
- `get_pending_club_broadcasts` team-audience recipients extended to also include **accepted
  guardians** (`member_guardians.invite_state='accepted'`) of the team's members — team
  messages now reach players AND guardians. Intended side effect: venue-admin team
  announcements also reach guardians (consistent).
- Consumer: `clubManagerSendAnnouncement` wrapper + barrel; **"Message your team"** composer in
  SessionsScreen (manager-only, per managed team, title+body, helper text + example,
  double-fire guard, success/error status).
- Gates: rpc-security 2/2 PASS (manager RPC authenticated-only; `get_pending_club_broadcasts`
  service_role-only), EV 10/10 + leak 0 (queued+team shape, audit row, recipients include
  member AND guardian but NOT manager, all 4 error paths), build clean, hygiene 7/7,
  casual-regression PASS via additive-diff (no casual surface touched; zero existing lines
  modified), Playwright smoke PASS (app boots, 0 console errors). ⛔ real-iPhone walk owed
  (manager composer / apps/inorout/src; Hard Rule #13).

### #2 Org/team structure — Phase 5: Pro-rating (club-configurable) — SHIPPED (mig 393) · EPIC COMPLETE
Late joiners pay only for the part of the season that's left, plus an optional one-off joining
fee — club-configurable per tier. **Migration 393** (additive only — existing tiers byte-identical):
- `venue_membership_tiers.proration_basis` (none|monthly|weekly|daily, DEFAULT 'none') +
  `joining_fee_pence` (int, DEFAULT 0). Applies to **season** tiers only; recurring (gym) plans
  bill their standard rate unchanged.
- `_prorated_first_charge(full_pence, basis, today, season_start, season_end)` — shared IMMUTABLE
  helper (single source of truth). Rule (operator-confirmed): count the join period as a **whole**
  (round up, member's favour); final pence to nearest; clamp [0, full]; join on/before season
  start or after season end → full price (never undercharge on bad data).
- First charge = `joining_fee + prorated(season_fee)` applied in `member_enrol_membership`
  (the live demo path) + `stripe_complete_member_enrolment` (fallback; prefers the Stripe-confirmed
  amount the checkout endpoint now sends) + surfaced as `first_charge_pence` on the season price row
  in `get_venue_signup_tiers` (so the checkout breakdown always matches what's charged). Renewals
  always charge the full price.
- Venue `venue_create/update_membership_tier` gain `p_proration_basis` + `p_joining_fee_pence`
  (8→10 / 10→12 args; old overloads DROPped). JS wrappers + barrel. Venue TierModal: proration
  basis selector + joining-fee input (season only) with helper text + worked example.
  `MembershipSignup` checkout breakdown (full season · joining mid-season − · joining fee + · you
  pay today). `api/stripe-member-checkout.js` prorates the one-off season `unit_amount` via the
  same SQL helper.
- **Two latent pre-393 bugs fixed in-cycle** (surfaced by EV): season self-enrolment wrote the
  tier's `pricing_model='season'` into `venue_memberships` which only allows recurring|term
  (now mapped season→term); and `get_venue_signup_tiers` raised "record not assigned yet" for a
  club-less venue-landing code (now scalar club vars).
- Gates: rpc-security 6/6 PASS (helper INVOKER pure-fn; SECDEF + search_path + single overload on
  the rest), EV 10/10 groups + leak 0 (each basis + mid-season date, season→term map, signup
  breakdown incl. NULL case, Stripe fallback + confirmed-amount, bad-period reject), additive-diff
  (production proration tiers = 0 → byte-identical), build clean, hygiene 7/7 on client files,
  casual-regression PASS via additive-diff (only MembershipSignup touched, original Total block
  preserved as else branch), Playwright boot smoke PASS. ⛔ real-iPhone walk owed (member checkout
  breakdown / apps/inorout/src; Hard Rule #13). **Next free mig = 394.**

## SESSION 173 — ADMIN QUICK-ACTION ON MY VIEW SHIPPED (migs 381; PRs #55, #56, LIVE on main)

**Admin marks a player + manages their guests from the My View board.** As an admin, tap
any *other* player's avatar (any section: In/Reserve/Maybe/Out/No Response) → a bottom sheet:
- **Set availability** — In/Out/Maybe/Reserve (`admin_set_player_status`). Now **soft
  everywhere** (mig 381): the player can always change it back. The player gets a push
  naming the admin ("Sam marked you in 👊").
- **Guests** — add **as many guests as needed** (sheet stays open after each), with a
  per-guest **"<host> pays / Guest pays"** toggle (`set_guest_payment` — records who pays
  and registers the guest fee in the ledger).

Self-avatar is excluded (admins use their own status buttons). For a non-admin / casual
player the board is **byte-identical** — the tap handler is gated on `isAdmin && adminToken`.
Browser-verified on the demo team (status sheet opens; 2 guests added + one toggled to
self-pay, DB-confirmed, test rows cleaned up). Build clean, hygiene 7/7, EV 4/4 + leak 0,
rpc-security PASS. ⛔ real-iPhone PWA push walk OWED (Hard Rule #13).

## SESSION 171 — UNIFIED LOGIN SHIPPED (one-account sign-in for admins AND players)

**Unified login** — one account sign-in for admins AND players, **LIVE on main / production**.
Before, the same person reached the app via three token-in-URL routes
(`/admin/<admin_token>`, `/p/<player_token>`, `/join/<code>`). Now: **sign in once → land
straight in your team** (admin powers on if you're an admin); a **"YOUR TEAMS"** chooser
appears only for people in multiple teams. **Old token links still work as a web fallback;
nobody is logged out by the change.**

Migrations **376–377** (next free mig = 378). Two new authenticated-only SECDEF RPCs:
`get_my_admin_teams()` (mig 376, read-only — every team the account is a verified admin of,
WITH its admin_token, so the landing opens the admin view without the secret `/admin/<token>`
URL) and `claim_team_admin(p_admin_token)` (mig 377 — auto-enrols a signed-in admin-link
holder as a real account-admin; idempotent; audited). Mig 377 also adds the partial unique
index `team_admins_team_user_active_uniq`. Admin identity **reuses the existing
`team_admins.user_id` table** — admin WRITE RPCs are unchanged (still authorise via
`p_admin_token`); the landing just bridges the token for verified admins.

Account landing changes ONLY the `squad_only` path; multi/parent/club_member home types are
unchanged. Non-admin routing is byte-identical (empty admin list → existing `/p/<token>` path).
Sign-in determinism hardened (AuthCallback clears stale resume breadcrumbs on a generic
sign-in). Apple "Hide My Email" safety net shipped (relay-email + no-team user sees a
"sign in the way you did before" screen, not Create/Join). Footy Tuesdays' four vice-captain
admins pre-enrolled (one-off backfill). Commits `28b71d9` / `31fb00d` / `22a15c2`
(reverted `5962813` then re-applied `46807eb`) / `57d563e` / `7a228a8`.

**Verified:** persona walk on a Footy-Tuesdays-shaped throwaway mirror (real logins, torn down,
leak 0) — single-squad admin+player → admin view; vice-captain-not-enrolled → player view then
auto-enrol on admin-link-open → admin view next login; plain player → player view; multi-team →
"YOUR TEAMS" chooser (admin row → /admin with MANAGER tag, player row → /p). EV for
`claim_team_admin` 7/7 + leak 0. Apple safety net: relay+no-team → safety screen, normal+no-team →
standard welcome. ⛔ OWED: native-app real-device walk of the launch/landing/auth path before the
next App Store build. See RPCS.md "Unified Login RPCs", DECISIONS.md s171, BUGS.md s171.

## SESSION 169 — Phase 0e (cross-app SSO + unified shell) SHIPPED, DARK

Unified Identity & Sync Spine **Phase 0e** — one sign-in + one switcher across the
separate apps. JS-only, **no migration** (`get_my_world()` mig 372 already returns
every role). Shared-cookie auth adapter (`cookieAuthStorage.js`) wired into the core
supabase client, gated by `VITE_AUTH_COOKIE_DOMAIN` (dark until set); cross-app
switcher deep-links (env-driven bases + venue operator + coaching rows); venue auth
parity (Apple + magic-link). Ships dark — operator flips on via DNS/Vercel/Supabase
+ env per `PHASE_0E_SSO_RUNBOOK.md`. OWED: domain attach + real-device cross-app walk.

Build order: 0a✅ 0b✅ 0c✅ 0d✅ 0e✅(dark, s169) → feature phases 1–5. The PA youth
pilot can still ship before the 0e domain-flip (its flow lives in apps/inorout).


*Last updated: Jun 23 2026 (session 188 — 🏁🏁 VENUE PEOPLE & SPACES IA **EPIC COMPLETE** — PHASE 5 SHIPPED (final, NO migration — venue app only). Drop Customers from the rail + consistency sweep. The standalone **"Customers" rail item is REMOVED** from `Dashboard.jsx` (TABS item + TITLES entry + render branch + the now-unused `CustomersView` default import); the `venue_customers` RECORDS STAY and remain reachable via the Phase-4 `ContactPicker` (verified live — the full directory lists in the Main/Secondary "Set…" picker) + the casual-bookings tab's CustomerDetailModal/NudgeModal. `CustomersView.jsx` stays as a file — TeamsView still imports its named `NudgeModal` export (untouched). NO deep-link alias for `customers` existed; SearchPalette/NotificationsPanel never targeted it → no dangling nav. CONSISTENCY SWEEP: **StaffView rebuilt** off the old chip-switcher + `.staff-grid` cards onto the shared IA pattern — `TabbedPage` (tabs "Venue staff & officials" + "Coaches & DBS", each with a plain-English `ViewSubhead`) + two `DataTable`s (Match officials, Venue staff: sortable Name, filter chips Active/Inactive, name/phone/email search, clickable rows → existing RefForm/StaffMemberForm, "Add" buttons retained). The "Coaches & DBS" tab reuses the Memberships `StaffTab` unchanged (just wrapped with a subhead). Memberships operational overlap (enrol/freeze/cancel/grade) DELIBERATELY LEFT on the Memberships screen — relocating it is on the epic's explicit OUT-OF-SCOPE list (a separate later tidy). Backend: NONE (no RPC, no supabase.js, no schema) → EV / rpc-security / casual-regression N/A; apps/inorout untouched. Gates: build venue clean, hygiene 7/7 on both changed files + hex hand-check clean (no hex literals), Playwright smoke PASS (Customers gone from rail; ContactPicker + Search reach customer records; Staff renders as two tables, tab-switch works, row→edit-form opens, 0 console errors — the 4 console messages are React-DevTools tip + realtime-subscribe info). Next free mig stays **412**. ⛔ owed manual venue deploy + real-device eyeball. The full IA epic (Phases 1–5) is now done: Rooms+Timetable combined pages, Teams page (3 tabs + DataTable), Members+Guardians, settable team contacts, Customers off the rail + Staff on tables — one learnable page-with-tabs+table+subhead model across the whole People & Spaces area. PRIOR — 🏁 VENUE PEOPLE & SPACES IA PHASE 4 SHIPPED (mig 411, settable team contacts — venue app only). Each team on the Teams page now has TWO settable contact slots, a **Main contact** + a **Secondary** column (+ a Has/No-contact filter) on BOTH the League teams and Club teams tabs, via a new `ContactPicker`. The pick source differs by team kind (operator decision): **league teams → the `venue_customers` directory** (search / pick / create inline — the league roster is on the casual side of the consent wall, so the contact is the booker/organiser); **club teams → that team's own active manager/assistant/coach** (`club_team_managers`, head-manager-first, role-labelled, no free text). Backend: ONE polymorphic link table `venue_team_contacts` (primary+secondary; contact_kind customer|member; UNIQUE per team+rank); ONE write `venue_set_team_main_contact(token,team_kind,team_id,contact_rank,contact_id?)` (gated manage_memberships OR manage_facility, audited, validates league-customer-in-venue / club-contact-is-team-staff, blocks same-person-both-slots); both team readers (`venue_list_active_teams` + `venue_list_club_teams`) extended ADDITIVELY with `main_contact`+`secondary_contact` (resolved by internal `_venue_team_contact_json`). To let a **guardian become a coach** (→ then a contact), `venue_assign_team_manager` was RELAXED to accept an active member OR a guardian of a member in the club, and the MembershipsView → Coaches & DBS assign dropdown now lists members + guardians (this also FIXED a latent bug: it keyed on `m.id`, which `venue_list_members` rows don't expose — only `member_profile_id`). Gates: rpc-security PASS (5 fns single-overload/SECDEF/search_path; helper REVOKED from anon/auth; venue writes anon+auth), EV 15-groups + leak 0 (league primary+secondary, club staff-only contact, guardian→coach assign, both readers reflect both slots+role, dup-rank/not-staff/not-enrolled/clear error paths), build venue clean + hygiene 7/7 on changed files (pre-existing `#3030FF` grading hex in MembershipsView untouched/out of scope), casual-regression PASS (packages/core additive-only +22/-0, apps/inorout untouched), Playwright smoke PASS (League both columns + set main+secondary + dup-guard friendly error + both render + filter; Club picker scoped to team coaches w/ role labels + no add-new-person + set renders; demo left byte-identical; the only 2 console errors are the intentional dup-rejection). ⛔ owed manual venue deploy + real-device eyeball (incl. the guardian→coach assign dropdown). NEXT = Phase 5 (drop Customers from the rail + consistency sweep — no migration). Plan VENUE_PEOPLE_IA_HANDOFF.md. PRIOR — 🏁 VENUE PEOPLE & SPACES IA PHASE 3 SHIPPED (mig 410, Members + Guardians page — venue app only). New "Members" People-group rail item → a read-only directory page (`MembersView`) with two tabs through `TabbedPage`: **Members** (every member, age/U18 flag, discipline, plan, status, inline guardian) and **Guardians** (each parent/guardian + the members they look after — derived client-side by inverting each member's `guardians[]`, de-duped by member profile). Both reuse the Phase-2 `DataTable` (search + filter chips) with a plain-English `ViewSubhead`. Operational membership management (enrol/freeze/cancel/grading) stays on the Memberships screen (Phase-5 consistency sweep removes the overlap). Backend: `venue_list_members` extended ADDITIVELY (mig 410) to embed `dob` + a `guardians[]` array from `member_guardians`; supabase.js wrapper UNCHANGED (pass-through) → no new wrapper, casual-regression N/A. Gates: rpc-security PASS (SECDEF, single overload, search_path pinned, anon+auth), build venue clean + hygiene 7/7 + hex hand-check clean, Playwright smoke PASS (Members 23 rows + U18 badges + inline guardians, Guardians view links + dedup, cross-field search filters, 0 new console errors). ⛔ owed manual venue deploy + real-device eyeball. NEXT = Phase 4 (settable main contact + people directory + contact picker — a write RPC, EV-gated). PRIOR — 🏁 VENUE PEOPLE & SPACES IA PHASE 2 SHIPPED (mig 409, Teams page — venue app only). One combined "Teams" rail item, three tabs through the Phase-1 `TabbedPage`: **League teams** (internal competition teams via `venue_list_active_teams`, "League" pill, full roster drill-down), **Casual bookings** (pitch bookers/walk-ins via the existing `venue_list_customers` — contact/bookings/spend/status; casual squads have NO roster behind the casual↔venue RLS wall, so it reuses CustomerDetailModal + NudgeModal), **Club teams** (NEW read `venue_list_club_teams` — every club team across the venue's clubs via `club_venues`, cohort + member_count; "Main contact" left as a Phase-4 placeholder column). Players folded in: standalone **Players rail item REMOVED** (legacy `players` deep-link aliased → Teams/League tab), `TeamDetail` roster redesigned stat-stack→TABLE, + a **page-level player search** (over `venue_list_players`). NEW shared **`DataTable`** primitive in PageKit.jsx (sortable headers, search, filter chips, empty/no-match, clickable rows) — first consumer, reused by all tabs + the roster. Each sub keeps its own flag+discipline gate (League=competition/football, Casual=bookings, Club teams=memberships). ONE new read RPC only (SECDEF, search_path pinned, single overload, anon+auth, no audit); NO schema change. Gates: rpc-security PASS, build venue clean + hygiene 7/7 + hex hand-check clean, casual-regression PASS (supabase.js/index.js additive-only, apps/inorout/src untouched), Playwright smoke PASS (3 tabs render, drill-down opens redesigned roster, player search filters, League badge shows, 0 console errors). NEW FOLLOW-UP LOGGED (operator product call): casual-team roster visibility for booking teams — the casual squad's players DO exist and could be surfaced for teams that book here, but it crosses the casual↔venue consent wall, so it's a deliberate later phase (consent model first), NOT folded into this IA work. NEXT = Phase 3 (Members + Guardians). ⛔ owed manual venue deploy + real-device eyeball. Plan VENUE_PEOPLE_IA_HANDOFF.md. PRIOR session 187 — 🏁 STRIPE FULL BUILD PHASE 6 SHIPPED (mig 408, collection/chasing/reporting — scope #16 pay-now links / #6.2 notification de-storm / #6.3 operator reconciliation). The #4 chase reminder now carries a "Pay now" button (Stripe hosted-invoice URL persisted on `venue_charges.pay_url` by `stripe_set_charge_pay_url` from `api/stripe-bulk-invoices.js` → else the venue's generic `payment_link`), and the member's in-app My-money pill gains the same button. De-storm: a Stripe-invoiced charge is suppressed from the cron `payment_due` reminder (Stripe dunns it) + a per-recipient per-tick throttle so nobody is double-emailed. Operator reconciliation: new read `venue_payment_reconciliation` → PaymentsView panel (raised/paid/overdue + collection rate + Stripe-vs-manual split). Additive — byte-identical until an operator acts. Gates: rpc-security PASS (4 fns), EV 5-grp+leak0, build inorout+venue+hygiene 7/7, casual-regression PASS, Playwright PaymentsView smoke PASS. ⛔ OWED (carried): Phase-3 invoice.paid reconcile on a real paying member through the deployed webhook on a connected account; real-iPhone walk of the Manage-card + Pay-now buttons. NEXT = Phase 7 (go-live: live keys + Connect onboarding verify + real-device payment walk — config only). Full plan STRIPE_FULL_BUILD_HANDOFF.md. PRIOR Phases 4+5 also shipped (migs 406/407: fixed-term/dated billing + lifecycle). PRIOR session 183 — 🏁 STRIPE FULL BUILD PHASE 3 SHIPPED (mig 405, mass invoicing — scope #6 wizard+remove-individuals / #7 Stripe Invoices for online one-offs / #8 billing-run record+void / #18 pro-rated mass invoicing). Operator can bill a cohort (a membership tier, a whole club, or a club team) a one-off charge in 4 taps: pick group → label+amount+due+pay-online → interactive preview (auto-skips paused/left/already-billed locked w/ reason, tick/untick cash payers, running total) → type-to-confirm → Send. Members are billed per active membership so the charge lands in each parent's "My money" (Phase 2) and the ledger goes green on payment. Pay-online emails each member a Stripe hosted invoice (TEST keys); a billing-run list shows collected vs billed with one-tap Void-run. NEW: `venue_billing_runs` table + `venue_charges.billing_run_id`; RPCs `venue_bulk_charge_preview`/`venue_bulk_charge_commit`/`venue_void_billing_run`/`venue_list_billing_runs` + service_role `stripe_record_charge_payment`; pro-rating reuses `_prorated_first_charge` (mig 393, ONE engine). API `/api/stripe-bulk-invoices.js` + `invoice.paid` one-off webhook branch. Gates: EV 8/8+leak0, rpc-security PASS, build inorout+venue+hygiene PASS, casual-regression N/A. ⛔ OWED: Playwright wizard smoke + Stripe test-mode invoice→paid walk. NEXT = Phase 4 (fixed-term & dated billing — Subscription Schedules, future start-date anchoring, mid-cycle proration; mig 406). Full plan STRIPE_FULL_BUILD_HANDOFF.md. PRIOR session 161 — WATCHOS COMPANION APP SCOPE-LOCKED + FULLY PLANNED (was logged-only s160): native SwiftUI watch target inside `apps/inorout/ios`, full ref mode on the wrist (league + casual-assigned-ref + club cohort) over the existing `ref_*` RPCs, identity-first resolver `get_my_next_assignment`, provider-agnostic watch auth (phone-handoff → email-OTP → Sign-in-with-Apple), HealthKit refs-only auto-start/stop Outdoor-Football workout + watchOS-27 HR zones stored back in-app, Live Activity/Dynamic Island + complication/Smart-Stack committed to v1. Phases 0–7, migrations from 369, MVP ~1–2 wks / full ~2–4 wks after iOS approval. Full plan in `~/.claude/plans/once-the-ios-app-dapper-marshmallow.md` + `WATCH_DESIGN_BRIEF.md` + DECISIONS s161. See the "## WATCHOS COMPANION APP" section below. PRIOR s160 — WATCHOS COMPANION APP logged as a future/parked epic (ref view on the wrist + a lightweight football-specific workout tracker, metrics TBD) — see the "## WATCHOS COMPANION APP" section below; it comes AFTER the App Store epic ships (Apple approval first). Also: GOOGLE PLAY submission PARKED until after Apple App Store approval (operator decision s160) — the wrap stays cross-platform in code, but all Play-console work (0.4 enrolment, 3.2 Firebase, Android keystore/SHA-256, Play graphics, IARC, .aab) is deferred behind the iOS launch; see APP_STORE_CHECKLIST.md + DECISIONS.md s160. PRIOR: session 152 — DEEP DEMO DATA + CROSS-ROLE DEMO SIGN-IN USERS SEEDED (migs 363–364). Every new feature surface was empty (0 classes/spaces/PT/grading/bouts); now all populated on `demo_venue` + two NEW combat clubs `club_demo_box` (boxing→fight records/sparring) + `club_demo_ma` (martial_arts→belts/grading). Mig 363: 4 spaces, 4 class types (incl. an open/free mixed-age Junior Boxing + a sparring session), 7 sessions (past/today/upcoming), 19 bookings in every state, 2 packages + balances, 2 room hires, 2 PT trainers + availability + 4 appointments, belt ladders + award history, 14 fight records, + `venue_charges` so Payments/HQ show revenue — existing demo members reused (Leo = junior age 13). Mig 364: TWO real email/password sign-in users covering EVERY auth-based user type — **Alex Demo `demo@in-or-out.com`/`DemoBoss1!`** (platform superadmin + HQ super_admin + venue owner + squad admin + casual+competitive player + member of BOTH combat clubs → fight record AND grading via multi-context) and **Sam Carter `family@in-or-out.com`/`DemoFam2!`** (plain paused member + GUARDIAN of junior Charlie + venue staff w/ booking caps only + plain player). FIRST SQL-seeded `auth.users`+`auth.identities` in the repo (mirrors live schema: all-zeros instance_id, bcrypt pgcrypto, empty-string GoTrue token cols). VERIFIED: GoTrue password grant 200+token for both (wrong-pw rejected), all resolver RPCs resolve every role, venue UI password sign-in → owner dashboard, seeded classes render live (0 console errors). ⚠️ Consumer app (inorout) is OTP/Google-only (NO password) → these passwords work on venue/HQ UI directly; consumer-app login needs the OTP emailed to the address (repoint emails to a real inbox if needed). Credentials + coverage + teardown in repo `DEMO_USERS.md`. Mig 365 repointed the two users to `tarny+demo@`/`tarny+family@lettrack.co.uk` (Google Workspace +aliases → one inbox) so consumer-app email-OTP sign-in works (same UUIDs, all links intact; password + OTP-request both re-verified 200, old email now 400). Next free mig = 366. PRIOR: session 151 — AGE-BANDED CLASS SESSION ROSTER SHIPPED (mig 362): edge case for the gym/boxing vertical — a club training session is ONE open class session any member books, and coaches split the room by age + rotate stations on the day. The operator roster (`venue_get_class_session_detail` → ClassesView SessionDetailModal) showed names but no ages. Additive return-shape change ONLY: each attendee object gains `dob` (date) + `age` (int years, NULL if no dob), and attendees re-order `status, dob DESC NULLS LAST` (youngest-first within status) so coaches read the roster top-down by age. NO new tables/columns/RPCs, NO booking-path/grant change — body otherwise byte-identical to the mig-360 live version. Wrapper `venueGetClassSessionDetail` is a pure passthrough (Hard Rule #12 trivially satisfied, no mapper); sole consumer ClassesView renders an "Age N" pill. rpc-security PASS (SECDEF/search_path/single-overload/grants intact), hygiene 7/7, venue build clean, age expr verified live. EV/casual-regression N/A (read RPC, no apps/inorout, no write path). Deliberately did NOT build fixed age-band buckets or per-session group/station tagging — operator product call, build only if coaches ask (safeguarding ratios / attendance register would drive it). Owed: operator browser pass on the Age pill. Next free mig = 363. PRIOR: session 150 — DOMAIN MIGRATION COMPLETE: consumer app live on `app.in-or-out.com` (Vercel `platform-clubmanager`), apex `in-or-out.com`+`www` flipped to the `marketing` project with a catch-all 301 forwarding all token paths → `app.`, 7 pg_cron jobs + `notify_spot_opened`/`get_display_landing_code` repointed to `app.` + `CRON_SECRET` rotated (mig 361), Supabase Auth on `app.` + sign-in proven on a real iPhone. Found+fixed a sign-in routing gap (signed-in squad-only users fell through to the create screen → now route to their squad / a "Your squads" chooser; new `/signin` route + welcome "Sign in" entry). NATIVE APP WRAP roadmap parked in `APP_WRAP_HANDOFF.md` (Capacitor, consumer-app-only, load URL `https://app.in-or-out.com`; the ~20 owed real-device walks consolidated there as the wrap QA pass). NO new bugs; 1 cosmetic tech-debt logged (welcome-screen styling off-brand). Next free mig = 362. PRIOR: session 149 — CLASSES OPEN/FREE/TRIAL ACCESS SHIPPED (mig 360): the gym PT booking's two levers brought to classes. New `venue_class_types.members_only` flag (additive boolean NOT NULL DEFAULT true → every existing class byte-identical). An ACCOUNT (auth.uid→member_profiles) is ALWAYS required; a paid MEMBERSHIP is required only when the type is members_only. members_only=false + price 0 = free open/trial class; +price>0 = paid drop-in (door now; Stripe prepay dormant). ONE gate RPC changed — `member_book_class_session` (the membership EXISTS check wrapped in `IF COALESCE(members_only,true)`); class PACKS stay member-only (`member_purchase_class_package` UNCHANGED — operator s149); `member_claim_waitlist_spot` has no membership gate so UNCHANGED. Flag plumbed through `venue_create_class_type` (new 11th arg `p_members_only`, old 10-arg overload DROPped + re-granted), `venue_update_class_type` (jsonb patch), `venue_list_class_types` + `member_list_class_sessions` (return shape). Operator: "Members only" toggle on the class-type editor (ClassesView) + "Open" pill. Member: ClassesTimetable shows "Open to all"/Free. EV 5/5 + leak 0 (non-member books open-paid→£10 door charge; books open-free→no charge/waived; rejected on member-only [membership_required]; member books member-only; column default true), rpc-security PASS (5 RPCs single-overload/SECDEF/search_path/grants), casual-regression PASS (additive-diff — no casual surface touched), build inorout+venue + hygiene 7/7 + boot smoke clean. ⛔ real-iPhone PWA walk OWED (non-member books an open class). Next free mig = 361. PRIOR: session 148 — GYM/BOXING VERTICAL Phase 4 SHIPPED (mig 359): bout / fight record + sparring stats — **THE VERTICAL IS COMPLETE (Phases 0–4).** ONE RLS-walled table `member_bouts` (member_profile_id + club_id, result win|loss|draw|no_contest, method/rounds/event/opponent, `is_sparring`, `voided` SOFT-DELETE; W-L-D-NC derived over non-voided non-sparring rows, sparring surfaced separately as `sparring_count`) keyed on member_profile_id NOT football's player_match. DORMANT realisation of the documented `player_match.sport_stats`/`matches.sport_stats jsonb` pattern (additive-NULLABLE, 0 pg_proc refs → football cascade byte-unchanged). FIVE RPCs (writes gated `manage_facility` + audited): `venue_record_bout` / `venue_update_bout` / `venue_delete_bout` (soft-void) + reads `venue_list_member_bouts` (operator, incl voided) / `member_get_fight_record` (member via pass_token, excludes voided). Operator: per-member **Fight record** modal in MembershipsView (list + record/void/restore; `FIGHT_RECORD_DISCIPLINES=['boxing']`). Member: **Fight record** section on MemberProfile (W-L-D-NC + sparring count + bout list), gated on `disciplineLabels.hasFightRecord` (boxing only → casual football byte-identical). Decisions (operator, three recommended defaults confirmed): manage_facility authority, member+staff visibility boxing-only, soft-void + is_sparring flag — see DECISIONS s148. EV 10/10 + leak 0 (caught + fixed a sparring/headline consistency gap pre-commit, folded as 359b), rpc-security PASS (5 RPCs), casual-regression PASS (additive-diff + Playwright boot smoke 0 app errors), build inorout+venue + hygiene clean; real-iPhone PWA walk OWED. Next free mig = 360. OPT-IN follow-up (classes free/trial `members_only`+price-0 levers) — operator opted in s148, PLANNED for next session as mig 360; full scope + next-session prompt in CLASSES_OPEN_ACCESS_HANDOFF.md (flag on venue_class_types; modify the 3 membership-gate RPCs). | session 147 — GYM/BOXING VERTICAL Phase 3 SHIPPED (mig 358): PT / 1-on-1 appointment booking. THREE RLS-walled tables — `venue_trainers` (bookable resource; `admin_id` NULLABLE = optional staff login OR no-login coach card; price_pence, default_session_minutes, cancel_cutoff_hours, members_only, active), `venue_trainer_availability` (recurring weekly windows sliced into bookable slots), `venue_appointments` (the booking; partial-unique `(trainer_id, starts_at) WHERE status<>'cancelled'` = one live booking per slot). ELEVEN RPCs — operator (gated `manage_facility`, audited): `venue_upsert_trainer` / `venue_set_trainer_availability` / `venue_list_trainers` / `venue_list_appointments` / `venue_pt_checkin` (clone of venue_class_checkin) / `venue_mark_appointment_completed` (no-show bumps no_show_count + keeps charge); member (auth.uid, authenticated-only): `member_list_trainers` / `member_list_trainer_slots` (availability minus booked) / `member_book_appointment` (writes venue_charges source_type='pt', door) / `member_cancel_appointment` / `member_list_my_appointments`. DEDICATED appointments model (NOT capacity=1 classes). TWO LEVERS decide who can book: an ACCOUNT is always required; per-trainer `members_only` adds the active-membership requirement — `members_only=false` + price 0 = a free open session (operator "A, but B for trials/one-offs"). Operator: new **TrainersView** (Trainers + Appointments tabs; ClassCheckinScanner generalised with an optional `checkin` cb). Member: new **/book** route + BookPT view + ClubNavBar **Train** tab, gated on `disciplineLabels.hasPT` (gym/boxing/martial_arts/fitness → casual football byte-identical). Money on the shared venue_charges ledger (settlement DORMANT until live keys); `venue_charges_source_type_check` extended to allow 'pt' (mig 358b). Decisions — see DECISIONS s147. EV 9/9 + leak 0 (caught the 'pt' constraint gap pre-commit), rpc-security PASS (11 RPCs), casual-regression PASS (additive-diff + Playwright /book boot smoke), build inorout+venue + hygiene clean; real-iPhone PWA walk OWED. Next free mig = 359. Phase 4 (fight record) is the last phase, planned in GYM_VERTICAL_HANDOFF.md. | session 146 — GYM/BOXING VERTICAL Phase 2 SHIPPED (mig 357): grading / belt progression. THREE RLS-walled tables — `venue_grading_schemes` (per-club ladders; `age_band` juniors/adults/all → kids and adults are separate schemes, matching real BJJ/TKD systems), `venue_grades` (ordered named grades + `colour_hex` + `max_stripes`; half/tag belts = extra rows), `member_grades` (APPEND-ONLY award log; "current = latest per member+scheme"; monotonic `awarded_seq` tie-break). FIVE RPCs (writes gated `manage_facility` + audited): `venue_create_grading_scheme` / `venue_add_grade` / `venue_award_grade` (caps stripes at grade max, returns `at_max` to suggest promotion) + reads `venue_list_grading_schemes` / `member_get_grade_history`; `get_member_pass` extended with current `grades[]`, `venue_list_members` extended with club_id+discipline. Operator: new **Grading** sub-tab in MembershipsView (per-club scheme + grade setup, gated to martial-arts clubs) + **Award grade** action on member cards. Member: rank chip on MemberPass + Progression history on MemberProfile, gated on `disciplineLabels.hasGrading` (martial_arts only → casual football byte-identical). Decisions (operator): award authority = existing manage_facility cap (1A); ladder = named+coloured+stripes, age bands = separate schemes (2B + research) — see DECISIONS s146. EV 11/11 + leak 0 (caught the awarded_seq tie-break bug pre-commit), rpc-security PASS (6 RPCs), casual-regression PASS (additive-diff + Playwright boot smoke), build inorout+venue + hygiene clean; real-iPhone PWA walk OWED. Next free mig = 358. Phases 3–4 (PT booking / fight record) remain planned in GYM_VERTICAL_HANDOFF.md. | session 145 — GYM/BOXING VERTICAL Phase 1 SHIPPED (mig 356): sparring / open-mat availability — `venue_class_types.is_sparring` flag (a class type is EITHER technical OR sparring; operator picks at create), threaded through `venue_create_class_type` (signature change: old 9-arg DROPped + re-granted) / `venue_update_class_type` (jsonb patch) / `venue_list_class_types` + `member_list_class_sessions` (badges) + `discipline` added to `get_member_pass`. NO new write RPC — booking reuses the class-session model wholesale (capacity/waitlist/QR check-in/no-show). Operator toggle in `ClassesView` (create + edit, types-table "Sparring" pill); member surface = new `/classes` route → new `ClassesScreen` (club + venue picker) rendering the reused `ClassesTimetable` (sparring-badged), lighting the dormant `ClubNavBar` Classes tab for non-football disciplines only (football byte-identical → casual untouched). EV 5/5 + leak 0, rpc-security PASS both write RPCs, casual-regression PASS (additive-diff proof), build inorout+venue + hygiene clean, Playwright `/classes` boot smoke 0 console errors; real-iPhone PWA walk OWED. Next free mig = 357. Phases 2–4 (grading / PT / fight record) remain planned in GYM_VERTICAL_HANDOFF.md. | session 144 — GYM/BOXING VERTICAL Phase 0 SHIPPED (mig 355): club `discipline` identity — `clubs.discipline` (text+CHECK 8-value pick-list, default football, zero footprint on casual); `member_get_self`/`venue_list_clubs` surface it; new gated+audited `venue_set_club_discipline` write RPC + `venueSetClubDiscipline` wrapper; member-app vocabulary map `apps/inorout/src/lib/disciplineLabels.js` (boxing=fight-record not grades; grades=martial_arts) threaded `deriveClubContext`→`ClubNavBar`. Operator chose discipline-as-pick-list over a generic config engine (DECISIONS s144). EV 7/7 + leak 0, rpc-security PASS, casual-regression PASS, build+hygiene clean; real-iPhone PWA walk OWED. Next free mig = 356. Phases 1–4 remain planned in GYM_VERTICAL_HANDOFF.md. | session 143 — CLUB/MEMBERSHIP SYSTEM AUDIT + 3 FIXES + GYM/BOXING VERTICAL PLANNED. Full end-to-end audit of the club/membership/"multi-sport" system (all wired live; multi-sport is dormant scaffolding) → fixed BST recurring-session timezone (mig 353), multi-club nav residual club[0] (PR #14), MemberPass club context (mig 354). NEXT EPIC — Gym / Boxing Club vertical: a `club_membership` context, NOT a new app/theme; ~80% already built (Classes/Membership V2/Payments/Equipment/QR/packages/waivers); 5 phases plan the missing 20% (P0 discipline label + P1 sparring + P2 grading + P3 PT 1-on-1 + P4 fight record). DORMANT until post-pilot per STRATEGY.md. Full build plan: **GYM_VERTICAL_HANDOFF.md**. Next free mig = 355. | session 142 — MULTI-CONTEXT NAV Phase 1 cleanup + Phase 2 guided tours MERGED to main (PR #10 + #11). Phase 1 cleanup: MemberPass shows the club nav bar for the pass owner (Pass tab no longer strands) + new `lib/lastContext.js` structured all-context resume (preferred over the squad-only breadcrumb so multi-context members reopen where they were). Phase 2: revived FirstTimeHint into a spotlight guided-tour engine (`components/Tour.jsx` + `lib/tourRegistry.js` + `components/TourProvider.jsx`) — dim+glow-ring spotlight, poll-until-mounted with graceful skip, scroll/resize realign, reduced-motion, auto-advance-on-tap (off for admin tiles), Skip/Next/counter, seen-on-show, suppressed while any [data-tour-suppress] overlay open. Tours keyed per (context type, screen): casual/comp myview+stats, admin dash, club sessions/classes/pass/profile, guardian home, switcher. Ships DARK — squad tours behind `teams.multi_context_nav`, club/guardian behind `localStorage.ioo_tours_preview` (default off). localStorage-only → NO migration. Verified build clean + hygiene 7/7 + Playwright engine end-to-end + flag-OFF zero change on casual flow. OWED: real-iPhone PWA walk. | session 89 — REF V2 + LEAGUE VENUE SCREENS CONFIRMED COMPLETE & DEPLOYED. Audited both against live code/DB + redeployed: (1) Ref V2 is ✅ COMPLETE — backend migs 261–267 ALL applied to prod (incl. 266 get_display_state pause/added-time passthrough + 267 update_league_config, which an earlier FEATURES note wrongly listed as "remaining"), frontend broadcast-dark port live on platform-ref.vercel.app (deployed s88 commit 3dd7a5c, re-verified s89 — bundle carries Supabase URL + ref_set_clock/ref_record_sin_bin/ref_set_added_time); only real-iPhone PWA walk owed. (2) League venue screens (standings/rosters/players/teams/fixtures/cups) ✅ wired to live read RPCs (migs 196–198) + skinned + redeployed to platform-venue.vercel.app (bundle env-baked verified); only a logged-in browser pass owed. DEPLOY GOTCHA fixed: platform-ref had Vercel Root Directory=apps/ref → prebuilt path doubled; cleared the setting to null via API so it matches platform-venue (GO_LIVE #14.2). Also a BUGS.md stale-note sweep this session: 4 "open/owed" entries verified already-fixed and closed (guest double-charge guard since mig 206; paid-flag-wipe fixed mig 241/268; admin_upsert_schedule one-off cast fixed mig 215; superadmin blank screen resolved GO_LIVE #13), 1 real fix (SquadScreen duplicate minWidth key removed), genuine open tech-debt left = pg_cron secret hardcoded. Net-new remaining = Phase 7 AI · Phase 10 public pages · HQ-I Phase 3. | session 81 — LIVE POTM TALLY SHIPPED (Part 2, mig 242 get_potm_tally_public): players see the running vote tally but ONLY after they've voted — server-gated ({voted:false} until you have a potm_votes row) + counts-only (never voter identities, deliberately not widening the get_potm_voting_state voter_id+nominee_id leak). POTMVotingModal voted-state shows a winner-first leaderboard (count + proportional bar, "YOUR VOTE" chip), live-refreshed on the team_live broadcast; auto-dismiss removed so the player lingers on the live board. OPERATOR DECISION: tally at vote-time only — NO reopen path (discovered there's no banner/button to reopen the modal once voted/dismissed; setShowPOTMModal(true) fires only on the suppressed-once-voted auto-open). OWED: real-iPhone test (Hard Rule #13). Also this session: payment labels "Paid Cash"→"Paid" (UI-only, 2736c1a/c6c2415). session 80 — POST-GAME LIFECYCLE HARDENING + LIVE FIREFIGHT (mig 241): result-save now closes the game (game_is_live=false) so a played match stops accepting sign-ups, resets ALL statuses incl reserves, and preserves paid for already-paid players; set_player_status gains a server-side sign-up-window gate (game_not_live); PlayerView shows a "sign-ups open <day> at <time>" note. Also fixed live: the paid button (debt-state Confirm unreachable, 888be3a), the POTM modal re-popping every app open (888be3a), payment ledger/flat reconciliation; POTM voting window 1h→2h (b5439af). EV 8/8 + leak 0, rpc-security PASS. OWED: real-iPhone test (Hard Rule #13). session 79 — SUPERADMIN OPERATOR-ANALYTICS SUITE + OPS EMAIL DIGEST SHIPPED (migs 234–240*, ⚠ migration numbers 236–240 COLLIDE with the parallel session-78 venue work — live DB fine, clash noted not renumbered, next free number is 241; see CONTEXT SESSION 79). Ops EMAIL digest (mig 234 get_ops_usage_digest): daily Tue–Sun + weekly Mon 08:00 UK "is the casual app being used?" emails via existing Resend mailer + api/cron.js (OPS_DIGEST_EMAIL, defaults to operator; ?ops_force=1 re-sends) — real squads only, squads/players/activity/wk-on-wk/dormancy/new-and-quiet alert; Resend confirmed live. Superadmin dashboard (apps/superadmin) 3 new tabs: ENGAGEMENT (mig 235) per-squad×per-feature-category + AI-vs-manual teams + admin/player opens; HEALTH (mig 236*) activation funnel + notification REACH (real delivery path only, notification_channel preference ignored) + install/sign-in + response/ghost rate; CREATE SQUAD (mig 239* superadmin_create_team — casual twin of Create Venue, makes the squad SHELL + admin_token hand-off link, no members, EV'd). Plus: Team Detail recent-events period+type filters & plain-English labels (mig 237*, eventLabels.js, events cap 20→200); Teams-list Activation column + new-and-quiet flag (mig 238*); Team Detail Share-links panel; account-claim on sign-in (mig 240* claim_my_admin_teams — organiser signs into casual app with the admin_email → unclaimed shell auto-adopted into My Squads; verified-email, only-unclaimed, idempotent, EV'd; PWA real-iPhone test OWED). BUG FIXED: ops analytics counted players off players.team (A/B matchday side) not team_players (membership) — mig 234. PROD BUG FIXED: apps/superadmin blank screen since first deploy (prebuilt build env-less) — GO_LIVE #13. Deferred: screen-VIEW instrumentation (audit_events logs writes not views). session 78 — venue Requests inbox CONFIRM made series-aware SHIPPED (mig 236): decline already cancelled a whole weekly block atomically (cancel_booking_series), but confirm looped venue_confirm_booking over only the today..+90d occupancy window — so a block >~12 weeks (series allow up to 52) was confirmed partially, leaving later weeks stuck 'requested' (slot held, no charge, team never told). New venue_confirm_booking_series(token, series_id) confirms every still-requested booking + raises a charge per booking in one transaction; inbox routes g.seriesId → it, else the single-id call — symmetric with decline. EV 7/7 (15-wk series incl. weeks past +90d; no dup charges; invalid-token/wrong-venue/double-tap rejected) + leak 0, rpc-security PASS, venue build clean, deployed + eyeballed. Commit 871520f. NEXT: venue per-user login credentials (staff logins) — backlog item below. session 77 — venue SCHEDULE GRID overhaul + FILTERS SHIPPED (frontend + mig 233): blocks un-squashed (60px/hr); colour now = PAYMENT (green paid/nothing-owed, amber owed; pending = dashed outline) with a TYPE word tag (One-off/Block/League/Maintenance) + a NEW badge for first-time customers — driven by mig 233 adding `owed`+`is_first` to get_pitch_occupancy (helper `_venue_source_owed`). Grid scales to many pitches (sticky time-axis + internal horizontal scroll; root-caused a min-width:auto page-overflow). Quick-access FILTERS (CalendarFilters.jsx, all client-side): name search, Paid/Owed, type chips, Pending, New, pitch show/hide, and Free-slots; a content filter COLLAPSES the calendar to just the matching slots (occBounds), and Free-slots is an availability view (strips bookings, shows tappable "Available" gaps via freeGaps). All eyeballed in-browser. Operator still owes the logged-in venue pass on the booking/incident write flows. ALSO: IP+device audit enrichment PARKED (on hold, backend-only — agreed shape in FEATURES backlog); venue per-user login credentials logged as a backlog feature (DECISIONS). venue New-booking rework SHIPPED (mig 232, 3 slices): the Add-booking modal now does (1) Existing customer [Team / Person dropdowns, alphabetical] vs New customer [name] — renames Registered-team/Walk-in; (2) Single vs Block [weekly, N-week] booking — block is team-only via venue_create_booking_series, person/new-customer block DEFERRED (needs booking_series booker-agnostic + renewal-cron guard); (3) UK date picker + availability-driven Time dropdown (getPitchFreeSlots/_series — only free start-times offered; block = free across all weeks); (4) email + phone REQUIRED on every booking (contact cols on pitch_bookings), with a booking_confirmation email (Resend) + SMS-ready (_sms, no-op until Twilio) sent to the customer via a new cron job. EV 15/15 + leak 0, rpc-security 2/2 PASS, venue+casual builds clean. Operator owes a logged-in venue pass (create a booking end-to-end) + a real email delivery eyeball once RESEND is live. venue incident lifecycle SHIPPED (mig 231): the Operations "Open issues" panel now lets a venue admin REPORT an incident (Report-incident button + modal → venue_log_incident) and RESOLVE one (per-row Resolve → venue_resolve_incident), closing the gap where incidents were create-by-seed-only + resolve-by-HQ-only. incidents.reported_by made nullable (venue admins are token callers, no auth.uid()); notify_venue_change whitelist already carried both reasons. EV 12/12 + leak 0, rpc-security 2/2 PASS, venue build clean. Operator owes a logged-in venue pass: log an incident, resolve it. session 76 — reliable server-side "spot opened" reserve notification SHIPPED (mig 230, PR #6): a players status/disabled trigger alerts the next reserve to claim on ANY spot-freeing event (out/admin-out/disable/injury), replacing the fragile client-only push; tap-to-claim unchanged (no auto-promotion); weekly-reset spam guarded via an inorout.bulk_reset GUC in the go-live RPCs. session 75 — venue dashboard wiring audit + fixes SHIPPED (PR #3/#5, merged): Operations Outstanding stat (mig 227), casual weekly-block availability across all N weeks (mig 228) + day/start-date pickers, Payments undo-payment + edit-amount-owed (mig 229), and league fixture score-correction (Edit score). session 74 — Venue dashboard v2 re-skin shipped (PR #3, all 9 screens, dark operator console). Phase B venue-domain-only: Cancellations log + policy refund (mig 222), Customers booker-directory (mig 223, recency-based status), and Nudge (mig 224 — venue_request_nudge records the ask, cron resolves the team-admin contact + sends server-side via the venue_nudge mailer template; venue never sees the contact; email live, SMS/WhatsApp await Twilio keys) all SHIPPED. Live "ins" SHIPPED (mig 225, operator opted into the cross-domain read): venues see live N/target players IN per upcoming team booking (target = schedule.squad_size); a players.status trigger broadcasts booking_ins_changed on the venue channel so it updates the instant a player taps in/out (counts only — no casual identities cross). Deferred: customer detail modal.)*

---

## WATCHOS COMPANION APP — REF MODE ON THE WRIST + HEALTHKIT (PLANNED + SCOPE-LOCKED, session 161)

**Status: 🟢 PHASE 1 + PHASE 4 BACKEND SHIPPED (s162 mig 369; s168 mig 375) — native phases 🟡 PLANNED (App-Store-gated).** Operator s162: build
everything that doesn't need an approved App Store listing, ahead of approval. Phase 1 (identity
layer) + Phase 4 (health storage + casual ref toggle) are pure additive backend/web with no device dependency, so they landed early.
Full phased plan: `~/.claude/plans/once-the-ios-app-dapper-marshmallow.md`. Design brief:
`WATCH_DESIGN_BRIEF.md` → **✅ design handoff DONE `WATCH_DESIGN_HANDOFF.md`** (s162, commit `17674e7`:
all screens + tokens + SwiftUI stubs + interaction/haptic map + complication/Live Activity + a11y;
Bebas→SF-Compressed for watch legibility; 5 engineer open-questions). Locked decisions: DECISIONS.md s161.
**NEXT non-gated cycle** (operator s162): Phase 4 health-storage backend (`match_health_sessions` +
`save_match_health_summary` + delete-account cascade + fitness surfacing) **+** the casual ref-assignment
admin toggle in inorout (wires `assignCasualMatchRef`). Migrations from **370**. Paste-ready next-session
prompt at the top of the plan file.

**✅ Phase 1 — identity layer (mig 369, s162).** Two identity arms, one resolver. SCHEMA: `match_officials.user_id`,
`club_cohorts.primary_official_id`, `matches.ref_player_id`+`ref_token` (additive/nullable). 5 SECDEF RPCs:
`get_my_next_assignment` (resolver, LOCKED shape, authenticated-only) + `ref_link_self_to_official` (email
self-claim, authed-only) + `venue_link_official_to_user` (operator-bind) + `assign_casual_match_ref` (per-game
casual ref slot) + `club_admin_assign_cohort_official` (default-official binding). JS wrappers + barrel added (unused
in inorout yet — additive-diff). **Verified:** rpc-security PASS (anon revoked on the 2 account-scoped fns),
ephemeral-verify 9/9 groups + leak 0 (incl. in-progress precedence + role filters + 6 error paths), inorout build
clean, casual-regression PASS (additive-diff, 0 deletions). KEY DESIGN: casual ≠ league — casual reuses the
existing `players.user_id` claim (no new claim RPC); club-cohort officiating folds into the fixture arm (cohort =
default-official convenience; `club_sessions` refereeing stays Phase 6). Next free mig = **370**.

**✅ Phase 4 — health-summary storage + casual ref toggle (mig 375, s168).** Backend + web, no device dependency.
SCHEMA: new RLS-walled `match_health_sessions` (summary only — duration/energy/distance/avg+max HR/HR-zones jsonb;
`UNIQUE(user_id, client_session_id)` offline-idempotency key; user_id → auth.users ON DELETE CASCADE). 2 SECDEF
authenticated-only RPCs: `save_match_health_summary` (idempotent upsert, the watch posts on Full Time; audit + team
derive) + `get_my_match_health` (read-back; empty for unauthenticated → surface self-hides). **GDPR cascade (same
mig, mandatory):** both `delete_my_account` + `delete_my_account_auth` purge the table (DECISIONS.md s161 #6).
**(B) casual ref toggle wired:** `dbToMatch` now maps `refPlayerId`; new `RefAssignCard` in `AdminView/TeamsScreen`
(squad-member picker → existing `assignCasualMatchRef`, mig-369 RPC — NO new backend); self-hiding "Your match
fitness" section in `MyIOView`. **Verified:** rpc-security PASS (2 new RPCs anon-revoked/SECDEF/search_path/single-
overload; delete RPCs posture unchanged), EV 9/9 + leak 0 (incl. idempotent upsert, casual team-derive, league-uuid
fallback, bad-context reject, **GDPR-cascade purge**), hygiene 7/7, build clean, casual-regression additive-diff PASS
+ Playwright authed walk on team_demo (RefAssignCard renders; populated + empty MatchFitness both proven; new RPC
200 authed; 0 console errors from changed files). ⛔ **OWED: real-iPhone PWA walk** (MyIO fitness + admin ref toggle).
Next free mig = **376**. Native phases 0/2/3/5/6/7 remain App-Store-gated (Mac + paired Apple Watch).

**What it is:** a native **SwiftUI watchOS** app — the only native code in the repo — added as a
target inside the existing Capacitor iOS Xcode project (`apps/inorout/ios`). The iPhone app stays
the untouched webview wrap; **one App Store record**, watch runs independently (watchOS 10+). It
signs the user in, auto-resolves their **next relevant game**, runs the **full referee experience**
on the wrist (driven by the existing `ref_*` RPCs + realtime broadcast), and — for whoever is the
ref — **auto-tracks an Apple "Outdoor Football" workout** (HealthKit, incl. watchOS 27 HR zones)
that starts on kickoff and ends at full-time, stored back in our DB for in-app match-fitness stats.

**Locked decisions (s161):**
- All contexts: **league ref** (fixtures), **casual ref** (one squad member assigned per game),
  **club cohort** officiating. Football-first.
- **Identity-first** resolver `get_my_next_assignment` keyed on `auth.uid()`; net-new ref/official
  identity layer (link `match_officials`↔user; casual ref slot; cohort→official binding).
- **Provider-agnostic watch auth** (users signed up via Google/email/company SSO/Apple — one
  Supabase pool): **(1) primary = WatchConnectivity session handoff from the paired iPhone**,
  **(2) fallback = email OTP** (provider-agnostic, same account by email), **(3) bonus = native
  Sign in with Apple**. No direct Google/company OAuth on watchOS (platform can't).
- **Health = refs only**, auto-start on watch "Start Match" / auto-stop on "Full Time" (warn that
  health only runs if started from the watch). Metrics mirror **Outdoor Football** (duration,
  active energy, distance, avg+max HR) **+ HR Workout Zones (watchOS 27**, live + post-match;
  graceful fallback to avg/max HR on watchOS 26).
- **2026/watchOS-27 features committed to v1:** Always-On display, haptics, Double Tap,
  complication + Smart Stack widget, **Live Activity + Dynamic Island** (live score/clock/HR on
  iPhone, driven by realtime). Backlog: Siri/App Intents voice-start, Ultra Action Button.
- Tech: SwiftUI + official **`supabase-swift`** SDK (auth + RPC + realtime), straight to RPCs.
- Min OS: watchOS 26 baseline; HR-zone layer gated on watchOS 27.

**Phases + ETA** (recalibrated to AI-build velocity — the bottleneck is operator device-testing +
Apple review, NOT code): 0 Foundations (~1–2d) · 1 Identity backend (~2–4d) · 2 League ref core
(~3–5d + device loops) · 3 HealthKit (~1–2d + device loops) · 3.5 Live Activity (~1–2d) · 4 Health
storage/surfacing (~1–2d) · 5 Casual ref (~2–3d) · 6 Club cohorts (~1–2d) · 7 Privacy + submit
(~1–2d + Apple review). **Wall-clock: MVP ~1–2 wks · full app ~2–4 wks** + review. Migrations from
**369**. Design runs in parallel with Phase 1.

**Phase 0 gotcha:** `apps/inorout/ios` is currently gitignored (`/ios`) + regenerated via `npx cap
sync` — fine for a thin webview wrap, but a hand-written watch target would be WIPED by a sync.
Phase 0 must un-ignore the native project and TRACK the Xcode project + watch source (still
ignoring `Pods/`/`build/`/`App/public/`); commit it once. No new repo / Vercel / App Store record
— one folder flips from disposable to tracked.

**Lessons baked in** (from the In or Out build): real-device walks are first-class (Hard Rule #13);
typed Swift `CodingKeys` + RPCS.md consumers (Hard Rule #12/#14); port the offline/idempotency
engine verbatim; resolver disambiguation for multi-role same-day games; health data = UK-GDPR
special category → store summary only + cascade `match_health_sessions` into `api/delete-account.js`.

**Sequencing:** comes after `APP_STORE_CHECKLIST.md` reaches Apple approval. Run solo (cloud-session
discipline). See DECISIONS.md s161 + project memory `[[project_watchos_companion]]`.

---

## REMAINING WORK SNAPSHOT (session 73, 2026-06-07)

At-a-glance of everything left, across all surfaces. Status: 🔴 not started · 🟡 partly done · 🟢 built, only deploy/test owed. Detail for each lives in the per-phase sections below.

| Area | Task | Type | Status |
|---|---|---|---|
| **Multi-context nav + guided tours** | **PLAN LOCKED s141 — NEXT BUILD (apps/inorout).** Make nav/stats/IO/first-run-tours relevant to the selected context (casual squad / competitive squad / club membership / guardian) via one `deriveContext()` descriptor + config-driven NavBar + header-avatar switcher; revive `FirstTimeHint` → full-spotlight guided tours per (context,screen). Corrects guardian → child-first Home + new `guardian_list_children_sessions` read RPC (kids × all clubs, training+matches, In/Out per fixture). Fixes 2 pre-existing bugs (multi-club picker, stranded club/parent users). 2 migrations (A team-state fields on get_team_state_by_player_token + _admin_token; B guardian feed). Ships BEFORE the domain migration (manifest `/feed` handoff recorded in DOMAIN_MIGRATION.md). Cross-cutting: /feed landing + last-context memory, installable /feed, per-team feature flag, deferred guardian push notifications. Spec: `MULTI_CONTEXT_NAV_HANDOFF.md` §LOCKED PLAN. | Backend+UI | 🟡 **Phase 1 SHIPPED s141 (PR #8 merged, migs 349–352; ships dark behind `teams.multi_context_nav`, default off).** deriveContext + config-driven NavBar + header-avatar ContextSwitcher + ClubNavBar + child-first guardian Home + /feed install manifest + 2 bug fixes; browser smoke-tested (caught+fixed a hooks-order crash + mig 352 get_user_relationships). **Phase 2 (guided tours) is NEXT** — see `MULTI_CONTEXT_NAV_HANDOFF.md` §PHASE 2 BUILD PROMPT. Owed: on-device PWA walk (GO_LIVE §16). |
| **QR Onboarding v1** | **NEXT BUILD PRIORITY — deadline 2026-06-18 (pilot pitch date).** Generic `invite_links` routing layer + `/q/<code>` route (stable code → mutable destination, never QR-encode internal IDs) + `react-qr-code` rendering. V1 actions: join-team, venue landing page, QR on reception display rotation. Match check-in = v2. Full 7-slice build plan: `QR_ONBOARDING_SCOPE.md`; design: DECISIONS.md session 84 "QR ONBOARDING ARCHITECTURE"; pilot context: `STRATEGY.md`. **Slices 1–2 ✅ shipped session 84:** (1) routing layer — `invite_links` mig 248 + `resolve`/`redeem` RPCs + `/q/<code>` route + `InviteResolve.jsx`; (2) join-team action — QR hand-off threads the code into the existing `/join` flow (`?invite=`), `redeem_invite_link` fires post-join. (3) venue landing — `get_venue_landing` mig 249 + `VenueLanding.jsx` ("what's on" + register-your-team via `join_register_team`) + approval-card enrichment (mig 250 `venue_get_state` v_pending → competition/captain-email/time on the venue Operations card). (4) QR rendering DONE — venue dashboard "QR codes" tab (`InvitesView.jsx`, view/copy/print venue + per-team, `venue_ensure_invite_link` mig 251) + reception-display "scan to join" QR panel (`QRPanel.jsx` on the rotation, `get_display_landing_code` mig 252). **All four demo-critical slices (1–4) shipped + verified live for the 2026-06-18 pitch.** (5) printable assets — `printAssets.js` poster + table-talker templates (embed the QR vector, branded, `@media print`) wired into the QR codes view (Poster / Table-talker buttons per venue + team). (6) match check-in — QR on the live fixture → `checkin_via_invite` mig 253 marks the scanning player IN (atomic, fixture-status gated). (7) link management — venue dashboard `InvitesView.jsx` "All codes" list (scan counts, deactivate, re-point) + `InviteLinkForm.jsx` create/re-point modal, backed by `venue_create_invite_link` / `venue_set_invite_link_active` / `venue_repoint_invite_link` (writes) + `venue_list_invite_links` (read) + `venue_owns_entity` helper (mig 254); re-point is fully flexible (cross entity type). **All 7 slices ✅ shipped.** | Backend+UI | 🟢 7/7 slices done |
| **Equipment Hire** (venue) | Sport-agnostic kit hire for the venue (bibs/balls/goals/nets/AV). Full booking + inventory build; sport-agnostic per the settled multi-sport posture (no `sports` table). Plan: `EQUIPMENT_HIRE_PLAN.md`. **Cycle 1 ✅ (migs 255–256):** 3 tables (`equipment` + `equipment_bookings` + `equipment_demand_misses`) with the data foundations locked in (category taxonomy, session-link FKs, demand-miss capture, asset value/condition) + `venue_charges` extended to bill equipment; catalogue RPCs `venue_list_equipment`/`venue_upsert_equipment`; venue **Equipment** tab + `EquipmentView.jsx`. **Cycle 2 ✅ shipped (session 85, mig 257):** quantity-aware availability (`get_equipment_availability` + `_equipment_peak_committed`) + the hire flow (`venue_create_equipment_hire` row-locked guard + auto-charge + demand-miss-on-turn-away, `venue_cancel_equipment_hire`, `venue_list_equipment_hires`); EV 13/13 + leak 0; EquipmentView gains a Catalogue/Hires toggle (availability picker + hire modal + hires list). **Cycle 3 ✅ shipped (session 85, migs 258–259):** returns/deposits/overdue — deposit hold snapshot on hire + release/forfeit on return, `venue_mark_equipment_out`/`venue_mark_equipment_returned` (condition write-back to the asset), derived `is_overdue` + board summary (out-now/overdue/due-today) in `venue_list_equipment_hires`; EquipmentView gains due-back field, board stats, status filter, Hand-out/Return/Cancel actions + ReturnModal. EV 7/7 + leak 0. (Also fixed a latent Cycle-2 bug: `window.confirm` shadowed by the local window memo → `globalThis.confirm`.) **Cycles 1–3 deployed + browser-verified live** on platform-venue.vercel.app (0 console errors). **Cycle 5 ✅ shipped (mig 260) — the data-product tail:** venue equipment intelligence — one READ-ONLY RPC `venue_equipment_insights(token, from?, to?)` → `{summary, roi[], usage[], procurement[]}`: ROI per asset lifetime (purchase cost vs revenue collected = net `venue_payments` on the hire's equipment charge, payback %/status, idle flag), usage over range (default trailing 90d — hires/units/unit-hours/busiest day/share, no fabricated denominator), procurement from `equipment_demand_misses` by category (turn-aways vs currently owned). New EquipmentView **Insights** tab (3 cards) + `venueEquipmentInsights` wrapper + barrel. No write path → ephemeral-verify N/A; proven via a live `BEGIN…ROLLBACK` revenue-join probe (ALL PASS + leak 0); rpc-security-sweep PASS; venue+inorout builds ✓. RPC shaped as the future **venue-Gaffer** "what should I buy next?" context source (Hard Rule #14, recorded in RPCS.md). Operator chose venue-dashboard-only this cycle; venue-Gaffer narrative surface + HQ multi-venue equipment benchmarking explicitly deferred (pilot is one venue). Owes manual venue redeploy + browser pass. **BACKLOG (deferred) — Cycle 4: QR self-hire** — scan-a-QR-on-the-kit self-serve hire on the `invite_links` rail; comes in as `requested` → the venue approves via `venue_confirm/decline_equipment_hire` (the request channel that lands here). Nice-to-have, lower priority than the data tail for the pilot. | Backend+UI | 🟢 Cycles 1–3 + 5 done; QR self-hire (Cycle 4) backlog |
| **Venue Memberships** (programme) | **IN PROGRESS — full membership system for venue management (both pilots).** Serves team/booker recurring fees (football venue) + per-person/family traditional membership (multi-sport venue). 7 phases, safety-sequenced, **Stripe is the FINAL phase** (built last on a proven manual-payment system). Plan: `~/.claude/plans/if-we-wanted-to-binary-orbit.md`. **Phase 1 ✅ (mig 269) — secure foundation:** multi-sport-per-venue via self-identified `venues.sports text[]` + `playing_areas.sport` (NOT the rejected `sports` lookup table — see DECISIONS.md "MULTI-SPORT VENUES"); `manage_memberships` capability registered in the `venue_admins` caps CHECK. **Phase 2 ✅ (mig 270) — per-person identity + GDPR:** `venue_customers` table (RLS-walled, the venue domain's first *person* entity) + 4 RPCs `venue_create_customer`/`venue_update_customer`/`venue_erase_customer`/`venue_list_customers_people` — email de-dup (returning-member guard), GDPR consent + right-to-erasure (scrub-but-keep-row), all gated `manage_memberships`. EV 10/10 + leak 0, rpc-security PASS, build clean. **Phase 3 ✅ (mig 271) — membership & fee core (manual billing):** 5 tables (`venue_membership_tiers` + `venue_tier_prices` + `venue_memberships` + `venue_fee_plans` + `venue_fee_subscriptions`) + 11 RPCs (tier create/update/list, enrol/freeze/cancel membership, list members, fee plan create/enrol/cancel/list) + `run_membership_renewals` engine (service_role) wired to `membershipRenewalsJob` (09:00 UK). Serves BOTH models — person memberships (monthly/quarterly/annual, snapshot pricing, freeze-pushes-renewal) + team/booker fees (weekly+). Billing on `venue_charges` (source_type +fee/+membership), manual payment; charges encode period in source_id → idempotent renewals. EV 13/13 + leak 0, rpc-security PASS (incl. caught + fixed run_membership_renewals being anon-grantable), build clean, casual-flow additive-only. **Phase 4 ✅ (apps/venue) — venue ops UI:** new **Memberships** tab (Dashboard Directory group) + `MembershipsView.jsx` with three sub-tabs — Members (roster + enrol/freeze/cancel modals), Plans (tier config + monthly/quarterly/annual pricing), Team fees (fee-plan config + enrol). Consumes the Phase 2/3 wrappers; matches CustomersView design patterns. Venue build clean. **OWES: browser pass + manual venue redeploy** (platform-venue.vercel.app is manual prebuilt-static) + real-device check. **Phase 5 (floor) ✅ (mig 272) — member-facing pass:** `venue_memberships.pass_token` + public `get_member_pass(token)` RPC + `MemberPass.jsx` at **`/m/<token>`** in apps/inorout (brand header, tier/status/renewal, member-discount perk, reception check-in code); `venue_list_members` now returns `pass_token`. EV 5/5 + leak 0, rpc-security PASS, casual build clean + additive-only (new route branch, 0 deletions). **Phase 5 continuation OWED:** Apple/Google Wallet pass (needs Apple Developer certs — operator infra), scannable QR image ✅ (react-qr-code on MemberPass — encodes the `/m/<token>` pass URL for reception to scan), reception-display check-in ✅ (mig 274 — `venue_member_checkins` + `member_check_in(display_token, pass_token)` venue-bound write, EV 9/9 + leak 0, rpc-security PASS; apps/display `CheckInOverlay.jsx` scans the pass QR via native BarcodeDetector w/ manual-code fallback, greets by name + visit count), tiered self-signup ✅ (mig 280 — tiers are free/paid per `benefits.is_free`, opt-in to the `/q` page via `benefits.self_signup`; the `/q` page shows a tier picker (`get_venue_signup_tiers`); FREE tier → instant auto-member + pass; PAID/tier-less → pending request tagged with the chosen tier; `venue_approve_and_enrol` = one-tap activate+enrol (free £0 / paid +charge); Plans tab gains Free + Offer-on-signup toggles; request panel shows "wants Gold" + Approve&enrol. EV 8/8 + leak 0, rpc-security PASS). member self-signup UI on the `/q/` rail ✅ (mig 275 — `venue_customers` gains a `pending` status; public `member_self_signup(code, …)` rides the existing `venue_landing` /q rail → pending person, idempotent on email; `venue_approve_customer` (gated) approves→active / rejects→archived; EV 13/13 + leak 0, rpc-security PASS. apps/inorout `VenueLanding.jsx` "Join as a member" form; apps/venue `MembershipsView` Members tab "Membership requests" approve/reject panel). **Phase 6 (perks + reporting) ✅ (mig 273):** partner coalition loyalty — `venue_partners` + `partner_offers` (all-member or tier-scoped) + `partner_redemptions` ledger + 6 RPCs (create partner/offer, toggle, list, member-facing `redeem_member_offer`, `venue_membership_summary`). Offers surface on the member pass (`get_member_pass` +`offers`); MemberPass shows a **Member perks** section with reveal-code; venue MembershipsView gains a **Perks** tab (partner/offer config + redemption counts) + a **summary stat strip** (active / MRR / due-soon / frozen·churn). EV 7/7 + leak 0, rpc-security PASS, both apps build clean, casual-core additive-only. **Phase 6 reminders ✅ (mig 276):** `get_membership_reminders_due()` (service_role; REVOKE anon/authenticated — member PII) + `membershipRemindersJob` (cron.js, 10:00 UK) send welcome / renewal-due / payment-due / freeze-ending emails via Resend, deduped per cycle in `notification_log`; 4 mailer templates in `_mailer.js`. EV 5/5 + leak 0, rpc-security PASS. **Phase 6 booking discount ✅ (mig 277):** booking↔member link (`pitch_bookings.customer_id`) + `_booking_member_discount` helper (service_role); `venue_confirm_booking` + `venue_confirm_booking_series` apply the booker's active-tier `discount_pct` to the charge (member resolved by explicit link or active-member email match, link then persisted; 100% → comped/no charge; non-member/frozen/garbage-pct = full). Critical path EV 9/9 + leak 0 (incl. all error paths preserved), rpc-security PASS. **Phase 6 HQ rollup ✅ (mig 278):** `hq_get_membership_rollup(company)` (authenticated, gated `resolve_company_caller`, region-scoped) sums membership health (active/MRR/due-soon/frozen/pending/cancelled-30d) per venue + company total; apps/hq `AnalyticsView` gains a **Memberships** card (in the commercial preset). rpc-security PASS, EV (aggregation + gate) clean. **Phase 6 deferred:** churn flag on `venue_list_customers` (lapsed-member vs walk-in). **Phase 7 (Stripe) scaffolding ✅ keyless/DORMANT (mig 279 + Node):** schema (venue connect-account + member `stripe_customer_id` + membership `stripe_subscription_id`/`payment_state` + `billing_events` persist-then-process store); state-machine + idempotency RPCs (`record_stripe_event`/`mark_stripe_event_processed`/`apply_membership_subscription_status`/`set_venue_connect_state`/`venue_get_billing_status`, EV 5/5 + leak 0, rpc-security PASS); `api/_stripe.js` (guarded SDK) + `api/stripe-webhook.js` (sig-verify→persist-then-process→fetch-fresh→act, idempotent) + `api/stripe-connect.js` (Express onboarding) + `membershipReconciliationJob` (cron, 04:00 UK). All env-guarded — 503/no-op until keys exist. **BLOCKED (operator):** money-flow DECISIONS sign-off + Stripe test keys (test-clock lifecycle proof) then live keys; venue "Connect Stripe" UI + enrol-to-Stripe path deferred to go-live. See DECISIONS "MONEY-FLOW GATE". **Still owed across P4–P6:** venue redeploy + browser/real-device passes; Phase 5 Wallet (Apple certs)/QR/reception-check-in/self-signup-UI. **360Player-style registration ✅ (mig 282):** signup now captures the FULL member record — identity (DOB/gender/structured address), emergency contact, medical/safeguarding, guardian (auto-required for under-18s via DOB), + a consent suite (data-processing & terms required; photo, medical, marketing optional; each a bool+`_at` pair). Widened `venue_create_customer`/`venue_update_customer`/`member_self_signup` (old signatures DROPPED) with server-side gates (consent_required/guardian_required/medical_consent_required); `venue_erase_customer` scrubs every new column; `venue_list_customers_people` returns them. On BOTH surfaces: apps/inorout `VenueLanding` MemberSignupForm (sectioned, conditional guardian) + apps/venue `MembershipsView` (full EnrolModal new-member capture + per-member ProfileModal view/edit). EV 9/9 + leak 0, rpc-security 5/5 PASS, both builds clean, casual-flow untouched (only VenueLanding + supabase.js, no casual surface/wrapper). **Owed:** real-iPhone pass on `/q` (incl. under-18 branch) + venue redeploy. | Backend+UI | 🟡 P6 core done; P7 + owed items remain |
| **Membership V2 — Club OS** (epic) | **Phase 1 foundation SHIPPED (session 93, migs 283–288).** Reform of the v1 membership system into a member-owned account + household + club operating system. Full plan: `MEMBERSHIP_V2_HANDOFF.md`. Reframes "member = venue CRM row" → "member = person who owns their profile; a **club** (not a venue) grants them a membership." Locked decisions: real member logins + self-service profile (D1); parent→multiple-children households, 360Player-style (D2); venue-defined benefits as a named line + £/% value, tiers adult/junior/child + family pricing (D3); versioned consent documents signed in-modal with audit trail (D4); per-venue ID-mandate toggle + conditional upload (D5); CPSU-standard safeguarding fields, venue-configurable (D6). Futureproofing baked into Phase 1 as cheap structural hooks: **club-as-owner** (`clubs` + `club_venues` M:N — the one expensive-to-retrofit decision), `pricing_model` discriminator (recurring\|term, enables pro-rata/season joins), **line-item money model** (membership/fee/merchandise/add-on), role-agnostic identity, club cohorts, club-scoped consent. Member-app UX = **reuse** the profile icon (→ person profile), MySquads (→ "my memberships & teams", mine + my kids'), and "+Join" (→ universal join via the existing `InviteResolve` dispatcher). **Zero-footprint principle:** invisible to casual/league players with no memberships (casual-regression-proven). **Security:** RLS-retrofit risk gone (built RLS-first); new higher-stakes risk = silent wrong-person exposure of children's/medical data → threat-model per RPC, negative-path EV (prove the wrong user is *refused*), standing RLS suite, claim-flow ownership guard. **Strategic centrepiece = Phase 10 club attendance:** extend the existing In/Out availability primitive to club training/fixtures (parent declares child in/out) — the "who's-turning-up" WhatsApp-killer; this is the club-OS wedge. **Phases:** 0 module entitlements + superadmin on/off → 1 foundation+hooks → 2 member profile → 3 households → 4 builder rework → 5 consent docs → 6 ID upload → 7 `/q` rebuild → (later) 10 attendance · 11 comms · 12 staff+DBS · 8 multi-venue · 9 merchandise. **Tournaments OUT** (already shipped as Phase 11 cups; foundations let them consume the cup engine later). Open Q: club vs existing company entity (resolve in Phase-1 audit). **Phase 1 ✅ SHIPPED (migs 283–288):** `member_profiles` (person, CPSU superset, auth_user_id nullable=unclaimed) + `member_guardians` (household graph, Leo←Claire demo) + `clubs` extended (contact, id_mandate, safeguarding_config) + `club_venues` (M:N) + `club_cohorts` + `venue_memberships` reframed (+club_id/member_profile_id/payer_profile_id/pricing_model/cohort_id) + 5 RPCs (`club_create`, `venue_list_clubs`, `member_create_profile`, `member_claim_profile`, `member_get_self`; all SECDEF/authenticated-only, neg-path EV PASS) + demo backfill (club_demo + 10 member_profiles + Leo←Claire guardian). **Phase 2 ✅ SHIPPED (session 94, mig 289, commit 2ea899b):** `member_update_self(p_updates jsonb)` (SECDEF/authenticated, auth.uid()-scoped, jsonb partial-update, email immutable, medical fields → `member_profile_medical_updated` audit event per Hard Rule #9; neg-path EV PASS) + `get_member_pass` extended with `member_profile_id` + Phase-1 JS wrappers that were missing (memberGetSelf/memberClaimProfile/memberCreateProfile/memberUpdateSelf/clubCreate/venueListClubs) + `/profile` route + `MemberProfile.jsx` (zero-footprint, 6-section view/edit) + `MemberPass.jsx` "Your account" pill when viewer owns the pass. Casual regression PASS. **Phase 3 ✅ SHIPPED (session 95, mig 290, commit 5337be6):** `member_register_child` + `member_list_children` + `member_update_child` (all SECDEF/authenticated-only, audit-logged; not_guardian guard on update; neg-path EV 6/6 PASS + leak=0). MemberProfile.jsx My Children section — child cards, add/edit with full CPSU safeguarding fields, zero-footprint. Invite flow deferred (second guardian = ec2_* data fields). Cohort deferred to Phase 4. Casual regression PASS. **Phase 4 ✅ SHIPPED (session 96, mig 291, commit e2b8ac1):** Membership builder rework — `venue_membership_tiers` gains `audience`/`pricing_model`/`season_start`/`season_end`; `venue_tier_prices` gains `price_type` (standard/family/sibling) + `season` period; updated `venue_create_membership_tier`/`venue_update_membership_tier`/`venue_list_membership_tiers` with new params; fixed `venue_list_clubs` (token auth + `safeguarding_config`); new `venue_update_club_settings` RPC. MembershipsView reworked: Plans tab shows audience pill, season badge, all price_type rows, Edit modal (audience/pricing-model/season dates/benefit lines/family+sibling pricing); new **Club** tab with per-club ID-mandate toggle + 6 CPSU safeguarding field toggles (optimistic UI). **Phase 5 ✅ SHIPPED (session 97, migs 292–293, commit fcdf6c9):** s96 tech debt closed first (mig 292) — `venue_enrol_membership` now accepts `'season'`; `renews_at` set to tier's `season_end` (or `9999-12-31`); `run_membership_renewals` guards loop (c) with `AND period <> 'season'`; `venue_memberships.period` constraint extended. Phase 5 (mig 293): `policy_documents` (club-scoped, versioned, partial-unique current-version-per-title index) + `consent_acceptances` (typed signature, IP/UA, `signed_on_behalf_of`, UNIQUE per doc+member, ON DELETE RESTRICT). 6 RPCs: `venue_create_policy_document`/`venue_publish_policy_version`/`venue_list_policy_documents` (anon+authenticated); `member_accept_consent`/`member_get_pending_consents`/`member_list_consents` (authenticated-only; anon explicitly revoked — Supabase auto-grants anon on new fns, caught in security sweep). Guardian signing: server-side `member_guardians` edge check. MembershipsView: **Documents tab**. MemberProfile: **Consents section** (zero-footprint) + **ConsentModal** (scrollable body, typed sig, guardian-aware). Both builds PASS, hygiene PASS, rpc-security PASS. **Phase 10 — Club Attendance ✅ Slices 1–3 + 4A SHIPPED (sessions 101–105):** Slice 1 (mig 298, s101): 3 tables + 9 admin RPCs + demo seed. Slice 2 (mig 299, s102): 3 member RPCs (member_list_upcoming_sessions/member_rsvp_session/member_get_session_rsvp_board), EV 11/11 PASS. Slice 3 (s103, no new mig): `SessionsView.jsx` in apps/venue. Slice 4A (mig 300, s105, commit 596ab9b): team/fixture schema extension — `club_teams` rebuilt as membership-domain playing groups (replaced mig-055 dead league stub), `club_team_members` (seasonal assignment, partial-unique WHERE is_active=true), `club_team_managers` (manager/assistant_manager/coach role), `club_session_guests` (one-game appearances); `club_sessions` extended with session_type/team_id/opponent_name/home_away/opponent_venue_name/opponent_address/meet_time; `member_list_upcoming_sessions` rewritten with 3-way visibility (whole-cohort OR team-member OR guest). EV 5/5 PASS + leak=0. **Slice 4B ✅ SHIPPED (session 106, mig 301 + frontend, commit 60809a1):** mig 301 extended `member_get_self()` — added `active_clubs` (all clubs with active/ending venue_membership, one row per club+cohort) and `managed_teams` (club_team_managers where is_active=true). `SessionsScreen.jsx` (330 lines, apps/inorout): zero-footprint, club picker, upcoming session list, detail sheet + RSVP board, RSVP with guardian forProfileId, manager badge, double-fire guard. App.jsx: `/sessions` route + memberProfile state + pure-parent landing redirect + My Squads "YOUR CLUBS" section. Build PASS, hygiene 7/7, RPC security PASS. Next mig = 302. **Slice 4C ✅ SHIPPED (session 108, mig 302, commit 5ee6129):** `club_session_series` table + `series_id` FK on `club_sessions` + `club_create_session_series` RPC (pre-generates all weekly sessions) + `club_cancel_session_series` RPC (bulk-cancels remaining) + `club_list_sessions` extended (series_id/series_title) + `member_list_upcoming_sessions` 4th arm (manager visibility) + SessionsView "Recurring block" create modal + series badge on cards + "Cancel remaining series" button. **Slice 4D ✅ SHIPPED (session 109, mig 303, commit 9ef222a):** 6 manager RPCs (all SECDEF/authenticated-only, EV 7/7 + leak 0): `club_manager_create_session` (one-off), `club_manager_create_session_series` (recurring, DOW stepping), `club_manager_cancel_session` (single date, guards: not_team_session/not_scheduled/in_past), `club_manager_get_team_members` (folds `is_session_guest` via optional p_session_id — 6 not 7 RPCs), `club_manager_add_session_guest` (idempotent ON CONFLICT DO NOTHING), `club_manager_remove_session_guest`. SessionsScreen.jsx fully extended with manager panel: "+ Create" button in header (zero-footprint when !isManager), `CreateSessionModal` (one-off/recurring toggle, session type chips, match fields, team picker when multiple managed teams), `SessionDetail` extended (guests section with Add/Remove picker, Cancel session with reason confirm). All double-fire guards applied (`isCreatingRef`/`isCancellingRef`/`isGuestActingRef`). Build PASS, hygiene 7/7, rpc-security 6/6 PASS. **Slice 4E ✅ SHIPPED (session 110, mig 304, commit 55c6180):** `club_manager_mark_attendance(p_session_id, p_attendances)` — authenticated-only, no venue token; auth via auth.uid()→member_profiles→club_team_managers(is_active=true); bulk upsert into club_session_attendance ON CONFLICT idempotent; audit team_id='_system'/actor_type='player'. EV 8/8 PASS + leak=0. JS wrapper `clubManagerMarkAttendance` + barrel export. SessionsScreen.jsx `SessionDetail`: attendance section (zero-footprint when future or not manager) — per-member attended/absent/late toggles (✓/~/✕), "Save attendance" button disabled until at least one mark set; `attendanceMaps` keyed by session_id; `isMarkingAttendanceRef` double-fire guard. Build PASS, hygiene 7/7, rpc-security PASS. **Phase 10 Club Attendance COMPLETE.** **Phase 12 ✅ SHIPPED (session 111, migs 305–306, commit 6b7c100):** `club_staff_dbs` table (per-person-per-club DBS record, check_type/status/expiry, RLS-walled); 5 venue-side RPCs: `venue_assign_team_manager` (membership guard + ON CONFLICT idempotent), `venue_remove_team_manager` (soft-delete), `venue_list_club_staff` (LEFT JOIN DBS row), `venue_upsert_staff_dbs` (ON CONFLICT update), `expire_staff_dbs` (service_role only, pg_cron 08:00 UK); `club_manager_get_member_detail` (authenticated-only, two-tier auth: role='manager' on any club team → full CPSU + guardian, coach/asst → shared-team scope, not_authorised guard); `club_manager_get_team_members` extended with `has_medical_notes` flag. Venue MembershipsView: **Staff tab** (per-team expandable staff roster, DBS badge, assign/remove modal, DBS record modal with check_type/status/cert/dates/notes); **Club tab** gains 3 DBS role-requirement toggles (stored in `clubs.safeguarding_config` jsonb, reuses `toggleSafeguardingField`). SessionsScreen: 48h-window medical-alert panel in `SessionDetail` (gated `isManagerOfSession && within48h`, per-member expandable amber cards, lazy-loaded CPSU detail). rpc-security sweep 7/7 PASS (incl. caught + fixed `expire_staff_dbs` being auto-granted anon/authenticated by Supabase default privileges — revoked explicitly). EV 10/10 PASS + leak=0. Hygiene 7/7 PASS. Casual-regression PASS. **Phase 11 ✅ SHIPPED (session 112, mig 307, commit 62fc9e4):** `club_announcements` table (club_id/venue_id/created_by/title/body/audience/cohort_id/team_id/status/email_sent_count/sent_at; RLS-walled, REVOKE ALL from anon+authenticated). 3 RPCs: `club_send_announcement` (venue token, manage_memberships cap, audience club/cohort/team, validates cohort/team ownership, queues row, audits `club_announcement_queued`), `get_pending_club_broadcasts` (service_role only, 3-way UNION recipient resolution), `member_list_club_announcements` (authenticated-only, scoped to caller's visibility, LIMIT 20). Email delivery via `clubBroadcastJob` (every cron tick, `notification_log` dedup); `club_announcement` template in `_mailer.js`. Venue UI: **Announcements tab** in MembershipsView (multi-club picker, audience selector + cohort/team picker, title+body form, `isSavingRef` guard, "queued" success feedback). Member UI: **AnnouncementsSection** in SessionsScreen above session list (zero-footprint until sent announcements exist; "See all" toggle at 3+). EV 7/7 PASS + leak=0. Security sweep 3/3 PASS. Hygiene 7/7 PASS. Build clean. **Phase 8 ✅ SHIPPED (session 113, mig 308, commit 09ae92f):** Multi-venue activation — one club membership valid at check-in across all club_venues footprint. Fixed a live bug where V2 members (customer_id=NULL) got {ok:false} from get_member_pass (INNER JOIN on venue_customers → no row). Schema: venue_member_checkins.customer_id → nullable + member_profile_id column added. RPCs rewritten: get_member_pass (LEFT JOINs + valid_venues array), member_check_in (club_venues EXISTS lookup replaces hard venue equality, V2 COALESCE names), venue_list_members (V2 COALESCE + club-scoped footprint), member_get_self (venues array per active_clubs row). 4 new RPCs: venue_add_club_venue (trusted-network auth: caller must already be in club; idempotent), venue_remove_club_venue (last-venue + active-members guards), venue_list_club_venues (30d check-in counts), venue_search (ILIKE name+city, p_club_id excludes already-linked). Venue MembershipsView Club tab: collapsible VenuesSection per club with add/remove + AddVenueModal (debounced search + select). MemberPass: "Valid at N venues" expandable list. EV 14/14 PASS + leak=0. Hygiene 7/7 PASS. Security sweep 8/8 PASS. Both builds clean. **Phase 9 ✅ SHIPPED (session 114, mig 309, commit 6fc781f):** Club merchandise catalogue + standalone purchases. Tables: `club_merchandise` + `club_purchases` (status pending_payment|pending|fulfilled|cancelled; stripe_payment_intent_id dormant). 8 SECURITY DEFINER RPCs. EV caught + fixed nested-aggregate bug in venue_list_merchandise (inner subquery fix, mig 309b). Stripe scaffold dormant — purchases enter pending_payment until keys provided (same Connect account as memberships). UI: **Shop tab** in MembershipsView (Catalogue + Orders); **Club Shop section** in SessionsScreen; **My orders section** in MemberProfile (zero-footprint). EV 14/14 PASS + leak=0. Security sweep 8/8 PASS. Hygiene 7/7 PASS. Both builds clean. Next mig = 310. | Backend+UI | ✅ ALL PHASES COMPLETE (Phases 1–12 + 8 + 9) |
| Venue — Community visibility | **Venue↔casual-team link** — let the (private) venue dashboard see the casual groups using its pitches ("venue as owner of its community"). Needs `venue_id`/association on casual `teams` + venue context in the casual create flow. Dashboard visibility ONLY — NOT public joining, NOT part of QR onboarding. Own cycle, post-pitch. Reasoning: DECISIONS.md session 84 "Separate, NOT part of QR onboarding". | Backend+UI | 🔴 not started |
| Website / marketing | Deploy + wire the landing pages (`marketing/` — players + venues) | Infra/UI | ✅ DEPLOYED s150 — `marketing` project serves `in-or-out.com`+`www`; catch-all 301 forwards token paths → `app.`; consumer CTAs → `app.` (domain migration Phase 5.2) |
| App wrapping | Wrap the consumer PWA (`app.in-or-out.com`) as native iOS/Android (Capacitor); consumer app ONLY | Infra/New | 🟡 SCOPED + ready (s150) — domain prerequisite DONE (load URL locked = `https://app.in-or-out.com`). Roadmap + next-session prompt: `APP_WRAP_HANDOFF.md`. Needs: Phase 0 store accounts (operator), `.well-known` deep-link files, Capacitor scaffold + native push, + burn-down of the owed real-device walks |
| League — Display (TV) | Final visual design — **broadcast wall redesign SHIPPED session 83** (hero + featured algorithm, minis, rotating live table, golden boot, coming-up incl. casual bookings, tall promo, goal celebration; migs 244–246, see RECEPTION_DISPLAY_SCOPE.md) | UI | ✅ shipped s83 |
| League — Display | Sponsor-image upload in venue settings — **SHIPPED session 83** (`venue-media` bucket mig 246 + DisplaySettings upload/copy/ratio + featured-match pin, mig 245). Upload needs a venue staff login (shared-token venues can't upload) | Backend+UI | ✅ shipped s83 |
| League — Display | Deploy `apps/display` to its own Vercel project + wire `VITE_DISPLAY_APP_URL` — **SHIPPED session 83**: `platform-display.vercel.app` (manual prebuilt-static like venue/superadmin — does NOT auto-deploy; needs `apps/display/.env.local`); venue app rebuilt+redeployed with the URL baked in, copy-link verified live | Infra | ✅ shipped s83 |
| League — Display | Real-TV device test (wake-lock, reconnect, PIN, colours) + venue-app sponsor upload on a real device | Test | 🔴 owed |
| League — Display | Nice-to-haves: display-token rotation, enterprise white-label removal | UI/Backend | 🔴 deferred |
| League — Ref app | **Ref V2 ("RefSix-killer") IN PROGRESS (session 87).** Backend landed: schema (migs 261–263: pausable per-fixture clock, persisted stoppage/`added_time`, per-fixture `format_override`, event `note_text`/`duration`, `league_config` period model), 4 new write RPCs (mig 264: `ref_set_clock`/`ref_record_note`/`ref_record_sin_bin`/`ref_set_added_time`, EV 9/9 + leak 0), ref state RPC extended with resolved `match_format` + clock/added-time + **restored `actual_kickoff_at`** (mig 265, fixes a clock regression mig 160 introduced — BUGS.md s87). Config layered league→competition→fixture (override flagged). Existing ref RPCs already broadcast `venue_live` (mig 121/187) so the big screen is already live. Plan: `apps/ref/REF_V2_BUILD_PLAN.md`. **✅ COMPLETE (backend migs 261–267, frontend shipped s88 commit 3dd7a5c, deploy re-verified s89).** Backend: 261–265 (clock/stoppage/override/notes/sin-bin/state) + **266 `get_display_state` pause+added-time passthrough** + **267 `update_league_config` config write** — all confirmed applied to prod. Frontend: broadcast-dark artifact port live in apps/ref (LiveMatch consumes clock-pause/added-time/sin-bin/format; `refSetClock`/`refRecordNote`/`refRecordSinBin`/`refSetAddedTime` wired + barrelled); builds clean; `platform-ref.vercel.app` deployed prebuilt + live-bundle verified (Supabase URL + new RPC names present). Root-directory deploy gotcha fixed s89 (GO_LIVE #14.2). **Only owed:** real-iPhone home-screen PWA walk (clock + Ref V2 features), Hard Rule #13. | UI+Backend | ✅ complete; real-iPhone test owed |
| League — Venue | Read-RPCs for team rosters / players / standings views | Backend | ✅ done (migs 196–198, live in prod) |
| League — Venue | Skin those screens once data exists | UI | ✅ done + DEPLOYED s89 (standings/rosters/players/teams/fixtures/cups wired + skinned; platform-venue.vercel.app redeployed, bundle verified) |
| League — Venue | Logged-in browser passes (payments screens etc.) | Test | 🟢 owed |
| Platform — Audit | **IP + device in the audit trail** (ON HOLD, session 77 — backend-only, never shown on frontend). *Who* + *when* already captured on all 93 audit-writing RPCs (`audit_events.actor_*` + `created_at`). Agreed shape when resumed: a shared `record_audit()` helper that reads client IP + user-agent server-side from PostgREST `request.headers` (`x-forwarded-for`; never client-passed), stored on new `audit_events.ip_address`/`user_agent` cols; adopt for new/changed RPCs + backfill the 93 incrementally. Venue "person" fills in once per-user venue credentials exist. | Backend | ⏸️ on hold (flagged session 77) |
| League — Venue | **Person/new-customer block booking** — venue block (recurring weekly) is team-only in v1 (mig 232). Extending to walk-in/person bookers needs `booking_series` made booker-agnostic (nullable team_id + booked_by_name + contact) + a `create_renewal_holds` guard (`team_id IS NOT NULL`) so person blocks aren't auto-renewed. | Backend | 🔴 deferred (flagged session 77) |
| League — Venue | **Venue login credentials / per-user accounts** — per-person logins replacing the shared `venue_admin_token`. ✅ **SHIPPED session 78 (migs 237–240):** venue_admins table + resolve_venue_caller authed stage + venue_whoami/claim (237); Google+password sign-in + venue picker + account chip (P2); invites + access mgmt screen with role + per-person capability overrides (238); server-side capability enforcement on 11 gated RPCs (239); attribution payoff — reporter name on incidents (240). Owner/Manager/Staff; league admin open to Staff; gated Manager+ = reverse money / settings / facility / staff directory / manage logins. Hard cutover (shared token now a dev/demo backdoor). | New feature | 🟢 SHIPPED (s78) |
| HQ dashboard | Final visual polish + `regional_admin` region-filter UI | UI | 🟡 functional, polish pending |
| HQ dashboard | Deploy `apps/hq` to Vercel | Infra | 🔴 owed |
| HQ dashboard | Logged-in (Google-OAuth) browser passes — several surfaces | Test | 🟢 owed |
| AI — Phase 7 | "Ask the Gaffer" AI layer (team + HQ); HQ Weekly Brief rides on it | New feature | 🔴 not started (the big one) |
| Public — Phase 10 | Public, no-login league/standings/fixtures pages | New feature | 🔴 not started |
| HQ Intelligence — Phase 3 | Competition & Team-Risk analytics (at-risk teams, fill rate, completion) | Backend+UI | 🔴 not started |
| HQ Intelligence — Phase 4 | Weekly HQ Brief (auto-written) — depends on Phase 7 | New feature | 🔴 blocked on Phase 7 |
| HQ Intelligence — Phase 5 | "The Moat" (migration maps, dynamic pricing, etc.) | New feature | 🔴 far future |
| Payments | **Stripe Connect + GoCardless for Platforms** — 8-phase plan locked session 131. `venue_integrations` foundation → Stripe Connect activation (mig 279 scaffolding) → Stripe test lifecycle → GoCardless connect → GoCardless mandate + webhooks → GoCardless test lifecycle → member payment choice. Platform never holds money — each venue connects their own account. Full plan: FEATURES.md Payment Infrastructure section. | Backend/New | 🟢 **ALL 8 PHASES BUILT (migs 329–337, next mig=338).** Stripe P1–4 ✅ (P4 LIFECYCLE PROVEN s137); GoCardless P5–6+8 ✅ BUILT s138 (mig 337) DORMANT. **Remaining = operator-gated only:** (a) Stripe go-live — sign MONEY-FLOW GATE + swap live keys in platform-clubmanager Vercel; (b) GoCardless P7 — operator applies for GC for Platforms + adds env vars, then sandbox lifecycle proof (GC code unverified against a real GC env). |
| **Classes + Room Hire** | 8-phase plan: hireable spaces → class scheduling → member booking + waitlist → room hire → QR check-in → packages & trials → HQ analytics. Member-only classes, self-serve + enquiry-only room hire, equipment add-on, no-show tracking. Full plan: `~/.claude/plans/classes-and-room-hire.md`. **Phase 6 ✅ SHIPPED (mig 343) — QR check-in:** `venue_class_checkin(token, session_id, pass_token)` (instructor/manager-gated; resolves member via `venue_memberships.pass_token` → `member_profile_id`; stamps `venue_class_bookings.checked_in_at` — the mig-339 no-show contract; promotes waitlist/offered → confirmed; graceful per-scan reasons + RAISE for operator/authz errors; booking-row-only attendance, no charge). New `venue_class_bookings.checked_in_at` column. Venue UI: full-screen `ClassCheckinScanner.jsx` (ports apps/display BarcodeDetector/manual-fallback) reached from a "Check in" button on the ClassesView session-detail sheet — live tally + per-scan flash. EV 12/12 + leak 0, rpc-security PASS, hygiene 7/7, venue+inorout builds clean, casual-regression PASS (core additive-only). Owed: real-device camera test (folds with Phase 3/4/5 member iPhone walks). **Phase 7 ✅ SHIPPED (mig 344) — class packages & trials:** 2 tables (`venue_class_packages` + `venue_member_package_balances`, RLS-on + REVOKE) + `venue_class_bookings.package_balance_id` (booking↔credit link) + `venue_charges.source_type += 'class_package'`. 5 RPCs: `venue_create_class_package`/`venue_list_class_packages` (token; list nests per-member balances), `member_list_class_packages` (anon public menu), `member_purchase_class_package` (auth; NOT Stripe-gated — grants credits immediately + raises unpaid `class_package` charge, mirrors memberships), `member_get_package_balance` (auth; NULL=all venues). **`_apply_class_booking_charge` re-issued with waiver > package > charge precedence** — a waived session never burns a paid credit; else a valid balance (soonest-expiring) is decremented (booking `payment_status='paid'`, NO charge); else normal charge. `member_cancel_class_booking` + `venue_cancel_class_session`/`_series` re-issued to restore credits on cancel (never strand member money). Venue UI: Packages sub-tab in ClassesView. Member UI: "Buy a class pass" CTA + credit pill on ClassesTimetable; "Class passes" section on MemberPass. EV 6/6 + leak 0 (purchase→balance+charge; deduct-no-charge; exhaust→charge; expired ignored; waiver-precedence; cancel-restores), rpc-security 9/9 PASS, hygiene 7/7, both builds clean, casual-regression PASS (core additive-only). Owed: real-iPhone PWA walk (folds with Phase 3/4/5 member-surface + Phase 6 scanner walks). | Backend+UI | 🟡 Phases 1–7 (migs 338–344) ✅ shipped; next = Phase 8 (HQ analytics, mig 345) |
| Billing — Phase 8 | Self-serve SaaS subscriptions/billing | New feature | 🔴 deferred to year 2 |
| Operational | SMS/WhatsApp — **RULED OUT (session 131).** Native push via Capacitor (APNs/FCM) makes WhatsApp unnecessary. `_sms.js` stays dormant. `pickChannel` = push → email only. | Cancelled | ✅ decision made |
| Operational | Monday HQ digest delivery eyeball once `RESEND_API_KEY` live | Test/Config | 🟢 owed |
| Operational | Real-iPhone passes: persistent guests, cups player view, reserve/injured (session 73) | Test | 🟢 owed |

**Net-new features left:** Phase 7 (AI) · Phase 10 (public pages) · HQ-I Phase 3. (Venue login credentials ✅ shipped s78. Phase 8 billing + Payments V5 deliberately later.)
**Wrap-up (not new features):** Ref V2 ✅ deployed s89 · league venue screens ✅ deployed s89 · landing-page deploy ✅ done s150 (domain migration) · native app-store wrapping ✅ SCOPED s150 (`APP_WRAP_HANDOFF.md`) · still owed: HQ skin polish + deploy · real-device/config test backlog (the ~20 owed device walks — now consolidated in `APP_WRAP_HANDOFF.md` as the wrap's QA pass).

---

## PERSISTENT GUESTS — design (session 71, operator-approved decisions; NOT yet built)

**Problem.** Today a guest (+1) is a throwaway `players` row (is_guest=true, guest_of=host)
that is **hard-deleted on the weekly rollover** (migs 207/209) and by remove_guest_player. So:
no retained history, no accumulation, no way to promote/link to a member, and deleted-guest ids
linger unresolved in `matches.team_a/team_b` (raw ids shown in Results — operator screenshot).

**Why deletion exists (the tension to design around).** mig 207 deleted guests to fix a real
bug: a *leftover* guest row made the host's "Plus One" button disappear every week. Root cause
was conflating "person exists on the team" with "person is in THIS week". The future-proof fix
separates those — reusing the per-week `status` mechanism regulars already have.

**Target model.** A guest is a **first-class, persistent `players` row** that is never auto-
deleted; `is_guest=true` just means "brought by a host, not yet a self-managing member."
- **Persist + accumulate:** guest rows + their `player_match` history are never deleted, so
  appearances/stats build up.
- **Per-week participation:** on rollover a guest is reset to **dormant** (status='none',
  team=NULL, admin_locked_in=false) — NOT deleted. Dormant guests are hidden from the weekly
  board but stay in the team's guest roster.
- **Plus One logic** keys on "host has an ACTIVE guest this week" (a guest with guest_of=host
  AND status active), not "a guest row exists" — so a dormant guest never blocks the button.

**Operator-approved decisions (session 71):**
1. **Returning guests:** when a host taps "Plus One", they pick from the team's past guests
   (re-activate, keeping history) OR add a new name.
2. **Stats:** a guest's games accumulate on **their own record only**; they stay OUT of the
   team reliability table + POTM until promoted. (Keep the existing `is_guest=false` filters;
   promotion flips the flag and they start counting automatically.)
3. **Promotion:** BOTH — admin "make permanent" from the squad, AND guest self-claim on signup
   (link the existing guest row to their account). Either way history carries over (same row).

**Build slices (each its own audit→execute→verify→commit, EV + casual-regression):**
- **S1 — Foundation (stop deleting): ✅ SHIPPED (session 72, mig 216).** rollover RPCs
  (admin_go_live / admin_go_live_for_team) reset guests to dormant instead of deleting;
  remove_guest_player → dormant (not delete); board/squad rendering hides dormant guests via a
  shared `isDormantGuest(p)` engine helper (PlayerView board, AdminView squad + guest-count +
  orphan-detection, Payments guest list, Stats guest count, SquadScreen guest filter);
  get_team_state still exposes guests in the squad payload for S2's picker (no RPC shape change).
  **Keystone:** PlayerView `myGuest` now keys on an ACTIVE guest (status!=='none') so a dormant
  row no longer blocks the Plus One button. mig 216 is PURE function-redefinition (no row
  mutation) — reverses ONLY the guest-delete portions of migs 207/209; the existing mig-204 bulk
  status reset already leaves guests dormant. EV 7/7 + leak 0, casual-regression browser PASS,
  RPC-security-sweep PASS, live 14-ins invariance proven. *Operator owes the real-iPhone board
  test (Hard Rule 13) — confirm board renders + Plus One appears after a rollover.*
- **S2 — Returning-guest picker: ✅ SHIPPED (session 72, mig 217).** New
  `reactivate_guest_player(p_token, p_guest_id)` RPC (dedicated sibling, not an `add_guest_player`
  overload) brings a dormant team guest back: re-attaches `guest_of` to the calling host,
  `status='in'`, `team=NULL`, fresh per-week payment baseline, **keeps accumulated stats +
  player_match history**. PlayerView Plus One form gains a "Bringing someone back?" picker
  listing `squad.filter(isDormantGuest)` (no new fetch — dormant guests are already in the S1
  squad payload); tap a chip to re-activate, or use the existing name input for a new guest.
  EV 6/6 + leak 0 (stats/history preserved, payment reset, re-attach, bad-id + non-guest
  rejected), casual-regression browser PASS (empty-picker path byte-identical for teams with no
  dormant guests), RPC-security-sweep PASS, build clean, hygiene 7/7. *Operator owes a real-team
  eyeball of the picker once a dormant guest exists (next rollover) + Hard Rule 13.*
- **S3 — Promotion + self-claim: ✅ SHIPPED (session 72, mig 218).** Both routes land on the SAME
  row (history carries over). **Admin:** new `admin_promote_guest(p_admin_token, p_guest_id)`
  (resolve_admin_caller → VC parity) flips `is_guest=false, guest_of=NULL`, keeps token/status/
  stats/history; SquadScreen kebab gains a green "Make permanent" item; the admin "Guests" filter
  now shows dormant past guests too (DORMANT pill); "Copy personal link" enabled for guests so the
  admin can send the claim link. **Self-claim:** `link_player_to_user` gains a GATED promote-on-link
  branch — a guest sent their own `/p/<token>` link signs in and that row is promoted+linked (the
  token IS the identity, no name-matching); regulars are untouched (`is_guest=false` skips the
  branch). New `promoteGuest` wrapper + barrel. EV 5/5 + leak 0 (admin promote keeps stats/history/
  token; self-claim promotes a guest but leaves a regular's link unchanged; bad-token + non-guest
  rejected), casual-regression browser PASS, RPC-security-sweep PASS, build clean, hygiene 7/7.
  *Auth RPC touched → operator owes real-iPhone test (Hard Rule 13): sign in via a guest link →
  becomes permanent; and a normal sign-in still works.* **Guest link distribution UX** (a dedicated
  "send claim link" button vs the copy-link menu item) can be polished later if needed.
- **S4 — Legacy display:** already-deleted guests (e.g. 2 Jun match) are gone for good — show
  "Guest" for any unresolved `p_…` roster id (HistoryView). Handles orphaned history forever.
- **S5 — Stats verification: ✅ SHIPPED (session 72, mig 219).** Audit confirmed the PRIMARY team
  reliability/stats table (both routes — `getPlayerLeagueTable` + StatsView, and its derived
  POTM-awards/top-scorer/win%/bibs leaderboards) already excludes guests via `is_guest` filters
  that read the LIVE flag, so a promoted guest auto-appears (decision 2 core guarantee). Closed two
  gaps the audit surfaced: (1) **MY IO reliability ranking** (`deeperIntel.reliabilityRanking`)
  filtered nothing → now `.filter(p => !p.isGuest)`; (2) **POTM** — `get_potm_voting_state` already
  excluded guests from the nominee list, but `submit_potm_vote` / `get_potm_tally` /
  `admin_close_potm_voting` didn't enforce it (mig 219): guest nominee rejected
  (`nominee_not_eligible`), guests dropped from the tally, guest winner refused
  (`winner_not_eligible`) — all keyed on the live `is_guest` flag so a promoted guest is eligible
  automatically. EV 6/6 + leak 0 (guest barred as nominee/tally/winner; promoted guest counts),
  RPC-security-sweep PASS, build clean, hygiene 7/7. **Remaining (low, documented in BUGS):** the
  Gaffer AI-context RPC `gaffer_get_context_team_summary` top-reliable list doesn't filter guests
  (AI context only, not a user-facing table) — deferred.

**PERSISTENT GUESTS EPIC — ✅ COMPLETE (S1–S5, session 72).** Guests persist as dormant rows,
returning-guest picker, promotion (admin + self-claim via token link), legacy "Guest" display,
and stats/POTM exclusion-until-promoted all shipped. *Operator owes the real-iPhone passes flagged
per slice (Hard Rule 13): board + Plus One (S1), picker (S2), guest-link sign-in promotion (S3).*

**Reverses:** migs 207 (guest delete) + 209 (guest child cleanup) — superseded by the dormant
model. Their orphan-cleanup value remains for the already-deleted past guests.

---

## LEAGUE MODE — ROADMAP & VENUE-SURFACING GAPS (noted session 55, updated 56)

**Phase 5 COMPLETE. Phase 4 COMPLETE** (reception display). **Phase 9 COMPLETE** (email + SMS/WhatsApp transport + reminder crons + player channel fallback + HQ weekly digest — session 66). **Phase 6 functionally complete** (Cycle 6.1–6.5 — session 60). **Phase 11 cups COMPLETE** (single-elim session 65; group→knockout session 66).

**BUILD ORDER 9 → 6 → 11 — ✅ ALL THREE COMPLETE (session 66).** Next candidates (operator's
call): Phase 7 (AI layer) · `apps/display` redesign + Phase 4 device-test/deploy · Phase 10 (public
league pages). Detail of the completed 9/6/11 work retained below for reference.

**ORIGINAL BUILD ORDER (operator, session 58): 9 → 6 → 11** (methodical, not number order):
1. **Phase 9 (finish)** — ✅ email (9.1) · ✅ SMS/WhatsApp Twilio transport core (session 59,
   unwired) · ✅ fixture-reminder / 48h availability crons (session 59 — close the loop Phase 5
   left open: competitive availability exists but nothing reminded the squad) · ✅ **`_sms.js`
   wired for ref assignment** (session 65 — `ref_assigned` routes through `pickChannel` honouring
   `match_officials.preferred_channel`, whatsapp→sms→email fallback; `apps/inorout/api/cron.js`
   only, no DB/RPC/UI). ✅ **player contact-capture** (session 65, mig 189) — `set_player_contact`/
   `get_my_contact` + a NOTIFICATIONS section in PlayerProfile (phone + channel preference). ✅ **fallback
   wired (session 65):** the 48h/2h reminder crons now route each player via `pickChannel`
   (push→email→SMS/WhatsApp) — push through `/api/notify`, email via `_mailer`, SMS/WhatsApp via `_sms`,
   each logged to `notification_log` with its channel; league reminder email templates added. ✅ **HQ
   weekly digest (session 66)** — the last Phase 9 piece. `hq_get_analytics_for_company` (mig 190,
   service-role sibling of `hq_get_analytics`) + a `hqWeeklyDigest` `_mailer` template + `weeklyDigestJob`
   in cron.js: per-company "state of the group" email to super_admins, Monday 08:00 UK, previous-week
   range, dedup via `notification_log` keyed `company_id:weekStart`. **Template-first; the AI narration
   of the same dataset rides Phase 7** (see DECISIONS). **Phase 9 is COMPLETE.** *Operator owes a
   real-delivery test once `TWILIO_*` env is set (SMS no-ops until then) + a Monday digest delivery
   eyeball once `RESEND_API_KEY` is live.*
2. **Phase 6 (HQ dashboard)** — company-level cross-venue surface; data already flows
   up but nothing reads it. ✅ Cycle 6.1 (session 60): apps/hq app + auth/caller-resolution
   + company-state/drill-down/incident-resolve RPCs + Venue Health Grid + Alerts. ✅ Cycle 6.3
   (session 60): **composable analytics** — `hq_get_analytics` + per-admin saved layouts +
   6-card registry + presets + edit mode (Layer A; the AI composes over this in Phase 7).
   ✅ Cycle 6.4 (session 60): **live activity feed** (centre column) — cross-venue tonight's
   fixtures + live scores + goals ticker + per-venue realtime subscriptions.
   ✅ Cycle 6.5 (session 60): **HQ preview token** — 7-day no-login watermarked read-only link
   (`/hq/preview/TOKEN`) + super_admin Share-preview button. ✅ **HQ weekly digest shipped (session 66)** —
   the deferred Phase 9 cycle landed here as planned (`hq_get_analytics_for_company` mig 190 + cron
   `weeklyDigestJob` + `hqWeeklyDigest` email). **Phase 6 functionally complete** (6A–6E shipped).
3. **Phase 11 (cups & knockouts)** — most cross-cutting (fixtures/standings→brackets/
   ref/display/player); last, when other surfaces are stable. `cup_rounds` +
   `generateCupBracket` were groundwork. **Scope (session 65): single-elimination
   end-to-end first; ties decided by ref-entered extra-time and/or penalties; bracket
   shown on venue+player+display.** ✅ **Cycle 11.1 (session 65):** bracket persistence —
   `cup_ties` tree (mig 184) + `venue_persist_cup_bracket` (mig 185) builds the whole
   single-elim bracket (canonical seeding, byes, feeder edges, round-1 fixtures+charges)
   server-side; SeasonWizard single-elim branch wired. ✅ **Cycle 11.2 (session 65):** the
   bracket comes alive — decider columns (mig 186) + `_cup_advance` sweep & `cup_advance_after_result`
   trigger (mig 187) propagate winners into parent ties (decisive score, ref ET/pens, walkover,
   forfeit) and mark next ties `ready`; `ref_record_knockout_decider` + `ref_confirm_full_time`
   level→`needs_decider` change + ref `DeciderModal`; `venue_schedule_cup_tie` (operator schedules
   each round). ✅ **Cycle 11.3 COMPLETE (session 65):** `get_cup_bracket` read RPC (mig 188) +
   bracket on all three surfaces — **venue** `BracketView` (Cups tab + per-round scheduling),
   **player** `BracketOverlay` (modal from the FIXTURES "Bracket" button, self-gating), **display**
   `BracketZone` (replaces standings for cup competitions in the rotation). **Phase 11 (single-elim
   cups) COMPLETE** — create → play → ET/pens decider → advance → schedule → view, end to end.
   ◀ **Cycle 11.4a IN PROGRESS (session 66): group stage** — one competition, `format='group_stage'`
   owns both phases. `competition_teams.group_label`+`seed` / `fixtures.group_label` / `competitions.config`
   (mig 191) · `venue_persist_group_stage` (mig 192 — snake draw + server round-robin) · `get_group_standings`
   (mig 193) · SeasonWizard group_stage branch + group tables on venue/player/display. **Cycle 11.4b NEXT:**
   knockout-from-groups. ✅ **Cycle 11.4b (session 66):** extracted `_cup_build_bracket` (shared by single-elim
   + group seeding), `venue_seed_knockout_from_groups` (mig 194 — seeds the bracket from final standings,
   cross-group), `get_cup_bracket` extended with `groups`/`all_groups_complete`/`knockout_seeded`, and a
   "Build knockout" button in venue BracketView (gated on all-groups-complete). **Phase 11 group→knockout
   COMPLETE** — create groups → play → standings → Build knockout → ET/pens decider → advance → champion,
   end to end. Settled: single-competition model · auto snake-seed draw (operator-overridable) · manual
   Build-knockout trigger (see DECISIONS). *real-device player check owed (hard-rule #13).*

**After these three:** Phase 7 (AI layer — Ask the Gaffer evolved) · Phase 10 (public
league pages). **Phase 8 (billing/self-serve) deferred to year 2.** Also outstanding:
`apps/display` layout redesign + Phase 4 operator device-test/deploy.
*(This supersedes the earlier "Phase 7 is the next major" pointer — see DECISIONS session 58.)*

**Backlog — Venue Payments Ledger (scoped session 60, NOT built):** venue-side money owed/collected
for pitch bookings + league/cup fixtures (per team) — unified ledger, cash + manual transfer now,
online staged (hosted `venues.payment_link` → Stripe Connect + Apple/Google Pay in V5). Full plan +
data model + cycles V1–V5 in **`VENUE_PAYMENTS_SCOPE.md`**. Separate from Phase 8 SaaS billing.

---

## HQ INTELLIGENCE — TRACK ROADMAP (scoped session 61, 2026-05-30)

Positioning: **"Venue Intelligence, not venue reporting."** HQ answers *which venues are healthy,
what needs action, what HQ should do next* across six dimensions. This is the **evolution of Phase 6**
(the HQ foundation shipped in 6.1–6.5), layered as new 6.x cycles + the existing Payments V-track, not
a new app. Recorded here so the phase numbering stays reconciled (no competing schemes).

**HQ-I Phase 0 — Foundation** ✅ *shipped (Phase 6.1–6.5, session 60).* apps/hq, OAuth + `company_admins`,
role/region scoping, Venue Health Grid (🟢🟡🔴), venue drill-down, Alerts/Actions rail, composable
analytics (6-card registry + saved layouts), live activity feed, preview token. The canvas — not rebuilt.

**HQ-I Phase 1 — Venue Judgment** ◀ *scoping/building now (new cycles 6.6–6.7).* The first true
"intelligence not reporting" layer, on data that exists today:
- **Health Score /100** — upgrade the red/amber/green dot to a transparent scored model + "top reason"
  line, built only from existing inputs (utilisation, fixture completion, incidents); explicitly states
  what it can't yet weigh (revenue, churn). Consumes the utilisation RPC → builds *after* it.
- **Utilisation Intelligence** — new read RPC over the booking tables (`pitch_bookings`,
  `pitch_occupancy`, `playing_areas`): overall / prime-time / off-peak %, empty prime-time hours,
  best/worst days & slots; new panel + columns into the existing comparison surfaces.
- **Parallel foundation track:** Venue Payments Ledger **V1–V3** (schema + recording UI) — quietly
  starts money data accumulating so revenue can join later without a cold start. NOT the focus.
- *Deferred within Phase 1:* Weekly Brief, revenue UI.

**HQ-I Phase 2 — Revenue & Leakage** *(= Payments Ledger V4, lights up once V1–V3 data accrues).*
Revenue + collection columns into `hq_get_analytics`/comparison/overview; Revenue Leakage Radar
(unpaid balances, failed payments, empty prime-time → £, unfilled league spaces, at-risk team value);
feeds revenue back in as a Health Score input. **No faked revenue in production — demo-flag only.**

**HQ-I Phase 3 — Competition & Team Risk** *(new 6.x).* Active/new/withdrawn teams, teams at risk,
league fill rate, fixture completion by league, blowout% vs close-game%, early renewal-probability
(only once season-over-season data exists).

**HQ-I Phase 4 — The Analyst (Weekly HQ Brief)** *(the deferred "HQ weekly digest" cycle + Phase 7 AI).*
Generated weekly brief (group performance, best/weakest venue, leakage, opportunities, risks, actions),
built on the **Gaffer AI layer** (`GAFFER.md`) over `hq_get_analytics` — not a parallel template engine.
In-app first, then scheduled email digest (cron + Resend). Approach (AI vs template) **decided later.**

**HQ-I Phase 5 — The Moat** *(out for the foreseeable; = the original "exclude" list).* Player migration
map, cannibalisation detection, venue twins, dynamic pricing, referee performance impact, full player
cluster analysis, individual player intelligence, full financial forecasting, advanced AI recommender.

*Shape: 0 built → 1 (now) → 2 → 3 → 4 → 5 (someday). Phases 2–5 are a direction, not a commitment —
scope locks phase-by-phase. Revenue is 1 of 6 dimensions, not the spine.*

### HQ-I PHASE 1 CYCLE 1 SHIPPED — prime-time windows (session 61, 2026-05-30)

The peak-hours foundation for utilisation. Venues now mark per-pitch prime-time bands so HQ
(Cycle 2) can split prime vs off-peak.

- **mig 176** — `playing_areas.prime_time_windows jsonb DEFAULT '[]'` (additive, metadata-only add);
  `venue_update_pitch` gains a `prime_time_windows` validate+write block (`[{day_of_week 0-6,
  start_time, end_time}]`, no slot_lengths — it's a band); `venue_get_state` exposes the new key in
  the pitches projection. Both functions rebuilt on their **LIVE bodies** (135 / 168) — all existing
  keys preserved (display_token/display_config/bookings_enabled/cancellation_policy verified intact).
- **apps/venue** — BookingSettings modal gains a "Prime-time hours" section per pitch (day + start +
  end rows), saved via the existing `venueUpdatePitch` (no new wrapper, no barrel change).
- **Verified:** rpc-security-sweep (both SECDEF/search_path/1-overload/anon+authenticated, no PUBLIC) ·
  ephemeral-verify rolled back (valid persist · booking_windows untouched · inverted+bad-day rejected ·
  zero leak) · post-apply regression read (all mig-168 fields intact + new key) · hygiene 7/7 ·
  apps/venue build clean. Decision: prime-time venue-configurable (DECISIONS session 61).
- **Operator owes:** real venue-dashboard test — open Booking settings, add a peak window, save,
  reload, confirm it persists (hard-rule #13; apps/venue is not in PWA scope but UI-save is untested).

**Cycle 1.1 (same session) — venue-level default prime band.** Decision: a pitch with no
prime_time_windows INHERITS a venue default (not off-peak, not a hardcoded global). **mig 177** —
`venues.default_prime_time_windows jsonb`; `venue_update_booking_settings` gains a
`default_prime_time_windows` validate+write key; `venue_get_state` exposes it in the venue object
(rebuilt on the live mig-176 body — pitch prime/booking keys + display/bookings fields all verified
intact). BookingSettings modal gains a "Venue default (all pitches)" editor above the now-optional
per-pitch overrides. Cycle 2 resolution: pitch.prime_time_windows if set, else venue default, else
off-peak. Verified: rpc-security (both SECDEF/search_path/1-overload/anon+authenticated) ·
ephemeral-verify rolled back (default persists · bookings_enabled/cancellation_policy untouched ·
inverted+bad-day rejected) · regression read · hygiene 7/7 · build clean.

### HQ-I PHASE 1 CYCLE 2 SHIPPED — hq_get_utilisation (session 62, 2026-05-30)

The utilisation intelligence read layer over `pitch_occupancy` + `playing_areas`.
**mig 178** — `hq_get_utilisation(p_company_id, p_date_from, p_date_to)`:
SECURITY DEFINER, search_path pinned, STABLE, anon-denied, authenticated-only,
read-only (no audit/broadcast). Authorisation + region scoping reuse
`resolve_company_caller` (regional_admin restricted to its own region, mirroring
hq_get_analytics).

- **Locked metric rules (operator, session 61):** used = fixtures + CONFIRMED
  bookings from pitch_occupancy (`source_kind IN ('fixture','booking')`, active);
  **maintenance excluded**; **requested** bookings surfaced separately, never
  counted. Available = each pitch's `booking_windows`, else 08:00–22:00 all week
  flagged "assumed". Prime/off-peak per pitch = `prime_time_windows` else
  `venues.default_prime_time_windows` else "not_configured" (prime/offpeak left
  NULL — never guessed). Default range = trailing 28 days, optional from/to.
- **Model decisions (operator, session 62):** usage **clipped to opening hours**
  via a 30-min bucket grid (utilisation always 0–100%, empty-prime always ≥0);
  assumed-availability fallback spans all 7 days 08:00–22:00; best/worst **day =
  day-of-week**, best/worst **slot = hour-of-day**. Local time = Europe/London
  (occupancy ranges read back AT TIME ZONE to match local-time windows).
- **Returns** per-pitch + per-venue + company rollup: overall %, prime %,
  off-peak %, available/used hours, empty prime hours, best/worst day, best/worst
  slot, fixture/booking source split, requested hours; plus range/caller/assumptions.
- **Verified (read-RPC, ephemeral-verify not mandated):** rpc-security
  (SECDEF · search_path · 1 overload · anon-denied · authenticated-granted) ·
  live functional run vs company_demo (used 4.0h matched raw occupancy; source
  split 2.0/2.0; available 784.0 = 2 assumed pitches × 14h × 28d; overall 0.5%) ·
  BEGIN…ROLLBACK probe proving prime path (prime_avail 168.0, prime_used 3.0,
  empty 165.0, off-peak_used 1.0 — the 20:30–21:30 fixtures correctly straddle
  the 18:00–21:00 band) **and that a requested booking (1.0h) does NOT inflate
  used** (stayed 4.0); rollback confirmed clean (0 prime / 0 requested left) ·
  `hqGetUtilisation` wrapper + barrel export · apps/hq build clean.
  (Note: commit 48fea84's message cites pre-probe placeholder figures
  2.0/166.0/2.0; the live-verified values above supersede them.)
- **Wrapper:** `hqGetUtilisation(companyId, dateFrom=null, dateTo=null)` in
  packages/core/storage/supabase.js + barrel. **Downstream consumers (hard-rule
  14):** Cycle 3 UtilisationPanel.jsx + registry card; Cycle 4 Health Score /100
  input. A return-shape change must check both before shipping.
- **Next = Cycle 3:** utilisation frontend (registry card + dedicated
  UtilisationPanel.jsx). Cycle 4 = Health Score /100 upgrade in hq_get_company_state.

### HQ-I PHASE 1 CYCLE 3 SHIPPED — utilisation frontend (session 62, 2026-05-30)

The two surfaces for `hq_get_utilisation` (Cycle 2). **apps/hq only — no DB, no RPC
change.** Built to apps/hq's actual visual language (`.analytics` / `.acard` /
`.chips`+`.chip` / `.atable` + `--font-mono` numerals; tokens `--text-muted`,
`--warn`, `--good`, `--danger`); the few novel bits (util bar, expand caret, tags)
use inline styles, so no styles.css change was needed.

- **Dedicated `UtilisationPanel.jsx`** (default export, self-loading on `companyId`
  like AnalyticsView) — new **"Utilisation" nav button** in App.jsx (third tab,
  between Dashboard and Analytics; rendered via the existing view ternary, not a
  registry). Company `.chips` headline (overall/prime/off-peak used %, empty prime
  hours, used-of-available, busiest/quietest slot, requested-pending) + a per-venue
  `.atable` with a mini util bar that **expands on row-click to per-pitch detail**
  (overall/prime/off-peak %, empty prime, used hours, fixture/booking split,
  assumed-hours tag). Honest about gaps: shows "not set" + a hint when prime isn't
  configured (never guesses); flags assumed-availability pitches.
- **Registry card `utilisation`** — added to AnalyticsView's `ALL_CARDS` +
  `CARD_TITLES` (selectable in the Customise-dashboard editor). AnalyticsView now
  also self-loads `hqGetUtilisation`; new `UtilCard` (compact `.chips`:
  overall/prime/off-peak %, empty prime + busiest/quietest line) rendered via the
  `CardBody` switch, threaded through a new `util` prop.
- **No styles.css change** — the panel and card lean entirely on existing classes
  (`.analytics`/`.acard`/`.chips`/`.atable`) plus inline styles for the util bar,
  caret and tags, so the stylesheet was untouched.
- **Verified:** apps/hq build clean (84 modules transformed, exit 0); every field the components read (overall_pct,
  prime_pct, offpeak_pct, empty_prime_hours, used/available_hours, prime_configured,
  requested_hours, best/worst day+slot, prime_source, assumed_availability,
  source_split, range) cross-checked against the live Cycle-2 RPC output shape.
  **Operator owes:** logged-in browser pass (HQ is Google-OAuth gated; visual smoke
  can't run headless).
- **Correction note:** an earlier draft of this cycle was written against a
  hallucinated apps/hq structure (non-existent AnalyticsCard.jsx / `.stat-grid` /
  VIEWS array); those edits failed to apply and nothing was committed. This entry
  reflects the actual, built implementation.
- **Next = Cycle 4:** Health Score /100 + top reason in `hq_get_company_state`,
  consuming the utilisation RPC + (deferred) `_hq_venue_health_score` helper.

### HQ-I PHASE 1 CYCLE 4 SHIPPED — Health Score /100 + top reason (session 63, 2026-05-31)

The last locked Phase-1 cycle. Upgrades the categorical red/amber/green dot in
`hq_get_company_state` into a transparent **scored model** — completes "Venue Judgment".
**mig 179.**

- **Model (operator-locked):** three axes, each 0–100 —
  **operations** = `100 − 40·critical − 10·(open−critical) − 8·unallocated − 5·unassigned_refs`,
  floored at 0 (always present);
  **utilisation** = `min(100, overall_pct × 2)` (50% used = full marks), from the Cycle-2
  RPC, NULL when no measurable utilisation;
  **fixture_completion** = `round(100·completed/(completed+remaining))`, NULL when no
  fixtures yet. Weights **ops 0.40 / util 0.30 / completion 0.30**; a **missing axis is
  dropped and the remaining weights renormalised** (never invents a number) via the new
  helper `_hq_health_score(ops,util,completion)` (IMMUTABLE, search_path pinned).
- **Band:** score ≥80 green · ≥55 amber · else red. **Hard-red overrides** (force red + own
  reason regardless of score, carried over from the old logic): critical incident open,
  subscription past_due/cancelled, expired trial.
- **top_reason** = the weakest present axis, phrased for a human (override reason wins).
  Explicitly **NOT yet weighed: revenue, churn** (no data — stated, not faked).
- **Return-shape additions (additive, hard-rule #12):** each venue gains
  `health_score int|null`, `health_reason text`, `health_axes {operations, utilisation,
  fixture_completion}`. Existing `health` field retained (now band+override-derived). Wrapper
  `hqGetCompanyState` passes data through raw (no mapper). **Only consumer:** apps/hq
  `VenueHealthGrid` — now renders the score next to the dot + a reason line.
- **Verified live (company_demo):** rpc-security (hq_get_company_state SECDEF/search_path/
  1-overload/anon-denied/auth-granted; helper IMMUTABLE/search_path/not-secdef) · helper unit
  cases (100,50,80→79 weakest util; 100,NULL,80→91 renormalised weakest completion;
  60,NULL,NULL→60; NULL×3→null) · functional run (Demo Arena South green 100 "all healthy",
  axes ops100/util—/comp—; Demo Sports Centre **red 30 "Critical incident open"** hard-red
  override firing over axes ops19/util1.2/comp73) · apps/hq build clean (84 modules, exit 0).
  **Operator owes:** logged-in browser pass (HQ OAuth-gated).
- **Phase 1 (Venue Judgment) COMPLETE** (cycles 1, 1.1, 2, 3, 4). Next track: HQ-I Phase 2
  (Revenue & Leakage = Payments Ledger V-track) or Phase 3 (Competition & Team Risk).

### VENUE PAYMENTS LEDGER V1 SHIPPED — schema (session 63, 2026-05-31)

Groundwork for HQ-I Phase 2 (Revenue & Leakage) — starts money data accruing so revenue can
join HQ later without a cold start. **Schema only per VENUE_PAYMENTS_SCOPE.md — no RPCs (V2),
no UI (V3).** **mig 180.**

- **Two-table unified ledger:** `venue_charges` (what's owed — one row per booking, per-team per
  fixture; venue/team/competition/period sliceable) + `venue_payments` (instalment log; each
  payment/refund a row; soft-void via `voided_at`). Status/balance derived from non-voided
  instalments vs amount due. Online shares the ledger later (a non-cash row) — no redesign.
- **Fee config:** `league_config.fixture_fee_pence` + `fixture_fee_payer` (both|home),
  `playing_areas.default_fee_pence`, `venues.payment_link` (interim hosted online-pay URL).
- **RPC-only:** RLS on both tables, anon/authenticated revoked (V2 adds SECDEF RPCs).
- **Demo seed (demo_venue only, forward-only):** 24 charges (2 booking, 22 fixture) across
  paid:8/partial:8/unpaid:8 + 16 instalments (cash:8, bank_transfer:8); owed £540 / collected
  £255 so V3/V4 collection-rate reports are testable; production untouched (non-demo charges = 0).
- **Verified live:** structural (2 tables · COALESCE unique index · 4 fee/link columns · RLS on ·
  anon/auth revoked) + seed sanity (status mix · 2 methods · owed/collected totals). No RPC/JS
  this cycle, so rpc-security/ephemeral-verify/build N/A.
- **Next:** V2 = charge auto-creation hooks + `venue_record_payment`/`venue_void_payment` RPCs
  (→ ephemeral-verify); V3 = apps/venue Payments screen; V4 = HQ revenue/collection cards
  (= HQ-I Phase 2).

### VENUE PAYMENTS LEDGER V2 SHIPPED — RPCs + charge hooks (session 63, 2026-05-31)

Write layer over the V1 ledger. **Server-only — no JS/UI (wrappers + screen = V3).** **mig 181.**

- **4 RPCs** (SECDEF · search_path pinned · `resolve_venue_caller` · audited · notify):
  `venue_record_payment` (append instalment + recompute status), `venue_void_payment` (soft-void
  + recompute), `venue_set_charge_due` (override due + recompute), `venue_get_charges` (read:
  charges + balances + collection-rate summary). Shared helper `_recompute_charge_status`
  (non-voided instalments vs due; preserves terminal `refunded`).
- **3 charge auto-creation hooks** (rebuilt on LIVE bodies): `venue_confirm_booking` → booking
  charge (booking.amount_pence else `playing_areas.default_fee_pence`; **skip when no fee** —
  operator decision), `venue_generate_fixtures` → per-team fixture charges per `fixture_fee_payer`
  (skip when no fee), `venue_update_fixture_status` → on **void**, that fixture's charges set
  `refunded` (payments kept; postpone/walkover/forfeit untouched — operator decision).
- `notify_venue_change` whitelist += `payment_recorded`/`payment_voided`/`charge_updated`.
- **Verified live:** rpc-security (all SECDEF/search_path/1-overload/anon+auth; helper not-secdef)
  · **ephemeral-verify 8/8** (partial→paid→void→partial→set_due→paid · get_charges 54.4% rate ·
  bad-token rejected · refunded blocks payment · void refunds 2/2 fixture charges).
- ⚠️ **Incident (caught + fixed same cycle):** the EV result-capture variant committed instead of
  rolling back, mutating demo_venue (1 booking charge + 1 fixture + 3 charges). **Fully restored**
  to the V1 baseline (24 charges paid8/partial8/unpaid8, 16 payments, owed £540/collected £255,
  0 refunded) and verified. Lesson: an EV that needs to return a verdict must do so via
  `RAISE EXCEPTION verdict` (rolls back AND surfaces the result) — never a committed temp table.
- **Next:** V3 = apps/venue Payments screen (+ supabase.js wrappers, the JS binding deferred to
  here where there's a call site); then V4 = HQ revenue cards (HQ-I Phase 2).

### VENUE PAYMENTS LEDGER V3 SHIPPED — apps/venue Payments screen (session 63, 2026-05-31)

The operator-facing recording surface over the V2 RPCs. **Frontend-only — no DB/RPC change.**

- **4 supabase.js wrappers + barrel:** `venueGetCharges`, `venueRecordPayment`,
  `venueVoidPayment`, `venueSetChargeDue` (each: raw RPC name appears exactly once in
  supabase.js; camelCase wrapper + index.js export).
- **New "Payments" tab** in the venue Dashboard (third `view`, beside Operations/Bookings) →
  `PaymentsView.jsx`: Money summary (owed / collected / outstanding / collection-rate),
  status-filterable charge table (source · team · due · paid · balance · status), and a
  record-payment modal (amount + method cash/transfer/card/other + note) calling
  `venueRecordPayment`. Self-loads via `venueGetCharges`.
- **Scope (operator decision):** frontend on the 4 shipped RPCs only. Per-fixture charge
  add/void + `payment_link` show/edit → **V3.1** (each needs a new write RPC; note
  `venue_get_state` does NOT yet expose `payment_link`, so the link block in PaymentsView is
  inert until V3.1 adds it).
- **Verified:** apps/venue build clean (110 modules, exit 0); wrapper/raw-name/barrel/wiring
  cross-checked (defs=1, barrel=1, raw=1 each; PaymentsView imported + rendered). No write
  RPC added → ephemeral-verify N/A. **Operator owes:** logged-in venue-dashboard pass (token
  `demo_venue_token_DO_NOT_USE_IN_PROD`) — record a payment, see the balance + collection rate
  move.
- **Next:** V4 = HQ revenue / collection-rate / outstanding cards into the HQ analytics
  registry (= HQ-I Phase 2). Optional V3.1 first for per-fixture charge add/void + payment_link.

### VENUE PAYMENTS LEDGER V3.1 SHIPPED — per-fixture add/void + pay-link (session 64, 2026-06-01)

Finishes the operator's manual control over the ledger. **mig 183** (2 new write RPCs + 2 rebuilt).

- **`venue_add_fixture_charge(token, fixture_id, team_id, amount?)`** — manual per-team fixture
  charge (the "this team also pays" toggle). Amount = explicit arg or `league_config.fixture_fee_pence`.
  Validates fixture∈venue + team∈fixture. Idempotent vs `venue_charges_source_uniq`: a refunded
  charge for the same (fixture, team) is **reactivated** (status cleared off `refunded` then
  recomputed from kept payments) rather than duplicated.
- **`venue_void_charge(token, charge_id)`** — status → `refunded` (drops out of owed/collected),
  payments kept in history; mirrors the V2 fixture-void hook. Idempotent (`already:true` if voided).
- **`payment_link`** — added to the `venue_update_booking_settings` whitelist (validated `^https?://`,
  blank clears) and **exposed on `venue_get_state`'s venue object** (was missing — PaymentsView read
  `venue.payment_link` but it was always null).
- **apps/venue PaymentsView** — Add-charge modal (fixture + team + optional amount), per-row Void
  button, inline pay-link editor; fixed `teamName` to read the `state.teams` map (was looking up a
  non-existent `leagues[].teams`). 2 supabase.js wrappers + barrel. Minimal V3.1 CSS; full polish
  deferred to the venue design pass.
- **Verified:** **ephemeral-verify 13/13** against an `_e2e_` fixture (add-default · record-partial ·
  dup-rejected · void · reactivate→partial · add-away · get_charges owed4000/coll400/rate10 ·
  pay-link roundtrip · bad-token · team-not-in-fixture · amount-invalid · void-not-found ·
  bad-link), leak-check 0. **EV caught a real bug:** reactivation left status `refunded` because
  `_recompute_charge_status` preserves the terminal state — fixed by clearing to `unpaid` first.
  rpc-security 4/4 PASS (secdef+search_path+1-overload+anon/auth). venue + inorout builds clean;
  casual-regression PASS (packages/core change additive-only, no apps/inorout/src touched).
  **Operator owes:** logged-in venue pass (add a charge, void one, set the pay link).

### VENUE PAYMENTS LEDGER V4 SHIPPED = HQ-I PHASE 2 (Revenue & Leakage) (session 64, 2026-06-01)

Surfaces the V1–V3 ledger into HQ. **mig 182** (3 functions, all read/immutable — no write
RPC, so ephemeral-verify N/A). Revenue math mirrors `venue_get_charges` exactly so HQ agrees
with the apps/venue Payments screen.

- **New `revenue` analytics card** — `hq_get_analytics` gains a `revenue` block: company
  `owed_pence`/`collected_pence`/`outstanding_pence`/`collection_rate` + a `by_venue` breakdown
  (all scoped venues, region-filtered; optional date filter on charge `created_at`, all-time by
  default). AnalyticsView adds `"revenue"` to ALL_CARDS/CARD_TITLES, the `commercial` preset, the
  CardBody switch, and a `Revenue` component (chips + per-venue `.atable`, pence→£ formatter).
- **Revenue fed into the Health Score** — `_hq_health_score` gains a 4th axis (param-count change
  → old 3-arg signature DROPped first). Revenue axis = collection-rate %, weight **0.30**,
  **purely additive**: a venue with no charges (every production venue today) drops the axis and
  scores exactly as before. `hq_get_company_state` computes per-venue all-time collection rate,
  feeds it in, exposes `health_axes.revenue` + a top-level `collection_rate`, and a `revenue`
  `top_reason` ("Collecting X% of fees owed"). Hard-red overrides still take precedence.
- **Closed a latent gap:** mig-179's commit claimed it wired health_score/reason into
  VenueHealthGrid but the commit touched only SQL — the score was invisible in the UI. V4 wires
  the score badge (coloured by band) + reason line into VenueHealthGrid, so the revenue input is
  actually visible.
- **Verified live (company_demo, impersonated super_admin):** helper unit cases (additive: no-rev
  = unchanged 100; zero-rev → weakest=revenue); demo rollup £540 owed / £255 collected / £285
  outstanding / 47.2% (= V1 baseline); company_state — Arena South revenue axis null/score 100
  (no charges, additive), Sports Centre revenue 47.2/score 30→34 still red via critical override;
  analytics revenue block company + per-venue correct. rpc-security all 3 PASS (both RPCs
  secdef+search_path+1-overload+auth-only; helper not-secdef, old 3-arg cleanly dropped).
  apps/hq build clean (84 modules, exit 0). **Operator owes:** logged-in HQ browser pass.
- **Next:** HQ-I Phase 3 (Competition & Team Risk), or V3.1 (per-fixture charge add/void +
  payment_link), or V5 (Stripe Connect online rails).

---

## PAYMENT INFRASTRUCTURE — STRIPE CONNECT + GOCARDLESS FOR PLATFORMS (session 131)

Platform never holds money. Each venue/club connects their own Stripe or GoCardless account. Money flows club↔member directly. Platform orchestrates via API (`Stripe-Account` header / GoCardless for Platforms access token). Full decision rationale: DECISIONS.md "Payment infrastructure" entry.

**Phase 1 — Foundation** ✅ shipped s132 (mig 329, commit 5968af7)
- `venue_integrations` table: `venue_id`, `provider` IN ('stripe','gocardless'), `status` IN ('pending','connected','disconnected'), `account_id`, `access_token`, `config jsonb`, `connected_at`, `disconnected_at`, UNIQUE(venue_id, provider). RLS-walled, REVOKE anon/authenticated.
- Dropped dormant stripe_* columns from `venues` (mig 279 scaffolding, no live data). `venue_memberships`/`venue_customers` stripe columns untouched (per-membership state, not credentials).
- Rewrote `set_venue_connect_state` (now upserts into `venue_integrations`) and `venue_get_billing_status` (now reads both providers from `venue_integrations`; returns `stripe` + `gocardless` objects). Both SECDEF ✓, search_path ✓, overload=1 ✓.
- Fixed stale `stripe_connect_account_id` refs in `api/cron.js`, `api/stripe-connect.js`, `api/stripe-webhook.js` (all dormant Stripe scaffolding).
- `venueGetBillingStatus` wrapper + barrel. `IntegrationsView.jsx` + Integrations nav tab in venue dashboard (two provider cards, both "NOT CONNECTED"). Security sweep 2/2 PASS. Both builds clean.
- **Next mig = 330.**

**Phase 2 — Stripe Connect (venue side)** ✅ shipped s133 (mig 330, commit 69cdf65)
- `venue_stripe_disconnect(p_venue_token text)` RPC — SECDEF, anon+authenticated, idempotent. EV 5/5 PASS, leak-clean. Security sweep PASS.
- `api/stripe-connect.js` activated: CORS for `platform-venue.vercel.app`, OPTIONS preflight. Handles `action='onboard'` (Express account + account link) and `action='refresh'` (fetch-fresh from Stripe + update `venue_integrations`).
- `IntegrationsView.jsx`: Connect Stripe button → `POST /api/stripe-connect {action:'onboard'}` → redirect; return URL handler (`?connect=done/refresh` → refresh + reload); disconnect button → `venueStripeDisconnect` RPC. Graceful 503 if keys absent.
- `Dashboard.jsx`: auto-switches to Integrations tab on `?connect=*` return URL.
- **Env required (operator):** inorout Vercel: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_RETURN_URL`, `STRIPE_CONNECT_REFRESH_URL`. Venue Vercel: `VITE_INOROUT_API_URL=https://in-or-out.com`. Also add `STRIPE_CONNECT_ALLOWED_ORIGIN` if venue domain changes.
- **Next mig = 331.**

**Phase 3 — Stripe member enrolment + webhooks ✅ SHIPPED (mig 331, s135) — E2E VERIFIED s136 (4 bugs found+fixed: migs 332+335+336 + webhook Connect toggle). DORMANT for production until operator provides live Stripe keys.**
- `stripe_customer_id` on `venue_memberships` + UNIQUE partial index on `stripe_subscription_id`
- `get_venue_signup_tiers`: returns `stripe_connected` bool (derived from `venue_integrations WHERE provider='stripe' AND status='connected'` — mig 332 fixes original `'active'` which never matched)
- `get_member_pass`: returns `payment_state` (current/past_due/suspended)
- New RPC `stripe_complete_member_enrolment` (service_role ONLY, idempotent on subscription_id, called by webhook)
- New `api/stripe-member-checkout.js` — creates Stripe Customer + Checkout Session on venue's connected account, returns `checkout_url`
- `api/stripe-webhook.js` extended with `checkout.session.completed` arm → calls `stripe_complete_member_enrolment`
- `MembershipSignup.jsx` `StepEnrol` forks: paid + `stripe_connected` → Stripe Checkout redirect; `?checkout=done` on return sets step='done'
- `MemberPass.jsx` adds `PaymentStateBanner` (amber past_due / red suspended, zero-footprint when current)
- `supabase.js` adds `stripeInitMemberCheckout`; barrel export added
- Season period = `mode:'payment'` (one-time); monthly/quarterly/annual = `mode:'subscription'`
- All API routes env-guarded (503 when `STRIPE_SECRET_KEY` absent); UI fork activates only when `stripe_connected=true`
- EV 7/7 PASS + leak=0, security sweep 3/3 PASS, hygiene 7/7 PASS, build PASS
- **Blocked until operator:** adds 4 Stripe env vars to inor-out Vercel project + registers webhook `https://in-or-out.com/api/stripe-webhook`

**Phase 4 — Stripe test lifecycle + go live** ✅ LIFECYCLE PROVEN (session 137) *(go-live blocked on operator sign-off)*
- Stripe test clock created on `acct_1TiiBMETFLuZs6P2` (`clock_1Tir9kETFLuZs6P26l5r435Y`)
- **Scenario A ✅:** Clock advanced +1 month → Stripe auto-generated renewal invoice + charged → `invoice.paid` fired → `payment_state=current` confirmed
- **Scenario B ✅:** `past_due` status → `apply_membership_subscription_status` → `payment_state=past_due` → `get_member_pass` returns `payment_state:past_due` (amber banner in `MemberPass.jsx`)
- **Scenario C ✅:** `unpaid` status → `payment_state=suspended` → red banner
- **Scenario D ✅:** Recovery — `active` → `payment_state=current` (full round-trip)
- **Scenario E (bonus) ✅:** `canceled` status → `payment_state=suspended` + `status=cancelled` (dual-field — only `canceled` flips the `status` column)
- **Reconciliation cron ✅ PROVEN LIVE:** `membershipReconciliationJob` ran at 04:00 BST and logged `membership_payment_state` audit event on the real E2E subscription — fetches live from Stripe, heals DB regardless of webhook delivery
- **Auto-renewals ✅:** Stripe billing engine auto-generates and charges renewal invoices; our code handles `invoice.paid`; Stripe natively generates invoice objects (no custom PDF receipts needed from us)
- **Webhook delivery finding:** test clock events from Express connected accounts have delivery latency to platform Connect webhooks; `billing_events` stayed 0 during test; NOT a blocker — reconciliation cron is the truth source
- **Vercel project finding:** `platform-clubmanager` (not `inorout`) is the live serving project with full env vars (STRIPE_SECRET_KEY + SUPABASE_SERVICE_ROLE_KEY); both mapped to in-or-out.com
- **STILL OWED (go-live gate):** Operator signs off DECISIONS.md MONEY-FLOW GATE + swaps test keys for live keys in `platform-clubmanager` Vercel project (not `inorout`)

**Phase 5 — GoCardless connect (venue side)** ✅ BUILT s138 (mig 337, commit dc38596) — DORMANT until operator GC credentials
- `api/_gocardless.js` — GoCardless client (fetch-based, no SDK dep), per-venue access token; `isGcConfigured`/`gcClient`/`buildOAuthUrl`/`exchangeOAuthCode`/`verifyWebhookSignature` (HMAC-SHA256 via Node `crypto`)
- `api/gocardless-connect.js` — Partner OAuth: POST initiates consent (cap-gated `manage_memberships`), GET callback exchanges code → `set_venue_gc_connect_state` → redirect. CORS-locked, 503 when keys absent.
- `set_venue_gc_connect_state` + `venue_gc_disconnect` RPCs (SECDEF, search_path ✓, overload=1 ✓)
- IntegrationsView "Connect GoCardless"/disconnect button + `?gc_connect=done/error` return handler

**Phase 6 — GoCardless member mandate + webhooks** ✅ BUILT s138 (mig 337, commit dc38596) — DORMANT until operator GC credentials
- `api/gocardless-mandate.js` — POST creates redirect flow on venue's account (auth via Supabase Bearer, guardian check for child enrolments) → returns hosted URL; GET callback completes flow (mandate confirmed synchronously) → `gc_complete_member_enrolment` → redirect to pass
- `api/gocardless-webhook.js` — persist-then-process: `verifyWebhookSignature` → `record_gc_event` (idempotent, partial unique index on `gc_event_id`) → dispatch `apply_gc_payment_status` for payment/mandate events → `mark_gc_event_processed`. Always 200.
- `apply_gc_payment_status` state machine: `payments.confirmed/paid_out → current`, `payments.failed/charged_back → past_due`, `mandates.cancelled/expired/failed → suspended + status='cancelled'` — same vocabulary as Stripe
- `gcMembershipReconciliationJob` (cron.js, 04:15 UK — 15 min after Stripe) fetches live mandate status per active membership, re-applies via synthetic event, self-heals dropped webhooks
- RPCs: `gc_complete_member_enrolment`, `apply_gc_payment_status`, `record_gc_event`, `mark_gc_event_processed` (all SECDEF service_role-only, sweep 7/7 PASS). Schema: `venue_memberships.gc_mandate_id`/`gc_customer_id`, `billing_events.gc_event_id` + partial unique index.
- ⚠️ **NOT yet run against any real GC environment** — code structurally mirrors the proven Stripe path but GC API shapes (redirect-flow completion, event `links` resolution, `webhook-signature` header) are assumptions until Phase 7 sandbox proof.

**Phase 7 — GoCardless test lifecycle + go live** ⏳ DORMANT — the one real engineering task remaining *(blocked on operator GC for Platforms approval)*
- Operator applies for GoCardless for Platforms (approval can take days; can be rejected)
- Add env: `GC_CLIENT_ID`, `GC_CLIENT_SECRET`, `GC_WEBHOOK_SECRET`, `GC_ENVIRONMENT` to **platform-clubmanager** Vercel; register webhook → `https://in-or-out.com/api/gocardless-webhook`
- Full sandbox lifecycle proof (GC equivalent of Phase 4 Stripe test clock): venue OAuth connect → member mandate → first payment → failure → recovery → deliberate mandate cancel → confirm reconciliation heals each state
- Operator sign-off → live keys

**Phase 8 — Member payment choice** ✅ BUILT s138 (mig 337, commit dc38596)
- `get_venue_signup_tiers` now returns both `stripe_connected` and `gc_connected`
- `MembershipSignup.jsx`: `StepPaymentChoice` (card vs Direct Debit) shown when both connected + paid tier; auto-routes when only one provider; free tier bypasses. `StepGcEnrol` drives the GC redirect. `?gc=done/error` return handling.
- ⏳ Live behaviour unproven until Phase 7 (both providers active in one venue)

**Use case mapping (settled):** memberships → either provider (member's choice if both connected); match fees / tournament entries / equipment deposits → Stripe only (one-off, card/Apple Pay).

**Build dependency:** Phases 1–4 ship and go live independently of 5–7. Phase 8 requires both. **All 8 phases now BUILT in code (next mig = 338); what remains is operator-gated activation + the Phase 7 GoCardless sandbox lifecycle proof.**

---

## LEAGUE MODE — PHASE 4 RECEPTION DISPLAY SHIPPED (session 57, 2026-05-29)

> ⚠️ **LAYOUT REDESIGN — WIREFRAME ONLY, NOT FINAL (operator, session 73).** A first
> "premium broadcast" re-skin pass shipped session 73 (generated monogram crests,
> last-5 form guide, live-card lower-thirds, League-Leaders idle podium, sponsor slot,
> stylised pitch backdrop — all over the SAME payload). **The operator judged the
> result not good enough ("looks awful") and asked to leave it as a wireframe baseline;
> the FINAL visual design is a later session.** What IS done and keepable: the data
> layer additions (mig 221 `form`), the component structure, and the crest/form/idle
> mechanics. The DB/RPC/realtime layer (migs 164–168 + 221, `get_display_state`,
> `venue_live`, venue config editor) is stable. **Deferred to the final-look session:**
> sponsor-image upload in venue settings (Stage 2 — backend confirmed: `sponsor_image_url`
> already persists via `display_config`, just needs the venue uploader) AND deploying
> `apps/display` to its own Vercel project + `VITE_DISPLAY_APP_URL` (Stage 4 — don't put
> an unfinished look on a real venue TV). Do not treat the current layout as final.
>
> Original session-57 note: the operator first judged the layout "too plain"; the
> session-73 pass was the response, still not the final article.

The venue big-screen (`/display/TOKEN`) — a TV-targeted, PIN-gated, white-labelled
live scoreboard for **all** competitions at a venue, updating in real time off the
existing `venue_live` broadcast. Built in four committed stages.

- **Product decisions (operator):** new `apps/display` app (not a venue route);
  **venue-scoped** on a new `venues.display_token` (never the admin token);
  **client-side** PIN lockout (PIN never leaves the server); **confirmed + live
  provisional** standings both shipped; venues **configure panels now**; default
  **composite "Live-led split"** layout (multi-zone, supersedes single-panel cycle).
  See DECISIONS.md (session 57).
- **Stage A — server (migs 164–167, `4c0f08b`):** `venues.display_token` +
  `display_config` + read indexes; `get_display_state` (lifts the proven standings
  engine + a live pass folding in-progress scores; top scorers; live fixtures;
  today's upcoming/recent; goals ticker; returns `live_channel_key`, never the PIN);
  `check_display_pin` (read-only); `venue_update_display_config` (operator write).
  rpc-security-sweep + ephemeral-verify + casual-regression all PASS.
- **Stage B — `apps/display` (`c3087e8`):** standalone Vite SPA. Client PIN gate
  (3 wrong → 30-min localStorage lockout); `get_display_state` + `venue_live`
  realtime (verified: a ref goal flipped the score live with no reload) +
  auto-reconnect + 60s fallback + screen wake-lock. **Broadcast-grade UI** (Sky
  Sports / UCL bar): Bebas Neue scoreboard numerals, floodlight vignette + grain,
  team-colour accents, Framer Motion (score-flip, standings reorder physics, live
  card enter/exit, goals marquee). Live-led split layout; confirmed↔amber
  provisional standings w/ position deltas; golden-boot scorers; white-label;
  non-removable "Powered by In or Out".
- **Stage C — `apps/venue` settings (`2e1a9c4`, mig 168):** Dashboard ▸ "Reception
  display" modal — copyable display link, PIN set/clear, panel enable+reorder,
  Smart/Cycle/Fixed mode + interval, custom message. `venue_get_state` additively
  exposes `display_token`/`display_config`. UI save verified end-to-end.
- **Operator owes (hard-rule #13):** the **real-device test on an actual 1920×1080
  TV / large tablet** — wake-lock holds (screen doesn't sleep), auto-reconnect after
  a Wi-Fi drop, PIN flow + lockout, white-label colours. Browser smoke at 1920×1080
  passed (PIN, live broadcast score-flip, provisional standings); the physical-TV
  pass is the gate the static/browser checks can't cover.
- **Deferred:** Form column in standings (no RPC yet); display-token rotation
  (kill-switch); enterprise white-label removal of the "Powered by" mark; deploying
  `apps/display` to its own Vercel project + setting `VITE_DISPLAY_APP_URL` in
  apps/venue so the copied link is fully-qualified.
- **Testbed:** demo_venue `display_token='demo_venue_display_token'`, `display_pin='1234'`.

---

## LEAGUE MODE — PHASE 6 CYCLE 6.5: HQ preview token (session 60, 2026-05-29)

Scope 6D — the commercial hook ("show your HQ what's possible → they buy the tier").

- **What ships:** `hq_generate_preview_token(company)` (mig 175, write; **super_admin only**) +
  `get_hq_preview_state(token)` (read, **anon** — token is the secret; validates + 7-day expiry +
  stamps `accessed_at` on first open). `hqGeneratePreviewToken`/`getHqPreviewState` wrappers.
  apps/hq **PreviewView** at `/hq/preview/TOKEN` (or `/preview/TOKEN`) — no login, watermarked,
  read-only company snapshot (summary + venue health grid; no drill-down/incidents/tokens) +
  a header **Share preview** button (super_admin) that generates + shows the copyable link.
- **Decision:** generating is super_admin-only (sharing company data externally is privileged);
  "notify the generator on open" is **deferred** (no company-admin push/email channel yet) —
  `accessed_at` is the visible signal until then.
- **Verified:** rpc-security-sweep (generator anon-denied; preview anon-allowed — intended) ·
  ephemeral-verify (rolled back): generate · public read+snapshot+accessed_at · invalid+expired
  rejected · analyst/regional/stranger denied — all PASS · **end-to-end UI smoke against live DB**
  (anon, no OAuth): `/preview/<token>` rendered the watermarked snapshot; accessed_at stamped.
- **Operator owes:** authed Share-preview button render (behind OAuth, with the /hq pass).

## LEAGUE MODE — PHASE 6 CYCLE 6.4: live activity feed (session 60, 2026-05-29)

The scope-6B centre column — a cross-venue live feed.

- **What ships:** `hq_get_activity(company)` (mig 174, read) — tonight's fixtures with live
  scores + status, soonest upcoming when none today, a recent-goals ticker (match_events), and
  per-venue `live_channel_key`s. `hqGetActivity` wrapper. apps/hq **ActivityFeed** (centre column
  by default; selecting a venue swaps in the VenueDetail drill-down + a back button).
- **Realtime:** one subscription per venue channel (`venue_live:<key>`, mirroring apps/venue /
  mig 121) → debounced refetch on any goal/card/result broadcast, **+ a 30s poll fallback** so the
  board stays fresh even if a broadcast is missed. (Decision: subscribe-per-venue + poll backstop,
  vs. a single firehose — keeps it simple and self-healing.)
- **Verified:** rpc-security-sweep PASS (read-only → no ephemeral-verify); functional read
  (live=0 today, upcoming=3, goals=13, channels=2); apps/hq builds clean.
- **Operator owes:** live render + realtime correctness during an actual in-progress fixture.

## LEAGUE MODE — PHASE 6 CYCLE 6.3: composable analytics dashboard (session 60, 2026-05-29)

Layer A of the operator's customisable-dashboard idea — HQ picks from a registry of cards
(or applies a preset) and the layout is saved per-admin. Deterministic; the Phase 7 AI layer
will later compose over the *same* registry (grounded, never raw SQL).

- **Decision:** HQ analytics is **composable, not fixed tabs** (supersedes the scope-6C fixed
  Overview/Comparison/Engagement/Season tabs). A card registry + saved layout (mirrors Phase 4's
  `display_config` pattern); presets are named starting layouts. The **AI-composition layer (Layer
  B) is deferred to Phase 7** — built only after the registry exists, so the AI selects from safe
  cards rather than improvising against the schema. Cards use **only confirmed data sources** —
  "% opened app" / standings deferred (no clean source; not faked).
- **What ships:**
  - **mig 172** — `company_admins.dashboard_config jsonb` (per-admin layout; NULL = default preset).
  - **mig 173** — `hq_get_analytics(company, from?, to?)` (one read: 6 datasets + caller's layout +
    meta; role/region scoped; optional date filter) + `hq_set_dashboard_config(company, config)`
    (write; filters cards to the known 6 keys; persists the caller's own row).
  - **packages/core** wrappers `hqGetAnalytics`/`hqSetDashboardConfig`.
  - **apps/hq** — Dashboard|Analytics tab + AnalyticsView: 6 cards (Overview KPIs, Venue
    comparison, Top scorers [match_events goals], Discipline [cards], Open incidents, Billing),
    edit mode (preset / toggle / reorder / Save), presets Operations·Commercial·Performance.
- **Verified:** rpc-security-sweep (both SECDEF/single-overload/search_path/anon-denied) ·
  ephemeral-verify (rolled back): read=6 datasets/venues=2/goals=35 · config write filters bogus
  key→3 cards + keeps preset + persists + round-trips · bad_config rejected · regional-South
  scoping venues=1 · stranger denied — all PASS · apps/hq builds clean.
- **Operator owes:** live signed-in Analytics render (behind OAuth, with the 6.1 pass).
- **Deferred:** 6.4 live activity feed · 6.5 preview token · Phase 7 AI composition (Layer B) ·
  more cards as data sources firm up (player engagement, standings).

## LEAGUE MODE — PHASE 6 CYCLE 6.1: HQ dashboard foundation + drill-down + incident resolve (session 60, 2026-05-29)

The first net-new operator surface — a company-level, cross-venue HQ at `/hq`. "Data flows
up but the operator's screens didn't"; this reads it. Built as a "fuller" cycle (6.1 + 6.2
folded) with the full role model.

- **Decisions (operator, session 60):** new **apps/hq** app (not the clubmanager stub — that
  name collides with the misnamed `platform-clubmanager` Vercel project that serves inorout);
  **OAuth + company_admins** (auth.uid(), no token — scope 6A), with **regional_admin built now**
  (added `venues.region`); **fuller cycle** (foundation + venue drill-down + incident resolve);
  demo company seeded (live DB had 0 companies). Display redesign slots after.
- **What ships:**
  - **migs 169–171** — `venues.region`; demo company `company_demo` (Demo Sports Group: demo_venue
    North + venue_demo_south South, tarny super_admin, 2 open incidents); 5 RPCs
    (`resolve_company_caller`, `company_admin_whoami`, `hq_get_company_state`,
    `hq_get_venue_detail`, `hq_resolve_incident`) + `audit_events.actor_type`+='company_admin' +
    `notify_venue_change` whitelist+='incident_resolved'. Role scoping: super_admin all /
    regional_admin own region / analyst read-only (resolve rejected).
  - **packages/core** wrappers `companyAdminWhoami`/`hqGetCompanyState`/`hqGetVenueDetail`/`hqResolveIncident`.
  - **apps/hq** (React+Vite, OAuth gate mirroring superadmin): Venue Health Grid (🟢🟡🔴 + counts),
    Venue Detail drill-down (incidents w/ inline resolve, fixtures, leagues), Alerts/Actions rail.
- **Verified:** rpc-security-sweep 6/6 (SECDEF, single overload, search_path, anon denied) ·
  **ephemeral-verify** (rolled back): super_admin read + health states + drill-down + resolve
  (ok+audit, team_id=venue) + analyst rejection + regional South scoping + cross-region denial +
  stranger not_authorized — all PASS · bug caught pre-commit (audit_events.team_id NOT NULL →
  store venue_id) · apps/hq builds + sign-in screen renders clean (preview smoke).
- **Operator owes:** live signed-in `/hq` load as super_admin (real Google OAuth) · apps/hq Vercel
  deploy + `VITE_SUPABASE_*` env · the casual two-token browser smoke.
- **Deferred to 6.x:** analytics tabs (6.3) · live activity feed centre column (6.4) · HQ preview
  token (6.5) · HQ weekly digest (rides 6.x). regional_admin region-filtering UI polish.

## LEAGUE MODE — PHASE 9 (cont.): SMS/WhatsApp transport core + league reminder crons (session 59, 2026-05-29)

Continues Phase 9 per the session-58 build order (9→6→11). Two independent pieces,
**no DB migration, no `apps/inorout/src` or `packages/core` change** (casual flow
byte-identical; casual-regression not triggered — both files live in `apps/inorout/api/`).

- **Decisions (operator, session 59):** provider = **Twilio** (one API does SMS + WhatsApp).
  SMS/WhatsApp scope this cycle = **transport core only, wired to nothing** — the per-player
  push→email→SMS fallback model + contact-capture/preference UI are deferred (players have
  `phone`/`notification_channel` columns from mig 056 but nothing captures a phone yet, so
  player SMS can't deliver). Reminder crons = **48h availability + ~2h near-kickoff reminder,
  competitive only**. Quiet hours = **default 22:00–08:00 UK, queue + flush** (inherited from
  the existing push path). The Phase 9 **HQ weekly digest** stays deferred to ride with Phase 6.
- **What ships:**
  - `api/_sms.js` — Twilio transport, no-op-safe until `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`
    set (mirrors `_mailer.js`). `sendSms` / `sendWhatsApp` (one client; WhatsApp uses the
    `whatsapp:` address prefix), a `TEMPLATES` registry keyed by the same type names as later
    consumers, `sendTemplated(type, channel, to, ctx)`, and a `pickChannel(preferred, contacts)`
    helper stub for the future fallback router. **Not imported anywhere yet.** `twilio` added to
    `apps/inorout/package.json`.
  - `api/cron.js` — two new jobs on the existing 15-min dispatcher (no new pg_cron job):
    **`availabilityRequestJob`** (UK 9am window; selects scheduled/allocated `fixtures` where
    `scheduled_date = today+2`; pushes both squads' active players to mark availability) and
    **`fixtureReminderJob`** (fires ~2h before kickoff via the `(105,135]`-min band; nudges only
    still-unmarked `status='none'` players). Both close the loop Phase 5 left open: competitive
    availability reuses the casual board (Cycle 5.5) but nothing pushed the squad. Delivery via
    `/api/notify` direct mode (PUSH only this cycle), deduped on `notification_log`
    (`team_id`,`type`,`game_date`) via a new `alreadyLogged()` guard. New helpers `nowInUkFull()`
    + `addDaysIso()` + `fmtUkDate()` keep all timing UK-wall-clock to UK-wall-clock (DST-safe).
    New push types: `leagueAvailability48h`, `leagueFixtureReminder2h`.
- **Verified (no device):** build clean · no src/core diff · live-DB dry-run — at simulated
  today=06-02 the 48h job selects exactly the two 06-04 democomp fixtures, both sides resolve to
  real squads (FC 8 active/7 unmarked, Rovers/City/Athletic 5/5), dedup table empty (0 rows), and
  the 2h band fires at 18:00 (120 min) but not 17:00/19:00.
- **Operator owes (hard-rule #13):** real-device **push** delivery test for both reminders —
  needs a real device subscribed on a competitive squad (`dc_subs=0` today) AND a fixture 48h/2h
  out. No SMS delivery to test (transport unwired; `TWILIO_*` env unset → `_sms.js` no-ops).
- **Deferred to later 9.x:** wiring `_sms.js` (refs via `match_officials.preferred_channel`;
  player fallback + contact-capture UI); HQ weekly digest (rides Phase 6); AI `pre_match_briefing`
  (overlaps Phase 7).

## LEAGUE MODE — PHASE 9 CYCLE 9.1 SHIPPED (session 56, 2026-05-29)

Transactional **email** (Resend) — the sender several features were blocked on (booking
confirms to off-system venues, registration outcomes, ref assignments). Email-only this
cycle; the web-push chain is untouched. SMS/WhatsApp (Twilio) is a later 9.x cycle.

- **Decisions (operator):** channel = **email + existing push** (push→email fallback model;
  SMS/WhatsApp deferred); provider = **Resend** (new dedicated account, root `in-or-out.com`
  verified, DNS at GoDaddy); first wave = **onboarding/ops loop**.
- **What ships (mig 163 + `6d73345`):**
  - `notification_log` gains `channel`/`entity_id`/`recipient` (additive) + a partial
    email-dedup index.
  - `api/_mailer.js` — Resend transport + a `TEMPLATES` registry (the reusable core a later
    SMS/WhatsApp router shares). No-ops safely until `RESEND_API_KEY` is set.
  - `onboardingEmailJob` in the existing 15-min cron dispatcher: polls `audit_events` and
    emails the right persona — **team_registration_submitted → venue admin**,
    **team_approved / team_rejected → team admin**, **fixture_ref_assigned → referee**.
    Recipients resolved server-side (auth.users via team/venue_admins; `match_officials.email`
    for refs) — no player-preference plumbing needed. Deduped via `notification_log`.
- **No new RPC, no UI, no `apps/inorout/src` change** (casual flow byte-identical).
- **Verified:** schema-sync clean · module load/template smoke (resend resolves + constructs;
  no-key path returns `skipped`) · resolver SQL proven on the testbed (`team_dc_fc` →
  tarnysingh@gmail.com; demo venue has an official w/ email) · dedup DO-block PASS + leak 0 ·
  build clean.
- **LIVE — verified end-to-end (2026-05-29).** `RESEND_API_KEY` + `EMAIL_FROM`
  (`In or Out <notifications@in-or-out.com>`, root `in-or-out.com` verified) + `REF_APP_URL`
  (`https://platform-ref.vercel.app`) set in the inor-out Vercel project; redeployed. Live test:
  a `team_approved` event resolved to the Competitive FC admin, Resend sent, `notification_log`
  logged `channel='email'`, and the email **landed in the inbox**. Dedup confirmed (second tick
  no resend); test rows cleaned up. `VENUE_APP_URL` left unset (registration-pending email omits
  the link). **Update (session 74):** the venue app is now deployed at
  **https://platform-venue.vercel.app** — `VENUE_APP_URL` can be set to it on the `inor-out`
  project so the link appears. `team_registration_pending` still needs a **real** venue to
  exercise (demo venue has no linked `venue_admins` row).
- **Deferred to later 9.x:** SMS/WhatsApp; player notification-preference UI + contact setters;
  fixture-reminder/availability crons; HQ weekly digest; the AI `pre_match_briefing` (overlaps Phase 7).

**Carried into Phase 4/6 from 5.7:** the double-registration *resolution* surface. 5.7
hard-blocks a double-reg at submit and writes a `lineup_double_registration_blocked`
audit row; the two-sided league-admin confirm UI (scope §1148) + any ref-kickoff gate
land when apps/venue gains a per-player view. Also unbuilt: a discipline surface that
*sets* `player_registrations.status='suspended'` — 5.7 enforces suspension but nothing
writes it yet (arrives seeded/manual until that phase).

**Data flows up; the venue operator's *screens* don't yet — by design.** Everything built
(registrations, fixtures, ref results, teamsheets) writes to the shared schema the venue/HQ
layer reads. Cycle 5.6 also started populating `player_registrations` for real teams
(previously empty — only seeded). But `apps/venue` does NOT yet surface:
(a) **registered players per competition**, (b) **submitted teamsheets** (`fixture_lineups`
— the *ref* sees them; the operator can't), (c) **live standings / results / top scorers**.
These are the convergence points scheduled for **Phase 4 (reception)** and **Phase 6 (HQ)** —
tracked forward via hard-rule #14 consumer notes in RPCS.md. Nothing is dead-ended; the
operator-facing view is simply unbuilt until those phases.

---

## LEAGUE MODE — PHASE 5 CYCLE 5.7 SHIPPED (session 56, 2026-05-29) — PHASE 5 COMPLETE

Eligibility enforcement. Turns the 5.6 non-blocking teamsheet warnings into real gates,
both server-authoritative and surfaced in the UI. Built in two independently-verified,
independently-committed stages + docs.

- **Product decisions (operator, session 56):**
  - **Suspended/ineligible** → **override-with-confirmation**: submit blocks by default; the
    admin proceeds only by explicitly acknowledging each suspended player; the override is
    audited (`metadata.override_player_ids`). (scope §1147)
  - **Squad size** → new nullable `league_config.min_starting` / `max_subs`, set per-league
    by the venue/league (5 starters for 5-a-side, 7 for 7-a-side; bench cap 3, or 15…).
    Govern the **matchday sheet**; **hard block** outside bounds; `NULL = unbounded`.
  - **Double-registration** → **hard block now + audit**; picked player registered to another
    team in the comp can't be submitted. Two-sided league-admin confirm UI deferred to
    Phase 4/6 (apps/venue has no per-player view yet).
- **Stage A — server (migs 161–162, `b0b1aa0`)**: `league_config.min_starting`/`max_subs`
  (NULL-safe, no backfill); `team_admin_check_eligibility` (read — per-player
  suspended/double-reg/in-squad flags + bounds); `team_admin_submit_lineup` rewritten as the
  authoritative gate (all checks before any write). Also fixed a **latent 5.6 VC bug** — submit
  and `get_team_next_fixture_lineup` resolved via plain `teams.admin_token`, so a Vice Captain
  on `/p/<vc_token>` got `invalid_admin_token`; both now use `resolve_admin_caller` (session-49
  dual-lookup).
- **Stage B — UI (`bbf8f31`)**: `TeamsheetScreen` badges players ('AT ANOTHER TEAM' red hard
  block; 'SUSPENDED — TAP TO OVERRIDE' → 'OVERRIDDEN' amber), shows squad-size hints in the
  count bar (red when out of bounds), gates submit, and maps the new RPC error codes.
- **Verified**: schema-sync clean · rpc-security-sweep PASS (SECDEF, search_path pinned, 1
  overload each, anon+authenticated, no PUBLIC) · **ephemeral-verify 9/9 PASS** (eligible ·
  check-clean · check-flags · too_few_starters · too_many_subs · double_registered ·
  suspended-block · suspended-override · vc-path) + leak-check clean · hygiene 7/7 · build
  clean · casual-regression PASS (static — competitive-only screen, RPC can't fire on a casual
  token). Real-iPhone walk (hard-rule #13) on Competitive FC operator-owed.

---

## LEAGUE MODE — PHASE 5 CYCLE 5.6 SHIPPED (session 55, 2026-05-29)

Team-admin teamsheet: the manager submits a confirmed line-up (starting XI + bench) for
the next league fixture, and the ref pre-match screen shows that line-up instead of the
full registered squad. Built in **three independently-verified, independently-committed
stages** (the highest-risk cycle: new table + RPCs + a change to the live ref RPC).

- **Selection mechanic** (locked with operator): players tap IN on the 5.5 board; the
  manager opens a **dedicated Teamsheet screen** (NOT casual Make Teams — no A/B split in
  league) whose pool is the IN players, and assigns each to Starting/Bench. Maybe/no-
  response shown lower so one can be pulled in. **Pick-from-squad; submit registers** —
  submitting auto-upserts `player_registrations(active)` for picked players, so the ref
  view + fixture detail finally show real players for real teams.
- **Stage A — server foundation (mig 159, `eab2d4c`)**: `fixture_lineups` table
  (UNIQUE fixture_id+team_id, RLS no-policy); `team_admin_submit_lineup` (validates squad
  membership, auto-registers, soft squad size, non-blocking suspended/other-team warnings,
  audits); `get_team_next_fixture_lineup` (read). Nothing live read it yet → zero impact.
- **Stage B — ref RPC lineup-aware (mig 160, `68d9480`)**: recreated
  `get_fixture_state_by_ref_token` to return starting+bench (tagged `lineup_role`, lineup
  shirt overriding `players.shirt_number`) when a lineup exists, else the full
  `player_registrations` squad **exactly as before** + `lineup_role:null` (additive,
  hard-rule #12). Squad logic in an internal helper `_fixture_squad_json` (granted to
  nobody) so home/away can't diverge. apps/ref PreMatch shows a Starting/Bench split.
- **Stage C — admin Teamsheet UI (`743bc9b`)**: `TeamsheetScreen.jsx` + a gated
  "Teamsheet" card in AdminView (competitive teams only). `submitTeamLineup` /
  `getTeamNextFixtureLineup` wrappers.
- **Verified**: each stage rpc-security-swept + ephemeral-verified (Stage B's LOAD-BEARING
  backward-compat: no-lineup → full squad unchanged). Live end-to-end on the testbed
  (Competitive FC): UI submit → ref RPC returns Tarny(starting)/Marcus(bench), then
  reverted to full 8-player squad after cleanup. Casual regression: casual admin shows NO
  Teamsheet card; casual flow byte-identical. Real-iPhone test (hard-rule #13) operator-owed.
- **Deferred to 5.7**: hard suspension blocks, double-registration resolution, min/max
  squad size. Player `FixtureDetailCard` unchanged (picked players appear once registered).

---

## INOROUT — "Join another team" in MY SQUADS (session 55, 2026-05-29)

A signed-in player can now add a team from inside the app. A **"+ Join another team"**
row at the bottom of the MY SQUADS accordion reveals a paste box; on Enter/JOIN it
extracts the join code from a pasted invite link (`/join/<code>`, or a bare code) and
navigates to `/join/<code>`, handing off to the **existing** join flow — which already
gates auth, dedupes existing members (`App.jsx:641-660`), and runs the name step.

- **Single-file UI addition** (`apps/inorout/src/views/MySquads.jsx`). No new RPC,
  wrapper, App.jsx, or barrel change. Styled with `tokens.css` vars (DM Sans / Bebas
  Neue / Phosphor `weight="thin"`) to match the accordion.
- **Reuse over new plumbing**: mirrors the landing-page paste pattern (`App.jsx:1054`)
  and the in-file navigation idiom (`MySquads.jsx:152`).
- **Verified**: hygiene 7/7, build clean, Playwright proof (tap → paste invite link →
  navigates to `/join/demo` → existing join screen renders), zero new console errors on
  a casual token. Commit `249dc12`. Real-iPhone home-screen test (hard-rule #13)
  operator-owed on live.

---

## LEAGUE MODE — A LEAGUE TEAM IS ALWAYS A SEPARATE SQUAD (session 55, mig 158)

Closed the global-`players.status` dual-context must-fix **structurally**.
`join_register_team` (mig 098) previously promoted a casual team in place
(`UPDATE teams SET team_type='competitive'`); mig 158 removes that — a casual
`existing_team_id` is rejected (`casual_team_cannot_register`), and an `existing_team_id`
is accepted only when already competitive (cup reuse, Phase 11). A casual group joining
a league creates a NEW squad (own `team_id`, LEAGUE pill, second MY SQUADS entry), so a
casual `team_id` can never enter a competition and the mig-157 trigger can only touch
competitive squads.

- **Verified**: data safety check (no real casual team was ever promoted — all
  competitive teams are testbed/demo); ephemeral-verify 3 paths PASS + leak-check clean;
  rpc-security-sweep PASS (also stripped a stale anon EXECUTE grant); build clean; no JS
  changed (casual flow byte-identical). Commit `7103267`. RPCS.md now catalogues the
  Phase 2 registration trio (`72f47ea`). See BUGS.md (RESOLVED) + DECISIONS.md (session 55).

---

## LEAGUE MODE — PHASE 5 CYCLE 5.5 SHIPPED (session 54, 2026-05-29)

Per-fixture availability — **by reusing the casual IN/OUT board**, not a new system.
Decision (with operator): a competitive team's player marks in/out for their next
league fixture using the *same* board casual players use. This means the admin
make-teams / manage-squad / who's-in screens need **zero change** (they already read
`players.status`). A separate availability table would have forced them to change.

- **No new table, no new write RPC.** Availability stays `players.status`, written by
  the existing `set_player_status` (mig 011). The board header is driven by the next
  upcoming fixture (opponent + date + venue + time); buttons are live whenever an
  upcoming fixture exists; the board auto-rolls to the next fixture as completed ones
  leave the upcoming set.
- **"Start fresh each game" (mig 157)** — a trigger on `fixtures`
  (`reset_team_status_on_fixture_played`, SECURITY DEFINER, search_path locked):
  when a fixture goes `scheduled → completed/walkover/forfeit/void`, both teams'
  players reset to `status='none'` + `notify_team_change(...,'schedule_updated')` so
  open apps refetch. One trigger captures every completion path (ref/venue/walkover)
  without editing those shipped RPCs.
- **Client**: `PlayerView` lifts the fixtures fetch, derives the next fixture, and
  overlays an *effective schedule* (gameIsLive=true + fixture date/venue/time) only
  when a fixture exists; `PageHeader` gains an optional `opponentLabel`;
  `CompetitionFixturesCard` accepts `fixtures` as a prop (shared fetch).
- **Casual untouched**: all competitive behaviour gates on "an upcoming fixture
  exists" — casual teams have none, so `schedule` is the unmodified prop and the
  board is byte-identical. Trigger never fires for casual (no fixtures).
- **Edge — RESOLVED (session 55, mig 158)**: the dual-context worry is closed
  structurally. A league team is now ALWAYS a separate squad — `join_register_team`
  rejects a casual `existing_team_id` (no in-place casual→competitive promotion), so a
  casual `team_id` can never be in a competition and the mig-157 trigger can only ever
  touch competitive squads. (The original "global per player / cross-team" framing was
  also inaccurate — one `players` row per (user,team) already scopes status per team.)
  See BUGS.md (RESOLVED) + DECISIONS.md (session 55).
- **Verified**: trigger ephemeral-verified in rollback txn (FC + opponent players
  reset to none on completion; Rovers/casual untouched; broadcast reason whitelisted);
  applied live; trigger SECURITY DEFINER + search_path confirmed; hygiene + build
  clean. PWA on-device test (board shows "vs Demo Athletic", tap IN persists, rollover
  clears) operator-owed (hard-rule #13).

---

## LEAGUE MODE — PHASE 5 CYCLE 5.4 SHIPPED (session 54, 2026-05-29)

Fixture detail + opposition intel. A fixture row in `CompetitionFixturesCard`
now taps to expand an inline `FixtureDetailCard` (one open at a time), which
shows the matchup/scoreline, kickoff countdown (upcoming), goal events
(completed), both teams' LIVE registered squads, and a nested tap-to-load
`OppositionIntel` block (H2H all-time + this-season, both teams' last-5 form,
per-team top scorers, last meeting).

- **Two new RPCs (mig 156)** — `get_player_fixture_detail(p_token, p_fixture_id)`
  + `get_fixture_opposition_intel(p_token, p_fixture_id)`. Both SECURITY DEFINER,
  search_path locked, anon+authenticated. **Stricter than the ref RPC**: a player
  may only open a fixture in one of their OWN active competitions that one of their
  OWN teams plays in — any other fixture id raises `fixture_not_visible`.
- **No `goals` table** — scorers derive from `match_events` (event_type='goal').
  Form/H2H from fixture scores. Walkover/forfeit → W/L only (no phantom 3-0).
- **Squads are the LIVE registered roster** (read fresh each expand) — a team may
  confirm late; the per-fixture confirmed XI arrives in 5.6 (`fixture_lineups`).
  Detail RPC return shape leaves room for 5.5 availability fields (added then with
  a same-commit mapper update, hard-rule #12).
- **Designed-for consumers (hard-rule #14)**: detail → Phase 4 reception + Phase 7
  AI briefings; intel → Phase 7 AI Gaffer. Recorded in RPCS.md.
- **Verified**: rollback pre-flight of both RPCs incl. refusal assertions (casual
  token + fake fixture both raise); applied live + schema reload; live re-check
  (detail opp=Demo Rovers, Tarny 3 goals; H2H P1/W1 3-1, FC form [W,W], Rovers
  [L,L]); rpc-security ×2, hygiene, build clean; each raw RPC name once in
  supabase.js. Casual my-view untouched (card self-gates). On-device confirm
  operator-owed.
- **Post-ship polish** (`7252126`, `47acb28`) — goal events split into per-team
  columns (home left / away right-half), left-aligned within each column to match
  the squad layout exactly. Pure display; no RPC/data change.

---

## LEAGUE MODE — PHASE 5 CYCLE 5.3 SHIPPED (session 54, 2026-05-28)

Competition fixtures on the player screen. New `CompetitionFixturesCard.jsx`
rendered in PlayerView's my-view directly below the standings card: a collapsible
list grouped UPCOMING (scheduled) then RESULTS (most-recent-first), each row showing
opponent (`vs`/`@`), week/round + date (+ kickoff for upcoming), score, and a
W/D/L result chip (green/grey/red) from the player's team perspective.

- **New RPC `get_player_competition_fixtures(p_token, p_filter)`** (mig 155) —
  SECURITY DEFINER, search_path locked, anon+authenticated. Token → player → active
  competitions → that team's fixtures. `p_filter` ∈ upcoming/past/all (forgiving
  fallback to all). Per-row player perspective (is_home, opponent_name, my_score,
  result). Walkover/forfeit reported as status truthfully (no phantom 3-0 — standings
  owns that). Designed once for: this card + Phase 4 reception + Phase 6 HQ (RPCS.md).
- **Self-gating**: casual token → `fixtures: []` → card renders `null`; casual flow
  untouched. Rows not yet tappable — Cycle 5.4 wires inline fixture detail.
- **Verified**: rollback-transaction pre-flight (Tarny 2W+1 upcoming, casual []),
  applied live + schema reload, live re-check (Tarny 3 / casual 0), rpc-security ✓,
  hygiene ✓, build ✓, raw RPC name once in supabase.js. On-device confirm operator-owed.

---

## PITCH BOOKING — backend + casual UI complete (session 52, 2026-05-28)

B2C casual pitch booking + the unified occupancy guard. Full plan, stage table,
and commit hashes in **PITCH_BOOKING_HANDOFF.md**. Built this session:

- **Occupancy guard** (`pitch_occupancy`, partial GiST EXCLUDE) — a casual booking
  and a competitive fixture can never double-book the same pitch+time; maintenance
  blocks both. Priority: maintenance > fixture > block > ad-hoc.
- **Fixtures + maintenance** auto-project into occupancy via triggers; the venue
  fixture-write RPCs auto-yield un-confirmed bookings and gate on confirmed clashes.
- **Booking lifecycle** — request → confirm/decline, walk-in create, cancel (single +
  series), all through the guard + audit + realtime on both channels.
- **Casual UI** — Match Settings "Book a Pitch": venue discovery, one-off + weekly
  block, length picker, confirm w/ cancellation policy, live Requested→Confirmed
  badge + cancel.
- **demo_venue** enabled for testing (reversible).

**Stage 6 venue UI — done (session 53, mig 150 + commits `df7764f`/`7503d11`/`6378c40`):**
venue dashboard Bookings surface — requests inbox (block series grouped), colour-coded
resource-timeline calendar (desktop) / single-pitch agenda (mobile), tap-empty walk-in,
tap-block detail with cancel/confirm/decline, settings (bookings toggle + cancellation
policy + per-pitch booking-windows editor), `venue_live` subscriber refetching occupancy
on the 5 booking reasons. Hardening pass (`202d16a`): casual bookings list now refreshes
live on venue broadcasts; BookPitchModal date off-by-one (toISOString/UTC) fixed.

**Stage 7 — done (session 53, migs 151–152 + commits `b398b05`/`9dd953e`/`ca4a174`/`aca0cd4`):**
renewal right-of-first-refusal (a series ending ≤21d auto-holds the next block for the team
via `create_renewal_holds` cron at 09:00 UK; team "Keep slot" → `confirm_renewal` flips
holds→requested for venue re-approval; unconfirmed holds auto-expire via `expire_renewal_holds`
after a 7-day grace) + push to team admins for renewal-held/expired and for fixture-superseded
bookings (`supersededPushJob`, polls `superseded_at`). All gated (ephemeral-verify +
rpc-security-sweep). **Booking initiative complete.**

**Remaining:** deferred push-on-confirm; transactional email (Phase 9). **Payment OFF but
schema-wired.** **Operator owes** a real-squad + real-device test of the casual + venue flows
(auth-dependent) incl. the three booking pushes (GO_LIVE §6).

---

## LEAGUE MODE — PHASE 5 CYCLE 5.2 SHIPPED (session 54, 2026-05-28)

Competition standings on the player screen. New `CompetitionStandingsCard.jsx`
rendered in PlayerView's my-view (below MySquads): a collapsible league table
(Pos/Team/P/W/D/L/GF/GA/GD/Pts) with the player's own team highlighted gold.

- **Pure client UI** — reuses the existing `get_league_standings_for_player` RPC +
  `getLeagueStandingsForPlayer` wrapper (migs 087/104). No server/migration/wrapper change.
- **Self-gating**: a casual token returns no competitions → card renders `null`, so the
  casual flow is untouched (no `is_competitive` prop needed). Form column omitted (not in
  the RPC shape — later enhancement, would need a server change).
- **Verified in-browser** against the live competitive testbed: Competitive FC top on 6pts,
  own row highlighted, columns correct, clears the fixed nav; casual token shows no card
  (DOM-checked). Build + hygiene clean. Naming `Competition*` to avoid the StatsView
  `PlayerLeagueTable` clash. On-device confirm operator-owed (hard-rule #13).
- Demo competitive testbed (mig 154): **Competitive FC** (Tarny team admin) + 3 opponents
  in a Demo Competitive League; admin link `/admin/democomp_fc_admin_token`; remove via
  `154_..._down.sql` (rollback-verified safe).

---

## LEAGUE MODE — PHASE 5 CYCLE 5.1 SHIPPED (session 54, 2026-05-28)

First Phase 5 cycle — competitive surfaces *inside* `apps/inorout`, additive +
render-gated (casual flow untouched). Cycle 5.1 is the foundation: detect which
squads are competitive + a `LEAGUE` pill on MySquads.

- **mig 153** — `player_get_teams_by_token` (mig 072) extended with an
  `is_competitive boolean` (squad has an ACTIVE registration in a `league`-type
  competition). Return-type change → DROP+CREATE; search_path aligned to
  `public,pg_temp`; grants unchanged (anon+authenticated). No new RPC, no N+1, no
  wrapper change (field flows through `getPlayerTeamsByToken`).
- **MySquads.jsx** — `LEAGUE` pill (purple token) on every competitive squad
  (current + other active rows), beside the existing CURRENT/ADMIN pills via a flex
  wrapper. Casual squads unchanged.
- **Verified:** ephemeral rollback proof (competitive→true, casual→false, 0 rows
  persisted); rpc-security-sweep (secdef/search_path/overload=1/grants); RPC-ref +
  hygiene clean on changed files; casual-regression in-browser against the real
  Finbars token (no LEAGUE pill on casual squads; CURRENT/ADMIN intact; no
  regression). **On-device visual confirm operator-owed** (hard-rule #13, MySquads
  in PWA scope).
- **Locked for later cycles (from this session's discussion):** league availability
  is two-stage (players signal "who's in" → admin confirms the lineup → submitted to
  the league); players + admin override; reuse the familiar in/out tile look; **no
  Team A/B split for league** (you play an external opponent — the casual Group
  Balancer never runs for a league fixture). Governs cycles 5.5/5.6.
- Decisions/full plan: `~/.claude/plans/continuing-phase-3-of-steady-falcon.md`.

---

## LEAGUE MODE — PHASE 3 COMPLETE (session 51, 2026-05-27)

All six Phase 3 cycles shipped + Vercel deployment. The ref view is
now feature-complete and live: a referee can open the link on their
phone at the pitch, see both squads, hold Start, log goals / cards /
subs / period changes, work offline if signal drops, confirm full
time, and see a read-only post-match summary. Venue admins can
override results via the venue dashboard's RPC (UI to follow).

**What shipped in session 51 (this session):**
- **Cycle 3.3 — LiveMatch screen (commit `da89740`)**. Sticky clock+score
  bar, two-team player rows with ⚽/🟨/🟥/↕️ tap targets, long-press
  goal → own goal, second yellow auto-prompts red, sub picker modal,
  half-time / start-2H / full-time period actions, 30s undo toast
  wired to `ref_undo_event`, full-time confirm dialog. Optimistic UI
  with revert-on-error throughout.
- **Cycle 3.4 — Offline event queue (commit `7ce2bac`)**. Every event
  tap persisted to IndexedDB BEFORE the RPC call. Drain loop replays
  pending rows on mount / `online` event / manual Retry. Idempotent
  by client_event_id (mig 120 ON CONFLICT DO NOTHING) so duplicate
  replays are server-side no-ops. Sticky amber "Offline · N queued"
  / green "Syncing · N pending" banner. beforeunload guard on
  pending-count > 0. No service worker (deliberate — avoids the
  session-50 SW failure family entirely).
- **Cycle 3.5 — Score materialisation + standings cascade (verified, no commit)**.
  End-to-end ephemeral fixture via Supabase MCP: ran ref_start →
  9 events → ref_confirm_full_time → asserted score 3-1 / completed
  / standings W=1 GF=3 GA=1 PTS=3 / undone-goal correctly excluded /
  own-goal correctly credited to opposite team. Discovered: no
  cascade trigger exists — standings are computed on-read by
  `get_league_standings_for_player` (mig 087/104), so the cycle
  shipped nothing because no code needed adding. Verified clean.
- **Cycle 3.6 — Post-match summary + venue result override (commit `563201b`)**.
  - New mig 127: `venue_update_fixture_result(venue_token, fixture_id, home, away, reason)` —
    SECURITY DEFINER, token-gated via `resolve_venue_caller`, requires
    fixtures in `status='completed'`, non-empty reason, audit-logs
    previous + new scores + reason, broadcasts `result_corrected` to
    both teams + venue + league.
  - **Side-effect fix in mig 127**: `notify_venue_change` had silently
    regressed in mig 121 (whitelist shrank 26 reasons → 3, every
    Phase 2 RPC calling it has been logging WARNINGs for the past
    week). Restored full Phase 2 list + added new Phase 3 reasons
    while rewriting the function body. Plus `notify_league_change`
    gained `fixture_result_corrected`.
  - New `apps/ref/src/views/PostMatch.jsx`: read-only summary with
    scorers, cards, subs, "Share result" button (copies plain-text
    summary to clipboard). Footnote: "Need a correction? Ask the
    venue admin." App.jsx routes status='completed' → PostMatch.
  - Verified end-to-end against ephemeral fixture: bad inputs
    rejected with correct error codes, 1-1 → 2-3 override worked,
    standings reflect override, second override (0-0) worked, audit
    rows + metadata correct. Zero leak.

**Vercel deployment for apps/ref**:
- New Vercel project `platform-ref` (id `prj_akoL30MbOSlO7DSrT7f1OYagWbE0`)
  linked to this monorepo's main branch, root directory `apps/ref`.
- Env vars set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (production + development; preview skipped due to a CLI bug with
  `--yes` for "all preview branches" — can add later when needed).
- Live at `https://platform-ref.vercel.app` and the auto-generated
  branch aliases. First production build: 11.5s, clean.
- GitHub auto-deploy connected — future `main` pushes auto-deploy.
- Custom domain `ref.in-or-out.com` NOT yet set up (separate task;
  needs DNS record at the user's registrar).
- Side-finding: discovered the `platform-clubmanager` Vercel project
  is in fact the `apps/inorout` production deployment serving
  `in-or-out.com` — name is a leftover that should be renamed
  `platform-inorout` (housekeeping, separate cycle).

**Phase 5 plan approved**:
- Roadmap saved at `/Users/tarny/.claude/plans/continuing-phase-3-of-steady-falcon.md`.
- Locked architectural decisions:
  1. Trigger: per-SQUAD (not per-player). League surfaces only show
     when the player has a competitively-registered squad selected
     as their active context.
  2. UI placement: collapsible cards inside existing tabs (no new
     NavBar tabs). MySquads gets a `LEAGUE` pill on competitive
     squads.
  3. Teamsheet IS source of truth for ref pre-match — Cycle 5.6
     adds `fixture_lineups` table + RPC + backward-compatible update
     to `get_fixture_state_by_ref_token`.
  4. Naming discipline: new components use "Competition" not
     "League" to avoid collision with existing intra-squad
     `PlayerLeagueTable`.
- 7 landable cycles (5.1–5.7), one cycle per session, each with its
  own plan-mode pass.

**Skills framework hardened (commit `cc9e711`)**:
- `Skills/casual-regression.md` — mandatory for any Phase 5+ cycle
  touching `apps/inorout/src/` or `packages/core/`. Codifies the
  "casual is sacred" constraint as a procedure: 20-surface
  inventory, two-token smoke test, console diff, screenshot diff,
  real-device test.
- `Skills/ephemeral-verify.md` — mandatory for any new write RPC.
  Reusable DO-block-with-RAISE-EXCEPTION-rollback template +
  leak-check query. Codifies the pattern we hand-wrote in Cycles
  3.5, 3.6, mig 127.
- CLAUDE.md: hard-rule #14 added (forward-consumer tracking in
  RPCS.md). Skills directory + situation-specific triggers updated.
  Two new "never commit without…" gates added.
- RPCS.md: new "Consumers — forward dependency tracking" section.
- Skills/audit.md + Skills/post-incident.md extended.
- SessionStart hook lists both new skills so they auto-load every
  new chat.

**Tomorrow's safe-deploy plan**:
- Everything that needed to deploy this session has deployed
  (cycles 3.3/3.4/3.6 committed to main → auto-deployed to
  platform-ref.vercel.app; mig 127 applied via MCP).
- Tomorrow's real-world test: open
  `https://platform-ref.vercel.app/ref/<demo-token>` on a real
  iPhone, walk through a Start → events → full time flow,
  observe.
- Next coding session: Cycle 5.1 (smallest, lowest risk — RPC for
  competitive context detection + LEAGUE pill on MySquads).

**Latent items flagged**:
- `Skills/` vs `skills/` directory case mismatch (macOS-only
  passable, breaks on Linux).
- `platform-clubmanager` Vercel project → should rename to
  `platform-inorout`.
- The dead `inor-out` Vercel project (linked to a separate old
  GitHub repo) should be deleted.
- Vercel preview env vars not set for platform-ref (only production
  + development) — CLI bug workaround needed.

---

## LEAGUE MODE — PHASE 3 CYCLE 3.2a SHIPPED (session 50, 2026-05-27)

**Small follow-on to 3.2.** The 3.2 ref RPCs broadcast to both teams'
`team_live:*` channels — fine for inorout team-admin tabs (which
subscribe), useless for the venue admin watching from the office on
the venue dashboard (different surface, different token, never
subscribed). This cycle wires venue-level broadcasts so the
operator's dashboard updates live too.

Shipped:
- **Migration 121** adds `notify_venue_change(p_venue_id, p_reason)`
  helper — mirror of `notify_team_change` but uses
  `venues.live_channel_key` and publishes on `venue_live:<key>`
  channel (public, same private=false pattern). Whitelist starts with
  the 3 Phase-3 reasons (`match_started`, `match_event_recorded`,
  `match_result_saved`) and can grow.
- Tiny private helper `_ref_venue_id_for_fixture(p_fixture)` walks
  competition → season → league → venue. Both helpers explicitly
  revoked from anon + authenticated (Supabase auto-grant gotcha).
- All 7 ref RPCs re-created with an extra
  `PERFORM notify_venue_change(<venue_id>, <reason>)` call right
  after the home/away team broadcasts. Bodies otherwise byte-identical
  to mig 120.
- `apps/venue/src/App.jsx` now imports the `supabase` client and adds
  a useEffect that opens `venue_live:<live_channel_key>` once the
  venue state loads. On any broadcast it re-fetches `venueGetState`.
  Cleanup via `supabase.removeChannel(ch)` on unmount/dep-change.
  The channel key is delivered to the client via the existing
  `venue_get_state` response shape — no new RPC needed.

End-to-end verified: opened `/venue/demo_venue_token_DO_NOT_USE_IN_PROD`
in a browser, fired `ref_start_match` + `ref_record_goal` from the
SQL editor against a demo fixture; console showed
`[venue] subscribed to venue_live:demo_ven…` then two
`[venue] live update` messages (one per RPC), each triggering a
re-fetch. Smoke fixture reset back to `allocated` after.

What's NOT in this cycle (still deferred):
- Phase 4 reception display channel — **RESOLVED (session 57)**: reuses
  `venue_live:<live_channel_key>` (every ref RPC already broadcasts there);
  `apps/display` subscribes. No separate `display:<token>` channel needed.
- Push notifications for any ref event — by design, this stays
  silent/in-tab only.

Files touched:
- `rls_migrations/121_phase3_ref_venue_broadcasts.sql` (+ `_down.sql`)
- `apps/venue/src/App.jsx` (+13 lines for the subscriber)

---

## LEAGUE MODE — PHASE 3 CYCLE 3.2 SHIPPED (session 50, 2026-05-27)

**Cycle 3.2 — Server side of the live match (RPCs only, no UI)** —
medium risk; second of six Phase 3 cycles per plan
`~/.claude/plans/plain-english-please-jazzy-spring.md`.

Built the entire ref-side write surface in one migration. UI ships in
Cycle 3.3.

**Shipped:**

- **Migration 120** (`120_phase3_ref_match_writes.sql`):
  - Schema additions:
    - `match_events.client_event_id uuid UNIQUE` — every ref tap
      generates a client UUID; `ON CONFLICT DO NOTHING` on insert
      makes offline replay strictly idempotent (no double-counted
      goals).
    - `fixtures.actual_kickoff_at timestamptz` — server-recorded
      kickoff moment, lets the ref tab compute a live MM:SS timer
      that survives reloads + offline gaps.
    - `audit_events.actor_type` CHECK extended to include `'referee'`.
  - `notify_team_change` whitelist extended with two new reasons:
    `match_started` and `match_event_recorded` (same-commit-as-callers
    discipline per §6.3 lesson — mig 049 retro-fix taught us this).
  - Private helper `_ref_resolve_fixture(p_ref_token)` — token →
    fixture lookup, raises `invalid_ref_token` on miss. Explicitly
    revoked from anon + authenticated (Supabase auto-grants every
    public-schema function; `REVOKE FROM PUBLIC` alone doesn't catch
    those roles — a hidden gotcha we'd never hit before).
  - Updated `get_fixture_state_by_ref_token` to return
    `actual_kickoff_at` (additive, no consumer breakage).
  - **Seven SECURITY DEFINER ref RPCs**, all token-gated via the
    helper, all writing an `audit_events` row per hard-rule #9, all
    firing `notify_team_change` for home + away after every successful
    insert per hard-rule #10:
    - `ref_start_match(ref_token, client_event_id, local_timestamp)` →
      flips `status='allocated'/'scheduled' → 'in_progress'`, records
      `actual_kickoff_at`, inserts a `period_change` event with
      `period='1H'`. Broadcasts `match_started`.
    - `ref_record_goal(ref_token, player_id, minute, period,
      client_event_id, own_goal, local_timestamp)` — resolves scorer's
      team via `player_registrations`. `own_goal=true` stores
      `event_type='own_goal'` with `team_id = scorer's own team`
      (counts for the OTHER team in score materialisation).
    - `ref_record_card(ref_token, player_id, minute, period, colour,
      client_event_id, local_timestamp)` — `colour ∈ {yellow,red}`.
    - `ref_record_substitution(ref_token, on_player_id, off_player_id,
      minute, period, client_event_id, local_timestamp)` — both
      players must be on the same team's roster.
    - `ref_set_period(ref_token, period, client_event_id,
      local_timestamp)` — `period ∈ {HT,2H,ET1,ET2,PEN}`; inserts a
      `period_change` event.
    - `ref_undo_event(ref_token, client_event_id)` — DELETE by
      `client_event_id`; idempotent (treats missing row as no-op).
      Server enforces only that the fixture is still `in_progress`;
      the 30-second undo window is a client-side decision.
    - `ref_confirm_full_time(ref_token)` — materialises scores from
      `match_events`:
        - `home_score = goals(home_team) + own_goals(away_team)`
        - `away_score = mirror`
      Transitions `status='in_progress' → 'completed'`. Broadcasts
      `match_result_saved` (already on whitelist). Standings are
      derived on-read by `get_league_standings_for_player`; no
      separate cascade needed.
  - **Demo seed**: 5 players per demo team registered into the demo
    competition with shirt numbers 1–5 backfilled. Idempotent
    (`ON CONFLICT (player_id, competition_id) DO NOTHING`). Without
    this Cycle 3.1's PreMatch + 3.2's event RPCs both ran against
    empty squads — squads now populated for end-to-end smoke testing.

- **JS wrappers** added to `packages/core/storage/supabase.js`
  exported via the barrel: `refStartMatch`, `refRecordGoal`,
  `refRecordCard`, `refRecordSubstitution`, `refSetPeriod`,
  `refUndoEvent`, `refConfirmFullTime`. Each raw snake_case RPC name
  appears in exactly one `supabase.rpc()` call (hard-rule #7
  satisfied).

**Realtime wiring (the bit the user flagged risk on):**

The audit found `notify_team_change` already exists (mig 062 +
049 + 117), already publishes to `team_live:<live_channel_key>`,
already public-channel-not-private, and `apps/inorout/src/App.jsx`
lines 786–827 already subscribe + re-fetch on broadcast. **Zero new
realtime infrastructure required** — every ref event simply fans
out two `notify_team_change` calls (home + away), and both team
admin tabs update without any client-side change.

Whitelist hygiene: the two new reasons (`match_started`,
`match_event_recorded`) were added to the function body in the
SAME migration as the calling RPCs, avoiding the §6.3 drift bug
(mig 049 had to retro-fix `player_account_deleted` after the fact).

**Smoke-tested end-to-end** against the demo fixture
`Alpha United vs Delta FC`:
- Start match (status → in_progress), 3 regular goals, 1 own-goal,
  1 yellow card, 1 substitution, HT, 2H, 1 goal-then-undo, full
  time confirm.
- Final score: 2–2 (math checks: 2 home goals + 0 own_goals from
  away = 2; 1 away goal + 1 own_goal from home = 2).
- 12 audit rows by `referee`, 9 surviving match_events (undone
  event correctly deleted), idempotent retry of a goal RPC with
  the same `client_event_id` was a clean no-op.
- Zero `unknown reason` warnings in postgres log during the run —
  whitelist extension worked.
- Fixture reset back to `allocated` so Cycle 3.3 has a fresh slate.

**RPC security sweep**: all 7 RPCs pass — SECURITY DEFINER, search
path locked to `public, pg_temp`, `EXECUTE` granted to `anon` +
`authenticated`, no overloads, helper properly private.

**Files touched:**
- `rls_migrations/120_phase3_ref_match_writes.sql` (+ `_down.sql`)
- `packages/core/storage/supabase.js` (+7 wrappers, +read-RPC update)
- `packages/core/index.js` (+7 exports)

**What's next:** Cycle 3.3 — the live match UI in `apps/ref/`
(LiveMatch.jsx) wiring the buttons to the 7 RPCs. Online-only first;
the offline queue is the standalone Cycle 3.4.

---

## LEAGUE MODE — PHASE 3 CYCLE 3.1 SHIPPED (session 50, 2026-05-27)

**Cycle 3.1 — Pre-match: ref logs in and sees the squads** (low risk,
pure read + UI; first of six Phase 3 cycles per the plan
`~/.claude/plans/plain-english-please-jazzy-spring.md`).

Shipped:
- **Migration 119** (`119_phase3_ref_get_fixture_state.sql`) — new
  `get_fixture_state_by_ref_token(p_ref_token)` SECURITY DEFINER RPC.
  Returns one fixture + competition + venue + league + pitch +
  official + both teams + both squads (derived from
  `player_registrations` joined to `players`, ordered by
  shirt_number) + any existing `match_events` for resume. Single-
  fixture access only — token grants access to nothing else.
  Grants: `anon, authenticated`.
- **JS wrapper** `getFixtureStateByRefToken(refToken)` in
  `packages/core/storage/supabase.js`, exported from the barrel.
- **New app `apps/ref/`** (Vite + React, port 5180) — mirrors
  `apps/venue/` shape: `package.json`, `vite.config.js`,
  `index.html`, `vercel.json` (catch-all → index.html),
  `src/main.jsx`, `src/App.jsx`, `src/styles.css`.
- **Visual baseline**: shares Geist + coral accent with apps/venue
  but strips glass effects, drifting orbs, and shimmer — refs need
  outdoor-readable contrast and large tap targets, not flourish.
  Auto light/dark via `prefers-color-scheme`. Min 56px buttons.
- **`PreMatch.jsx` view**:
  - Header eyebrow (venue · competition · week)
  - Kickoff strip (time + date / pitch + ref)
  - Two squad cards (team swatch from primary_colour, shirt number
    + player name + suspension flag if `suspension_until` future)
  - Empty squad state ("No confirmed squad yet")
  - Terminal-state banner (`completed` / `void` / `postponed` /
    `walkover` / `forfeit`) — surfaces final score, replaces Start
    Match with a Refresh
  - **Start Match button**: enabled within 15 min of kickoff; outside
    that window, requires a 3-second pointer hold to override (RAF-
    driven progress fill on the button, countdown hint underneath)
  - The actual `ref_start_match` RPC ships in Cycle 3.2 — the tap
    handler currently surfaces an alert pointing forward.
- **Smoke-tested** at 390×844 against two real demo fixtures:
  a completed fixture (4–2 Alpha United vs Bravo Athletic, Wed 13
  May) shows the terminal-state path; a future allocated fixture
  (Wed 3 Jun, Alpha United vs Delta FC) shows the gated Start
  Match with "Unlocks in 7 days" hint.

**RPC security sweep passed**: `security_definer: true`,
`search_path: public, pg_temp`, EXECUTE granted to both `anon` and
`authenticated`, no overloads.

**Demo seed gap noted**: `player_registrations` rows aren't seeded
for the demo teams, so squads render as empty in the current demo.
Not a blocker for Cycle 3.1 (squad rendering verified empty + non-
empty paths work); will be addressed when Cycle 3.3 needs live
squads for event entry, or sooner via a dedicated seed cycle.

**Files touched**:
- `rls_migrations/119_phase3_ref_get_fixture_state.sql` (+ `_down.sql`)
- `packages/core/storage/supabase.js` (+wrapper)
- `packages/core/index.js` (+export)
- `apps/ref/` (new app)

**What's next**: Cycle 3.2 — server-side event-write RPCs +
`client_event_id UNIQUE` column on `match_events` + realtime
broadcasts (so Phase 4 reception display can subscribe later).

---

## LEAGUE MODE — PHASE 2 COMPLETE (session 48, 2026-05-27)

All 8 cycles shipped. The venue admin can now, from a single
browser window: onboard the venue, define one or more leagues,
create a season, generate fixtures across multiple competitions,
approve incoming team registrations, assign pitches + refs to
fixtures, change fixture statuses (postpone / void / walkover /
forfeit), withdraw or expel mid-season teams (with cascade), and
maintain pitches + officials. Demo venue (`demo_venue_token_DO_NOT_USE_IN_PROD`,
league code `DEMO0001`) exercises every surface end-to-end.

**Cycles** (in shipped order):
- **2.1** Foundation + operator-led onboarding — migs 083–085 + 088 hotfix
- **2.2** Read RPCs — `venue_get_state`, `league_get_state`,
  `join_get_league_by_code`, `get_league_standings_for_player` —
  migs 086–087 + 089 hotfix
- **2.3** Engines (round-robin + cup) + `venue_create_season` +
  `venue_generate_fixtures` — migs 090–091 + 092 hotfix
- **2.4** Fixture management RPCs (`venue_assign_pitch`,
  `venue_assign_ref`, `venue_update_fixture_status`) + forfeit
  columns — migs 093–096
- **2.5a** Team registration via `/join/CODE` —
  `join_register_team`, `venue_approve_team_registration`,
  `venue_reject_team_registration` — migs 097–100
- **2.5b** Mid-season failures (`venue_withdraw_team`,
  `venue_expel_team`) + standings cascade incl. forfeit — migs 101–104
- **2.6** Refs + pitches CRUD + maintenance-window enforcement —
  migs 105–109
- **2.7a** Demo venue seed + upcoming-filter hotfix + date
  relativisation — migs 110–112
- **2.7c** Venue dashboard scaffold — new `apps/venue/` Vite+React app
- **2.7d** Dashboard write surfaces + teams directory — mig 113
- **2.8** Season-setup wizard (5-step modal-over-dashboard) —
  mig 114

**Phase 2 leftovers** (carved out deliberately during the cycles —
each small enough to be a single sub-cycle when picked up):
- 2.7b email dispatcher
- 2.9 visual overhaul (drawers + numbered panels + toasts + Framer
  Motion, per the design-tool mockups)
- 2.10 dedicated sub-routes (Fixtures detail / Results / Teams /
  Players / Officials / Pitches / Incidents / Registrations /
  Reports / Settings)
- 2.11 Google OAuth for venue admin
- 2.12 fixture detail page + per-fixture notes

**Remaining phases** (per LEAGUE_MODE_SCOPE.md):
- Phase 3 — Ref view (5 days, "most complex single feature")
- Phase 4 — Reception display (3 days)
- Phase 5 — Player + team-admin competitive (5 days)
- Phase 6 — HQ dashboard (6 days)
- Phase 7 — AI layer / Ask the Gaffer evolved (8 days, largest)
- Phase 8 — Billing + self-serve (5 days, deferred to year 2)
- Phase 9 — Notifications + comms (3 days)
- Phase 10 — Public league pages (2 days, smallest / highest leverage)
- Phase 11 — Cups + knockouts polish (4 days)

Total remaining nominal estimate: ~41 days, plus the ~5 days of
carved-out Phase 2 leftovers.

---

## LEAGUE MODE — PHASE 2 CYCLE 2.8 SHIPPED (session 48, 2026-05-27)

Season-setup wizard. The operator's path from "I want to run a new
season" to "fixtures are persisted and live on the dashboard" is now
a single 5-step flow.

- **mig 114** — `venue_list_active_teams(p_venue_token)` — venue-scoped
  team directory (wider than `venue_get_state.teams` which is
  competition-scoped). Returns every competitive team registered
  into any competition under the caller's venue.
- **`SeasonWizard.jsx`** — single-file multi-step wizard with 5
  inline step components: Basics / Competitions / Teams / Preview /
  Confirm. Modal-over-dashboard, launched from a "Set up new season"
  topbar button.
- Reuses existing engines (`generateRoundRobin`,
  `generateCupBracket`) for client-side fixture preview, and
  existing RPCs (`venueCreateSeason`, `venueGenerateFixtures`) for
  persistence.
- Engine `pitch_index` → `playing_area_id` translation in the submit
  handler, mapping through `season.pitches[index]`.
- Modal extended with a `wide` prop (880px max-width) for the
  wizard layout.

Visual mockups from external design tool reviewed this session but
deliberately NOT adopted — user direction was "build first,
redesign later." Mockup adoption tracked as Cycle 2.9 leftover.

---

## LEAGUE MODE — PHASE 2 CYCLE 2.7d SHIPPED (session 48, 2026-05-26)

Venue dashboard write surfaces. Five action paths from UI through
to live RPCs.

- **Modal pattern** (`Modal.jsx`) — generic dialog reused across
  every write surface. Backdrop blur, Esc-to-close, header/body/foot.
- **Approve/Reject team registration** — Open Issues panel.
  Approve = 1-click. Reject = modal with required reason.
- **Assign pitch** — fixture row → modal → dropdown with
  maintenance-window blocked options pre-disabled.
- **Assign ref** — fixture row → modal → ref dropdown with
  channel + rating shown inline.
- **Change fixture status** — fixture row → modal with status
  picker that branches required fields (postpone/void → reason;
  walkover → winner; forfeit → both).
- **Add/Edit pitch** — sidebar "+ Add" + per-row "Edit" → modal
  with dynamic maintenance-window editor + active/is_available
  toggles.
- **Add/Edit ref** — same pattern; channel + employment_type
  dropdowns; rating numeric.

**mig 113** — `venue_get_state` adds top-level `teams` directory
keyed by team_id (closes the team-name-as-raw-id shortcut from 2.7c).

End-to-end verified via Playwright against the live demo venue:
clicked Approve on a seeded pending registration → DB state flipped
+ audit row written + dashboard refreshed with the row gone.

**Polish deferred to an external design-tool pass** (Framer Motion
animations, optimistic UI, toast notifications) — brief sent to
user this session, written in Vite+React+vanilla-CSS constraints.

**Phase 2 remaining:** Cycles 2.7b (email dispatcher), 2.8 (wizard
UI for season setup).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.7c SHIPPED (session 48, 2026-05-26)

First clickable Phase 2 surface. New `apps/venue/` React app
(10 files: package.json, vite config, vercel config, index.html,
main.jsx, styles.css, App.jsx, Dashboard.jsx, FixtureCard.jsx,
Sidebar.jsx).

- Token-from-URL auth (`?token=` query param or `/venue/TOKEN` path).
- Six-panel responsive layout: Tonight / This Week / Open Issues
  / Recent / Upcoming / Sidebar (pitches + refs).
- Powered entirely by `venue_get_state` (1 round trip per load).
- Score branching covers completed / walkover / forfeit. Status
  pill labels: "Needs pitch" / "Needs ref" / "All set" / "Result"
  / "Walkover" / "Forfeit" / "Postponed" / "Void".
- Maintenance windows surface as a count badge in the sidebar
  pitch list.
- Read-only — no buttons mutate state yet.

Verified end-to-end via Playwright against the live demo venue
(`demo_venue_token_DO_NOT_USE_IN_PROD`). All panels render with
real data; zero console errors apart from missing favicon.

**Known shortcut**: fixture team names render as raw IDs because
venue_get_state doesn't include a team-name directory. Cycle 2.7d
will fix.

**To deploy**: add `apps/venue/` as a new Vercel project + set
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars
(operator action).

**Phase 2 remaining:** Cycle 2.7d (write surfaces — approve/reject
buttons, fixture mgmt modals, pitch/ref CRUD forms), 2.7b (email
dispatcher), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.7a SHIPPED (session 48, 2026-05-26)

End-to-end demo venue seed driving every Phase 2 RPC (migs 110–112).

- **mig 110 — demo venue seed.** Idempotent DO block: venue + league
  + 2 pitches (one with future MW) + 3 refs + season + competition
  + 4 teams + 6 round-robin fixtures (3 completed, 1 walkover, 2
  allocated upcoming) + 1 player. Dates are CURRENT_DATE-relative.
- **mig 111 — venue_get_state + league_get_state upcoming filter
  fix.** Latent bug surfaced by the seed: allocated fixtures were
  excluded from the upcoming bucket, so a pitched fixture would
  vanish until kickoff day. Fix: include 'allocated' alongside
  'scheduled' and 'postponed'.
- **mig 112 — date reshuffle.** One-off live-data fix for the
  initially seeded hardcoded dates (mig 110 source now uses
  current_date-relative arithmetic so future re-seeds are correct
  from the start).

Cycle 2.7 originally scoped as frontend + email + demo together;
split into sub-cycles 2.7a–2.7d. This is a.

**Phase 2 remaining (post Cycle 2.7c):** Cycle 2.7d shipped — see
above. Remaining: 2.7b (email dispatcher), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.6 SHIPPED (session 48, 2026-05-26)

Refs + pitches CRUD plus the maintenance-window enforcement deferred
from Cycle 2.4 (migrations 105–109). Backend half of Phase 2 complete.

- **mig 105** — `venue_add_pitch` — create row with optional
  surface, capacity, sort_order, is_available, maintenance_windows.
- **mig 106** — `venue_update_pitch` — partial update via jsonb;
  soft-delete via active=false; broadcast switches to `pitch_closed`
  on the true→false flip.
- **mig 107** — `venue_add_ref` — create row; preferred_channel +
  employment_type defaulted; table CHECKs enforce enum values.
- **mig 108** — `venue_update_ref` — partial update mirror.
- **mig 109** — `venue_assign_pitch` rewrite — enforces
  `maintenance_windows` overlap against fixture's `scheduled_date`,
  rejects with `pitch_in_maintenance`. Skips check when no date set.

**Phase 2 remaining:** Cycles 2.7 (frontend + email dispatcher + demo
venue seed), 2.8 (wizard UI). All backend RPCs now live.

---

## LEAGUE MODE — PHASE 2 CYCLE 2.5b SHIPPED (session 48, 2026-05-26)

Mid-season team-exit flows + standings cascade for forfeit
(migrations 101–104).

- **mig 101** — `competition_teams.expulsion_reason` + extends
  `notify_venue_change` / `notify_league_change` whitelists with
  `team_expelled` and `fixtures_cascaded`.
- **mig 102 — `venue_withdraw_team`** — pending/active → withdrawn,
  cascade remaining fixtures (walkover to opposing team; void on
  phantom byes). Idempotent.
- **mig 103 — `venue_expel_team`** — active → expelled, same cascade.
  Distinguishable from withdrawal via `void_reason` / status.
- **mig 104 — `get_league_standings_for_player`** rewritten — now
  counts forfeit fixtures (3-0 to forfeit_winner_id, mirror of the
  existing walkover branch). Withdrawn/expelled teams stay in
  standings with accumulated pre-exit points.

Pitch close (maintenance windows) → Cycle 2.6. Ref no-show already
supported via Cycle 2.4's assign_ref(NULL)+reassign.

**Phase 2 remaining (post Cycle 2.7a):** Cycles 2.7b (email
dispatcher), 2.7c/d (venue dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.5a SHIPPED (session 48, 2026-05-26)

Self-serve team registration backend for `/join/CODE` — three RPCs +
one schema add (migrations 097–100).

- **mig 097** — `competition_teams.rejection_reason text` (additive).
- **mig 098 — `join_register_team`** — authenticated-only public RPC.
  Creates a competitive team OR promotes an existing casual one,
  claims caller as `team_admin`, inserts `competition_teams(status=
  'pending')`. Guards duplicate registration on same team_id.
- **mig 099 — `venue_approve_team_registration`** — pending→active,
  idempotent on already-active.
- **mig 100 — `venue_reject_team_registration`** — pending→rejected
  with required reason captured in `rejection_reason`.

Squad collection deferred: the team admin uses the existing
AdminView SquadScreen post-approval. Notification delivery to team
admin (push/email) deferred to Cycle 2.7 — RPCs emit audit + broadcast
hooks so the dispatcher can subscribe.

**Phase 2 remaining (post Cycle 2.7a):** Cycles 2.7b (email
dispatcher), 2.7c/d (venue dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.4 SHIPPED (session 48, 2026-05-26)

Fixture management RPCs for the operator dashboard. Three single-row
mutating RPCs + a forfeit-storage schema addition (migrations 093–096).

- **mig 093** — `fixtures.forfeit_winner_id` (text FK → teams ON
  DELETE SET NULL) + `fixtures.forfeit_reason`. `fixtures_status_check`
  expanded additively to include `'forfeit'`. Caught proactively by
  the new `pg_constraint` sweep mandate.
- **mig 094 — `venue_assign_pitch`** — sets/clears
  `fixtures.playing_area_id`. Auto-bumps scheduled↔allocated. Validates
  pitch is active + is_available + in caller's venue.
- **mig 095 — `venue_assign_ref`** — sets/clears `fixtures.official_id`.
  Audit/broadcast distinguishes assigned / changed / cleared.
- **mig 096 — `venue_update_fixture_status`** — drives the four
  operator-initiated terminal transitions (postpone, void, walkover,
  forfeit) with per-status validation + winner/reason metadata.

Standings update for forfeit (and the team-withdrawal cascade)
deferred to Cycle 2.5b, per the deferral already documented in mig 087.

**Phase 2 remaining:** Cycles 2.5a (team registration), 2.5b
(mid-season failures + standings cascade), 2.6 (refs+pitches CRUD),
2.7 (frontend + email + demo venue), 2.8 (wizard UI). ~3–4 days.

---

## LEAGUE MODE — PHASE 2 CYCLES 2.1–2.3 SHIPPED (session 48, 2026-05-26)

The first half of Phase 2 (League Mode customer-visible surfaces) is
live as DB + JS modules. Cycles 2.1, 2.2, 2.3 shipped end-to-end with
matching `_down.sql` files and proactive in-flight CHECK-constraint
hotfixes.

**Cycle 2.1 — Foundation + operator-led onboarding (commit `03bd4be`):**
- Migs 083–085: `venues.live_channel_key`, `leagues.league_code` (8-char
  alphanumeric) + `live_channel_key` + `squad_mode` + `squad_mode_locked_at`
  + `standings_visibility`, `match_officials.employment_type` +
  `overall_rating`, `playing_areas.is_available` + `maintenance_windows`,
  `competition_teams.status` DEFAULT flipped to `'pending'`.
- Resolver helpers: `resolve_venue_caller`, `resolve_league_caller`.
- Realtime publishers: `notify_venue_change` (25 reasons),
  `notify_league_change` (11 reasons) — separate
  `venue_live:`/`league_live:` channels from `team_live:`.
- **Primary onboarding tool**: `superadmin_create_venue` RPC +
  `/superadmin/venues/new` form on `apps/superadmin`. Self-serve
  signup (original Phase 8) deferred to year 2 per DECISIONS.md.

**Cycle 2.2 — Read RPCs (commit `f940c32`):**
- `venue_get_state` — full venue dashboard payload with fixtures
  bucketed tonight / this_week / upcoming / recent.
- `league_get_state` — narrower deep-link, falls back to league-pick
  prompt when caller is a venue admin.
- `join_get_league_by_code` — public `/join/CODE` landing.
- `get_league_standings_for_player` — W/D/L/GF/GA/GD/Pts across every
  competition the player is in; walkovers default to 3-0; top scorers
  stubbed until Phase 3 `match_events`.

**Cycle 2.3 — Engines + season setup (commit `71b8aab`):**
- `packages/core/engine/roundRobin.js` — circle method with home/away
  balance, pitch×slot allocation, doubleRound mirror, excludeWeeks.
- `packages/core/engine/cupBracket.js` — single elim (byes to top
  seeds + bracket placeholders) + group stage (snake-seeded).
- `venue_create_season` RPC — creates season + competitions, validates
  league ownership + date order + types.
- `venue_generate_fixtures` RPC — bulk-persists engine output, validates
  everything (competition ownership, no existing fixtures, every team
  active, every date in season, every pitch in venue), **one audit
  row** per generation.

**In-flight CHECK-constraint hotfixes** (migs 088/089/092 — full
detail in BUGS.md): `competition_teams.status` enum, RPC body
references to non-existent `incidents.status` + invalid
`'registration_open'`, `audit_events.actor_type` whitelist. Pattern
captured in DECISIONS.md "SCHEMA-SYNC MUST SWEEP `pg_constraint`".

**Customer-visible impact: zero (Phase 2 frontend lives in Cycle 2.7).**
Backend ready for the wizard UI; superadmin onboarding form ships
but pending the `apps/superadmin` env-var fix in BUGS.md.

**Decisions captured in DECISIONS.md (session 48):**
- Operator-led onboarding for year 1, Phase 8 deferred.
- `/league/TOKEN` merges into `/venue/TOKEN`.
- Existing casual teams stay venueless forever.
- Squad mode per-league, locked at first fixture.
- Bulk-RPCs audit one row, not N.

**Phase 2 remaining (post Cycle 2.7a):** Cycles 2.7b (email
dispatcher), 2.7c/d (venue dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASES 0 + 1 SHIPPED (session 40, 2026-05-25)

Two phases of `LEAGUE_MODE_SCOPE.md` landed end-to-end:

**Phase 0 — Foundation (migrations 050–054):**
- `league_config` table + `useLeagueConfig` hook + multi-sport posture
- `matches.match_type`, `teams.team_type`, `player_match.match_type` columns
- `notify.js` channel abstraction (dry-run by default; Phase 9 plugs Twilio)
- `company_domains` table + AuthCallback hook
- `create_team` RPC extended with `p_team_type` (default 'casual')
- `player_career` split into casual_*/competitive_*/total_* + `sync_player_career` RPC

**Phase 1 — Core data model (migrations 055–057):**
- 20 new tables: companies, company_admins, billing_events, clubs, venues,
  venue_admins, `playing_areas` (multi-sport rename of `pitches`),
  `match_officials` (multi-sport rename of `referees`), leagues, seasons,
  competitions, club_teams, competition_teams, team_name_history,
  cup_rounds, fixtures, match_events, player_registrations, incidents,
  hq_preview_tokens
- 13 new columns on existing tables (teams, matches, players, player_match)
- Phase-0 FK constraints retroactively added; `get_company_by_domain`
  extended to JOIN companies

**Multi-sport posture recorded in DECISIONS.md (session 40).** Zero
renames of existing identifiers; all new identifiers generic; future
sport-specific stats go into a `sport_stats jsonb` column when sport #2
lands.

**Customer-visible impact: zero.** Spine in place; Phase 2 will be the
first phase that builds customer-facing surfaces on top.

**Also this session:** MyView double-count hotfix (PlayerView.jsx — was
adding ledger balance + this-week's price for a phantom £10 instead of
the real £5). Commits `a8dd46d` + `ab6484f`.

---

---

## PHASE 1 — COMPLETED

| Feature | Status | Notes |
|---|---|---|
| Rotate Supabase keys | ✅ | New key in CONTEXT.md INFRASTRUCTURE |
| PlayerView redesign | ✅ | Session 6 |
| StatsView rebuild | ✅ | IO Statbook |
| HistoryView rebuild | ✅ | Results screen |
| AdminView rebuild | ✅ | Session 6 |
| player_match + player_career tables | ✅ | Session 6 |
| player_injuries table | ✅ | Session 6 |
| Teams confirmed view | ✅ | Form dots, POTM trophy, bibs indicator |
| Demo environment | ✅ | team_demo, 25 players, 22 matches, /demoadmin, auto-reset |
| POTM + Results display text | ✅ | POTM not MOTM, Results not History in UI |
| My IO screen | ✅ | MyIOView.jsx, useIOIntelligence.js — session 8 |
| POTM voting system | ✅ | Modal, cron jobs, push, admin tiebreak — session 10 |
| ScoreScreen | ✅ | 6-stage progressive flow, score_type, last_goal_scorer — session 11 |
| Admin view consistency | ✅ | Sticky heroes, 5-tab admin nav, Gaffer disabled — session 12 |
| Player League Table | ✅ | PlayerLeagueTable.jsx + getPlayerLeagueTable — session 20 |
| Admin screens redesign | ✅ Done | ScheduleScreen ✅ (s13), TeamsScreen ✅ (s21), SquadScreen ✅ (s22), BibsScreen ✅ (s28) |
| Vice Captain system | ✅ | VC toggle, PlayerProfile ROLES, HeroCard ADMINS, access gating — sessions 22–23 |
| Payments admin screen | ✅ | PaymentsScreen.jsx — 4-section layout, ledger dedup — session 22 |
| Stats rewrite (player_match) | ✅ | All leaderboards from player_match via getPlayerLeagueTable — session 22 |
| Payment ledger dedup | ✅ | createLedgerEntry resilient insert, partial-index-aware — sessions 22–23 |
| Head to Head card | ✅ | 5-section, 5-verdict chemistry, period selector — sessions 22–23 |
| Pre-launch /create + /join audit | ✅ | user_id propagation, protocol fix, iOS-only redirect gate — session 23 |
| Onboarding redesign | ✅ | SetupLoadingScreen + SquadReady, AddPlayers removed — session 27 |
| JoinSuccess install screen | ✅ | Platform-detected (iOS/Android/desktop) — session 8 |
| RLS + security hardening | ✅ | 47 SECURITY DEFINER RPCs, all 19 tables locked — session 24 |
| /create auth gate | ✅ | Hard auth gate + ioo_pending_route sessionStorage — session 24 |
| team_admins table | ✅ | Written by create_team RPC — session 24 |
| link_player_to_user RPC | ✅ | Authenticated-only, migration 022 — session 24 |
| All player_match reads via RPC | ✅ | get_team_state_by_player_token extended — session 25 |
| Multi-team player switcher | ✅ | player_get_teams RPC, MySquads.jsx — session 26 |
| is_vice_captain cross-team fix | ✅ | Migrated to team_players, migration 026 — session 26 |
| Live board POTM + bibs + form dots | ✅ | lastMatchMeta + playerForm via RPC — session 25 |
| Teams confirmed realtime | ✅ | confirmedThisSession ref, teamsConfirmedRef — session 25 |
| POTM voting RLS fix | ✅ | submit_potm_vote + get_potm_voting_state RPCs — session 25 |
| Join/login redesign | ✅ | Full JoinTeam.jsx rebuild — session 27 |
| Dead code cleanup | ✅ | Pre-RLS direct writes removed — session 28 |
| Manage Squad redesign | ✅ | Modern card-row, status-ring avatars, inline rename, per-row icon toggles, overflow ⋯ menu, filter chips, stagger fades — session 34 |
| Guest-only add bar | ✅ | Regulars self-onboard via invite link; admin add bar is now single-line guest-only — session 34 |
| Admin manual status (in/out/maybe/reserve) | ✅ | Status pills inside ⋯ menu; sets admin_locked_in so player can self-decline but not self-restore IN; server-side squad-cap gate on both admin and player paths; injury-override confirm modal. Migration 038. — session 34 |
| AdminView/index.jsx extraction | ✅ | PlayerProfile, POTMTiebreakModal, AnnounceModal split into own files; 1,544 → 976 LOC. Latent pendingTiebreak ReferenceError fixed in flight. — session 35 |
| PaymentsScreen redesign | ✅ | Inline £X PAY pill (1-tap mark paid), ⋯ overflow menu (Reset/Waive/Open Ledger), status-ring avatars, section glow, glass cards, pop-flash on just-paid, stagger fade-in. Backend untouched. — session 35 |
| ScheduleScreen + TeamsScreen polish | ✅ | Glass form sections, gold-glow titles, hardcoded radii (8/10/12/20) replaced with token vars. No interaction change. — session 35 |
| Player self-profile screen | ✅ | New unified PlayerProfile.jsx. Avatar overlay top-left on PageHeader (also recentred IN OR OUT logo). Three lazy-load sections: Stats / Payment History / Injuries. Migration 039 (get_my_payment_history + get_my_injuries). — session 35 (PROFILE_SCOPE A) |
| Leave squad (self) | ✅ | Two-tap confirm. Refuses with `debt_owed:<amount>` if owes > 0. Detaches team_players + push_subscriptions; preserves player row + history. Migration 040 (leave_squad RPC). — session 35 (PROFILE_SCOPE B) |
| Delete account (self) | ✅ | Typed-DELETE modal. Anonymises players row (name → "Deleted player") preserving FKs; detaches all teams; deletes push_subscriptions + player_career; revokes admin grants; calls auth.admin.deleteUser via /api/delete-account edge function. Refuses with `last_admin:<csv>` if user is sole admin of any team. Migration 040 (delete_my_account RPC). — session 35 (PROFILE_SCOPE B) |
| PlayerProfile admin mode merge | ✅ | Single file serves both modes behind isAdminView prop. Admin mode adds "Admin view" pill, branched RPCs (admin paths), ROLES with VC toggle, Admin Actions card (Rename/Copy/Reset link/Mark injury), Remove from squad with has_history guard surfaced. AdminView/PlayerProfile.jsx (374 LOC) deleted. — session 35 (PROFILE_SCOPE C) |
| First-time-use tooltips | ✅ | New `FirstTimeHint` primitive (framer-motion + localStorage, chained via `prerequisite` key, `ioo-hint-dismissed` event syncs duplicate mounts). 12 hints across AdminView (live-toggle global, key preserved), Squad invite link, Teams (tiles → SMART → CONFIRM chained), Payments unpaid section, Bibs holder, PlayerView status grid, StatsView league table (H2H discovery), HistoryView first match, PlayerProfile leave button. Pre-execute audit confirmed zero DB/RPC/auth/env touched. — session 38 |
| Pre-Beta launch fix: player_join_team token | ✅ | Migration 044. New-player INSERT branch now generates a player token. Pre-fix, first-time joiners landed with NULL token → JoinSuccess.jsx fell back to `/`. Caught and fixed in the audit before the real team's invite link went out. — session 39 |
| Super-admin dashboard Phase 1+2 (read-only) | ✅ | New `apps/superadmin` app at `https://platform-superadmin-djj9b1w8x-tarny-s-projects.vercel.app`, Vercel SSO-gated. Three tabs: Activity (audit_events tail), Teams (sortable list), Team Detail (drilldown). Migrations 045 (platform_admins + is_platform_admin + superadmin_whoami) + 046 (3 read RPCs). All RPCs gated by global cross-team auth helper. Phase 3 (token rescue) + Phase 4 (data fix) write tools deferred. — session 39 |
| Workspace-deps guard hook | ✅ | New `Skills/scripts/check-workspace-deps.sh`. Validates every `@platform/*` dep in every `apps/*/package.json` + `packages/*/package.json` maps to a real workspace package — wired into the pre-commit build gate. Sub-second jq check. Makes the "fake-alias-as-dep" bug class (which broke platform-clubmanager's CI when superadmin shipped) structurally impossible going forward. Plus `@platform/supabase` alias eliminated entirely; 22 source files migrated to import from `@platform/core/storage/supabase.js`. — session 39 |
| Push notification pipeline operational | ✅ | Three-layer fix: VAPID env vars set with real values (were stored as empty strings since the original platform-clubmanager deploy 13 days prior), all 6 pg_cron jobs rewritten apex → www (apex 307s strip the Authorization header at the redirect → 401), pg_cron job 5 syntax error fixed. Verified end-to-end at the 19:45 UTC cron tick: 4× HTTP 200 vs 4× HTTP 401 at 19:30 baseline. Migration 049 adds `player_account_deleted` to `notify_team_change` whitelist. **In-app subscribe flow not yet exercised on a real device** — proof-on-device deferred. — session 39 |
| Defense-in-depth: admin_save_teams scoping | ✅ | Migration 048. Adds `team_players` scope to the two `UPDATE players SET team='A'/'B'` statements in admin_save_teams (the CLEAR was already scoped). Closes a cross-team write surface where a legit admin for team X could pass team Y player_ids in p_team_a/p_team_b and flip their team column. Verified live with adversarial + happy-path tests inside rolled-back transactions. — session 39 |

---

## PHASE 1 — BLOCKED

| Feature | Blocker |
|---|---|
| Stripe Connect | Needs Stripe platform account setup |
| Apple Sign In | Needs Apple Dev account £79 |

---

## PHASE 2 — TARGET MAY 26 (Stage 2)

| Feature | Status | Notes |
|---|---|---|
| **Bug fixes (Pre-UAT)** | ✅ All cleared session 28 | No Pre-UAT blockers remaining |
| **Mid-game team switches** | ✅ Done session 28 | ScoreScreen new stage, team_switches jsonb, final team → W/L/D. See DECISIONS.md for spec. |
| **Most Faced Opponent card** | ✅ Done session 32 | Unlocks at 4+ games. Amber badge, computed client-side via `computeDeeperIntel`. |
| **Reliability Ranking card** | ✅ Done session 32 | Unlocks at 5+ games. Cyan badge, shows top reliable + your rank, min 3 squad games to be ranked. |
| **IO deeper-intel cards rewired** | ✅ Done session 32 | Most Played With, Team Impact, Nemesis, Best Partnership were dead UI (hook nulled keys, no upstream computation). Now powered by `packages/core/engine/deeperIntel.js`. See BUGS.md B7. |
| **Monday Footy onboarding** | 🔲 Pending | Stage 2 addition — if Stage 1 week 1 clean |
| owes double-increment guard | ✅ Done session 26 | carryForwardDebts removed; updatePlayerRecords is sole path |
| Multi-team player switcher | ✅ Done session 26 | MySquads.jsx |

---

## PHASE 2 — BACKLOG (pre-broader-beta ~Jun 9)

| Feature | Notes |
|---|---|
| BibsScreen fix under RLS | See BUGS.md #1 |
| CreateTeam email pre-fill | ✅ Done session 29 |
| "Make game live" new admin hint | ✅ Done session 29 |
| Install screen on create flow (SquadReady) | ✅ Done session 30 — shared `InstallSection` extracted from JoinSuccess, inlined into SquadReady with sticky "Go to my team" CTA. Desktop copy-link targets admin URL. |
| Last goal scorer in IO Intelligence | `last_goal_scorer` field on matches — just wire into a card |
| Bib streak insight | Consecutive bib games — data in `bib_history` |
| WhatsApp share text update | Update share copy in HistoryView |
| BibsScreen RLS write fix | BibsScreen redesigned ✅; standalone write still broken — see BUGS.md #2 |
| **Smart Teams TeamsScreen redesign** | ✅ Session 31 — full live-board rewrite. Auto-Smart fires on entry when no teams set; LiveBoard mirrors PlayerView's confirmed-teams tile (Team A \| B grid with chips); tap-to-move between teams; SMART panel open from start with Group 1 + Group 2 seeded; BUILD TEAMS contextual CTA only when groups dirty; prediction recomputes on every manual move; prediction chip hides when one side is empty; PLAYERS row list removed entirely; bottom CONFIRM TEAMS button (was ambiguous "DONE"). |
| **Smart Teams adoption analytics** | ✅ Session 31 — `team_confirmed` PostHog event as analytical anchor + `team_drafted_auto` / `team_player_moved` / `team_regenerated` / `team_cleared`. Tracks manual_moves_before/after, regenerate_count, was_ai_picked_as_is, is_recommit. Single-filter answers to "is the algorithm being trusted?" |
| **Admin home polish** | ✅ Session 31 — cancel-then-relive bug fixed via new `admin_reopen_week` RPC (creates fresh match, cancelled stays in history). Game-live toggle: "Make this week's game live" when off; collapses to a "LIVE" badge when on (no toggle, admin uses Cancel This Week). This Week tiles moved up to immediately after the toggle. Notifications block removed from Match Settings (duplicate of Notifications tab, demo confusion). |
| **Player status tile rework** | ✅ Session 31 — weekday now derives from admin-configured `dayOfWeek` first (was deriving wrong day from drifted `gameDateTime`). Locked-in banner slide-fades after 5s. Pre-response prompt nudges with "Tap below ↓"; collapses to date+kickoff after response. Status row pulses gold while unresponded; flashes status-matched colour on tap (in→green, out→red, maybe→amber, reserve→purple). Haptic tap-tick (Android only — iOS Safari no-ops). Banners suppressed on page refresh. |
| **Smart Teams** (internal: Group Balancer) | ✅ Built + live session 30 (May 22). Schema + 2 new RPCs (`admin_set_player_group`, `admin_clear_all_groups`) + 3 modified RPCs applied via migration `031_group_balancer_stage_1b`. Pure algorithm `packages/core/engine/groupBalancer.js` (sample-200 for big groups, lower-headcount odd-extra rule, win-rate-nudged splits within 5% noise floor). UI: tap-to-move panels, inline labels, IO Prediction card, Needs Group amber banner, ADD/× empty panels (panel persists once populated — × dismisses only when empty). HistoryView prediction chip (null-safe, forward-only). Replaces Fisher-Yates; no feature flag — always on. PostHog `posthog.group('team', teamId)` identification added (enables per-team analytics + future flag targeting). Deferred to Phase 2: `teams_draft` group snapshot (predicted_winner is already saved at confirm so the accuracy stat works without it). |
| **Ask the Gaffer — Phase 1 (AI agent layer)** | First production phase of the platform's AI agent layer — not a chatbot. Grounded football-operations agent (every output backed by a Supabase query, never invents facts). Phase 1 surfaces: team summary, payment summary, attendance risk, matchday briefing, Q&A panel. Provider locked in (Vercel AI Gateway → Anthropic `claude-sonnet-4-6`); data-access pattern locked in (`gaffer_get_context_*` RPCs + `ai_briefings` audit table); awaiting AI Gateway credits / Anthropic key signup before live build. Full spec: `GAFFER.md`. |
| **Marketing landing page** | Conditional render at root (Option A) for beta — unauth + no token → landing, else app shell. See DECISIONS.md. |

---

## PHASE 3 — MONTH 2+

| Feature | Notes |
|---|---|
| iOS + Android native | Capacitor |
| Apple Sign In native | After Dev account |
| Apple Watch goal logger | ~28h. Requires Capacitor iOS first + Apple Dev account |
| Venue white-label | After user numbers |
| Booking integration | Needs venue API |
| WhatsApp Business API | Phase 3 notifications |
| Club Manager | Second product, B2B |
| Grassroots app | Full stats: assists, cards, ratings |
| In or Out Ltd | Companies House £12 |
| Trademark | ~£170 UK |
| Super admin dashboard | Read-only, Tarny only. Required for PUBLIC launch. |
| IO Wrapped | End of season shareable card |
| Monthly summary notifications | End of month push |
| Streak notifications | 3/5/10 game streaks |
| Random player signup | Postcode, availability |
| Admin find a random | Radius search, ping system |
| Player profile cross-team | Career stats, player_career table |

---

## PHASE 4 — LEAGUE MODE (superseded — now active)

Previously parked as a future sales pitch ("run your league free for one season"). Superseded by the active **League Mode** programme — Phases 0 + 1 already shipped (see top of file). Phase 2 onwards in `LEAGUE_MODE_SCOPE.md`.

---

## ASK THE GAFFER — AI AGENT LAYER

**This is the platform's AI agent layer, not a chatbot.** Grounded
football-operations agent. Every output backed by a Supabase query
(`context_snapshot` jsonb on every `ai_briefings` row). LLM narrates and
patterns — it never invents facts. Four-phase trust-graduated rollout.
Full spec lives in `GAFFER.md` — read that before any Gaffer work.

**Provider + data-access pattern (locked in):**
- LLM: Vercel AI Gateway → Anthropic `claude-sonnet-4-6`
- Context: per-surface `gaffer_get_context_*` RPCs (SECURITY DEFINER)
- Runtime: Vercel edge function `apps/inorout/api/gaffer.js`
- Audit: `ai_briefings` table — every output row links to its context snapshot
- Cost: ~£0.004 per briefing, £20/month covers ~5000 briefings

**Sequencing:** Phase 1 lands after Group Balancer (done s30). Group
Balancer's `generateBalancedTeams` becomes a building block for Phase 2
fair-team suggestions.

| Phase | Capability | Status |
|---|---|---|
| 1 — Read-only assistant | Q&A panel, team summary, payment summary, attendance risk, matchday briefing | 🟡 Scaffold + DB complete session 33. Migrations 033–037 applied to live DB via MCP and smoke-tested against `team_demo` (all four RPCs return real data). Edge function `/api/gaffer`, prompts, `GafferCard`, admin Q&A panel, JS wrappers all shipped. Awaiting: Anthropic key confirm on Vercel + AdminView wire-up (canary on one team first). See GAFFER.md "IMPLEMENTATION STATUS". |
| 2 — Recommendations | Fair team suggestions, reserve recs, payment chase drafts, weekly match summary, player insight explanations | 🔲 Not built |
| 3 — Confirmed actions | "Send chase", "Notify reserves", "Use these teams", "Post match summary", "Confirm payment reminders" — admin one-tap approve, all via existing SECURITY DEFINER RPCs | 🔲 Not built |
| 4 — Semi-autonomous | Auto-detect short squads, auto-draft notifications, auto-suggest reserve pings, auto-produce weekly admin report. Player-visible actions still require approval (hard rule). | 🔲 Not built |

---

## IO INTELLIGENCE — UNLOCK GRID

| Games | Unlocks |
|---|---|
| 1+ | Goals, POTM, W/L/D, Attendance ring, Reliability, Form strip |
| 2+ | Win Rate card ✅ built |
| 3+ | Current Run card ✅ built |
| 4+ | Most Faced Opponent ✅ built |
| 5+ | Reliability Ranking ✅ built |
| 6+ | Most Played With card ✅ built |
| 7+ | Team Impact card ✅ built |
| 8+ | Nemesis, Best Partnership, Advanced Chemistry cards ✅ built |
| 16+ | Legacy Insights ✅ built |

---

## EVENT OS — TOURNAMENT, LEAGUE & SPORTS DAY HOSTING (session 114 — planning complete)

**Status: Planned. No code written. Full spec in `/Users/tarny/.claude/plans/what-happens-if-there-zesty-wreath.md`**

### Strategic framing
An Event OS — a time-bounded orchestration layer sitting above the existing platform stack (casual squad → competition → venue → club OS). Spins up for a tournament or sports day, coordinates resources across all layers simultaneously, then closes — leaving permanent data in every layer below. Competitive target: Tournify (€40–120/tournament). Platform makes hosting **free** for clubs; takes ~5% cut of entry fees collected via Stripe.

### Architecture: `tournament_events` as the OS container
```
tournament_events
├── competitions[]          (competition layer — match-based sports)
├── performance_events[]    (new — athletics/performance model)
├── playing_area_bookings[] (venue layer)
├── participant_clubs[]     (club OS)
├── schedule_config         (scheduling engine)
├── branding_config         (public page identity)
├── points_config           (cross-event standings aggregation)
└── sponsors[]              (commercial layer)
```

### Sport-agnostic framework
Built for sports days, works for any club sport. Adding judo, padel, cricket later = 1–2 sprints configuration, not a rebuild. Key: `ref_ui_config` on `league_config` makes the ref app sport-configurable (judo gets ippon buttons, not goal buttons); `sport_types[]` on `playing_areas` gates surfaces by sport.

### Account relationship system (co-required — Phase 0)
`get_user_relationships(uid)` determines which home screen to show. Four distinct home experiences:
- **Squad player** (existing): current In or Out home, unchanged
- **Club athlete**: next session / next fixture
- **Parent / guardian**: child's schedule, Follow Live, notifications — zero squad mechanics
- **Multi-relationship**: unified chronological feed across all active relationships

Parent home screen is a first-class persona. Guardian links via existing Phase 10–12 consent RPCs; missing piece is the UI flow and parent-specific home screen + Follow Live view.

### Build phases
| Phase | Delivers | Status |
|---|---|---|
| 0 — Account relationship routing | Unified feed, parent home, adaptive nav | ✅ Complete (mig 314 RPCs + UI s118) |
| 1 — OS Container | `tournament_events` schema, club admin creates tournament, sport-configurable ref app | ✅ Complete (migs 315+316 s119) |
| 2 — Invitations & Registration | External clubs join, pay entry fee, waitlist | ✅ Complete (mig 317+318 s120+s121) |
| 3 — Scheduling & Day Ops | Auto-schedule, drag-drop grid, director command view | ✅ Complete (mig 319 s122) |
| 4 — Public Page | `in-or-out.com/tournament/[slug]`, live bracket, printed schedule | ✅ Complete (mig 321, s124) |
| 5 — Correctness | H2H tiebreaker, classification brackets, double-elim, card auto-suspension | ✅ ALL COMPLETE: 7A H2H (mig 322, s125) + 7B cards (mig 323, s126) + 7C brackets (mig 324, s127) + 7D double-elim (mig 325, s128) |
| 6 — Performance Events | Athletics model, judge interface, overall sports day standings | ✅ Complete (mig 326, s129) |
| 7 — Commercial | Sponsors, branding, Player of Tournament, equipment hire bundle | ✅ Complete (mig 327, s130) |

**Phase 0 RPCs shipped (mig 314, session 117, commit 58f2d1f):** `get_user_relationships()` (routing oracle — squads/clubs/guardian_of/competitions/admin_roles), `get_unified_home_feed()` (14-day chronological feed), `get_guardian_home_feed()` (per-child session feed), `get_child_live_match(uuid)` (Follow Live with guardian ownership guard). All SECDEF/authenticated-only/anon revoked. JS wrappers `getUserRelationships`/`getUnifiedHomeFeed`/`getGuardianHomeFeed`/`getChildLiveMatch` added to packages/core. Security sweep 4/4 PASS. Build clean.

**Phase 0 UI ✅ shipped (session 118, commit 5873d91):** App.jsx homeScreenType routing (derived const, null-guard = zero-footprint for squad-only users); 3 new screens: `UnifiedFeedScreen.jsx` (14-day chronological feed, live/upcoming sections, squad_game/club_session/child_event tap handlers), `ParentHomeScreen.jsx` (per-child ChildCard + next session + Follow Live CTA), `FollowLiveView.jsx` (getChildLiveMatch + venue_live realtime channel, ScoreBoard + EventRow). Zero-footprint confirmed: unauthenticated squad-only users unchanged.

**Phase 1 (migs 315–316) ✅ COMPLETE (session 119):** Schema applied. Three club-manager RPCs: `club_admin_create_tournament`, `club_admin_list_tournaments`, `club_admin_get_tournament`. UI: Tournaments tab in SessionsScreen + `/tournament/[slug]` public stub.

**Phase 2 (mig 317) ✅ COMPLETE (session 120):**
- `get_tournament_public(slug)` — anon RPC; JOINs clubs+venues; guards status='draft'; wired into TournamentScreen.jsx (loading/not-found/live states).
- `club_admin_update_tournament_status(slug, status)` — free lifecycle transitions (draft→open→live→completed); audits `tournament_status_changed`; wired as inline status `<select>` on each tournament card in SessionsScreen.
- Venue picker: create-tournament modal now renders a `<select>` populated from `memberProfile.active_clubs[i].venues` (already loaded via `member_get_self` mig 308) instead of a plain text input. Auto-selects if only one venue.

**Phase 3 (mig 318) ✅ COMPLETE (session 121):**
- Schema: `competitions.season_id` → nullable + identity CHECK; `competition_teams.team_id` → nullable + `team_name text` col + identity CHECK; CREATE TABLE `tournament_invitations` (14-day expiry, 12-char hex code).
- 6 new RPCs: `club_admin_add_competition`, `club_admin_register_team`, `club_admin_send_team_invite`, `club_admin_approve_team`, `club_admin_reject_team`, `tournament_join_via_invite`.
- Extended: `get_tournament_public` now returns `competitions[]` with active `teams[]`; `club_admin_get_tournament` now returns teams per competition (all statuses).
- UI: SessionsScreen tournament cards expand inline showing competitions + teams + pending approval queue + invite link generator. TournamentJoinScreen at `/tournament/join/:code`.
- Bug caught+fixed by EV: `gen_random_bytes` unavailable in `public,pg_temp` search_path (pgcrypto in `extensions` schema). Fixed to `extensions.gen_random_bytes()`.
- EV: 11/11 PASS, leak-clean. Security sweep: 8/8 PASS.

**Phase 4 (mig 319) ✅ COMPLETE (session 122):**
- Schema: `fixtures.home_competition_team_id` + `away_competition_team_id` (uuid FK to competition_teams, nullable); `fixtures.home_team_id` dropped NOT NULL + identity CHECK (home_team_id OR home_competition_team_id must be non-null).
- 3 RPCs: `club_admin_generate_schedule` (circle-method round-robin, concurrent pitch cycling, odd-N bye, audit_events), `club_admin_get_schedule` (full timetable + venue pitches), `club_admin_assign_fixture_slot` (COALESCE update, audit_events). All SECDEF/authenticated-only/anon revoked.
- UI: SessionsScreen per-competition fixture timetable (grouped by round) + "Generate schedule" button (shown when ≥2 active teams, no fixtures yet) + `GenerateScheduleModal` (date/time/slot/pitch picker) + director "Full Timetable" section (all competitions sorted by kickoff).
- EV: 7/7 PASS (not_authenticated, not_enough_teams, 2-team schedule, fixture persisted, fixtures_already_exist, assign-slot, get-schedule). Leak-check: all zeros. Security sweep: 3/3 PASS.

**Phase 5 (mig 320) ✅ COMPLETE (session 123):**
- Schema: `fixtures.current_period text` column — persists HT/2H/etc. to DB so period survives a referee page-reload (fixes the clock reset bug).
- `get_fixture_state_by_ref_token` REPLACED — now resolves team names from `competition_teams` when `home_team_id IS NULL`; adds `home/away_competition_team_id` + `current_period` to fixture payload. Backward-compatible: league fixtures unchanged.
- 5 new tournament-specific RPCs (all SECDEF, anon+authenticated): `ref_start_tournament_match` (status→in_progress, current_period=1H; no match_events insert — team_id FK to teams blocks competition_team ids), `ref_set_tournament_period` (persists HT/2H to fixtures), `ref_record_tournament_goal` (increments home_score/away_score directly; own_goal flag; full audit trail; returns authoritative score), `ref_undo_tournament_goal` (decrements, floor 0), `ref_confirm_tournament_match` (status→completed, current_period=FT).
- 1 new director RPC (SECDEF, authenticated-only): `club_admin_get_standings` (P/W/D/L/GF/GA/GD/Pts from completed fixtures, club ownership guard).
- JS wrappers: `refStartTournamentMatch`, `refSetTournamentPeriod`, `refRecordTournamentGoal`, `refUndoTournamentGoal`, `refConfirmTournamentMatch`, `clubAdminGetStandings`.
- Ref app — PreMatch.jsx: isTournament detection → calls `refStartTournamentMatch` instead of `refStartMatch`.
- Ref app — LiveMatch.jsx: `isTournament` branches throughout; `tournamentPeriod` state (from `fixture.current_period`) replaces `derivePeriod(events)` so period survives reload; score from `fixture.home_score/away_score` not `match_events`; per-team conditional — squad present → existing TeamColumn (player picker); squad empty → `TournamentGoalButton` (big GOAL button); undo toast calls `refUndoTournamentGoal`; confirmFT calls `refConfirmTournamentMatch`.
- Director — SessionsScreen.jsx: Full timetable shows score inline + Ref button per fixture (copies `https://platform-ref.vercel.app/?token=<ref_token>`). Per-competition fixture rows: score highlighted when known + Ref button. Standings table computed client-side from `scheduleData` once any match is complete.
- Security sweep: 7/7 PASS (all SECDEF, search_path, overload=1, grants). Build: both inorout + ref clean. Hygiene: 7/7 PASS on all 4 edited files.
- Commit: `b3d9f98`. Next migration: 321.

**Phase 6 (mig 321) ✅ COMPLETE (session 124):**
- No schema changes — extends `get_tournament_public` (CREATE OR REPLACE, same anon+authenticated grant) to add two new fields to the return object:
  - `fixtures[]` — all tournament fixtures across all competitions: competition_id/name, round, round_name, scheduled_date, kickoff_time (HH:MM formatted server-side via to_char), pitch_name (JOIN playing_areas), home/away team names (from competition_teams), home/away scores, status, current_period. Ordered by scheduled_date then kickoff_time (NULLS LAST).
  - `standings[]` — per competition: team_name + P/W/D/L/GF/GA/GD/Pts from completed fixtures. Same 3pts/win 1pt/draw arithmetic as `club_admin_get_standings` (mig 320). Only active competition_teams included.
- `TournamentScreen.jsx` full rewrite: scrolling public page with three sections — **Header** (name, status badge, date/venue/club, Print button), **Schedule** (fixture rows grouped by date: time, home vs away, score/vs, status chip + pitch name), **Standings** (per-competition P/W/D/L/GF/GA/GD/Pts table, only rendered when ≥1 fixture completed). GD column coloured green/red. 30-second live poll when `tournament.status === 'live'` (tournament write RPCs don't broadcast). Print button: `window.print()` + `@media print` collapses to black-on-white schedule + standings (`.print-hide` strips nav/button).
- Hygiene: 7/7 PASS (print `#fff`/`#000` → `white`/`black` named keywords; `#ddd` → `gainsboro`). Build: PASS.
- Commit: `312ec78`. Next migration: 322.

| 4 — Public Page | `in-or-out.com/tournament/[slug]`, live bracket, printed schedule | ✅ Complete (mig 321, s124) |
| 5 — Correctness | H2H tiebreaker, classification brackets, double-elim, card auto-suspension | ✅ ALL COMPLETE: 7A H2H (mig 322, s125) + 7B cards (mig 323, s126) + 7C brackets (mig 324, s127) + 7D double-elim (mig 325, s128) |
| 6 — Performance Events | Athletics model, judge interface, overall sports day standings | ✅ Complete (mig 326, s129) |
| 7 — Commercial | Sponsors, branding, Player of Tournament, equipment hire bundle | ✅ Complete (mig 327, s130) |

**Phase 7A (mig 322) ✅ COMPLETE (session 125):**
- H2H tiebreaker added to all three standings computation paths:
  - `club_admin_get_standings(uuid, uuid)` — CTE-based: `base_standings` + `h2h` CTEs. The `h2h` CTE self-joins `base_standings` to find tied opponents (same pts), inner-joins to fixtures between only those two teams. New ORDER BY: `pts DESC, h2h_pts DESC, h2h_gd DESC, h2h_gf DESC, gd DESC, gf DESC, team_name ASC`.
  - `get_tournament_public(text)` — identical H2H logic via `CROSS JOIN LATERAL` pattern (CTE references `comp.id` as a lateral parameter).
  - `SessionsScreen.jsx` director client-side sort — pairwise H2H loop over `completedFx` array; `standingsMap` entries now carry an `id` field for the fixture lookup. Matches DB sort order exactly.
- Proof: 4-team round-robin BEGIN/ROLLBACK test — Gamma (6pts, GD+1, beat Alpha H2H 1-0) ranks #1; Alpha (6pts, GD+5) ranks #2. H2H overrides overall GD advantage.
- Security sweep: SECDEF ✓, search_path ✓, overload_count=1 ✓ for both RPCs. Build PASS. Hygiene 7/7 PASS.
- Commit: `f26d7c9`.

**Phase 7B (mig 323) ✅ COMPLETE (session 126):**
- New table `tournament_cards` (competition-scoped, FK to fixtures + competition_teams).
- `ref_record_tournament_card` RPC — ref records yellow/red per player (free-text name); 2nd yellow in same competition = `auto_suspended=true`; any red = `auto_suspended=true`. Full audit_events trail.
- `get_tournament_suspension_list` RPC — authenticated, club_team_managers guard; returns all suspended players per competition for the director view.
- `ref_start_tournament_match` updated — returns `suspensions[]` of players known-suspended on either team; `PreMatch.jsx` shows `SuspensionWarningModal` if the array is non-empty, requiring acknowledgement before `onRefresh()` transitions to LiveMatch.
- Ref UI: `TournamentGoalButton` gains a secondary CARD button; `TournamentCardModal` (player name input + yellow/red toggle) opens via the overlay system; `doTournamentCard()` calls the RPC and shows a toast ("Yellow — Alice Smith — SUSPENDED" if triggered).
- **Bug fixed in same commit**: `club_admin_get_standings` previously joined `public.club_admins` (table that has never existed) — runtime crash on every call since mig 320. Replaced with `club_team_managers` guard (the correct Phase 1-3 pattern).
- EV 8/8 PASS (3 error-paths + first-yellow-not-suspended + second-yellow-suspended + red-always-suspended + card-count=3 + suspension-count=2). Leak check: all zeros.
- Security sweep: SECDEF ✓, search_path ✓, overload_count=1 ✓ for all 4 RPCs. Build PASS.
- Commit: `926f561`. Next migration: 324.

**Phase 7C (mig 324) ✅ COMPLETE (session 127):**
- Schema: `fixtures` gains `knockout_home_feeder_id` + `knockout_away_feeder_id` (uuid, self-ref FK). `competition_teams` gains `group_rank int`. `fixtures_home_identity` CHECK widened to also allow `knockout_home_feeder_id IS NOT NULL` (future-round bracket slots have NULL teams).
- `_advance_tournament_winner(uuid)` — internal SECDEF helper (REVOKED from PUBLIC/anon/authenticated). Called from `ref_confirm_tournament_match` on every knockout FT confirm. Slotted winner into next-round feeder slot; promotes fixture to `scheduled` when both slots filled. Draw = no-op.
- `club_admin_seed_knockout(p_tournament_event_id, p_competition_id)` — director call. Stamps `group_rank` via H2H tiebreaker (Phase 7A CTE). Collects top 2 per group, pairs serpentine (seed[i] vs seed[n-i+1]), creating cross-group R1. Round-1: teams populated + `scheduled`. Future rounds: teams NULL + feeder IDs + `allocated`. Sets `competitions.config.knockout_seeded=true`. Power-of-2 guard.
- Five RPCs updated (`ref_confirm_tournament_match`, `club_admin_get_standings`, `club_admin_get_schedule`, `get_tournament_public`, `club_admin_get_tournament`): group-label filtering on standings, knockout fixtures surface added, `knockout_seeded` flag threaded through.
- Frontend: `SessionsScreen` — per-group standings with ADV chips + "Advance to Knockout" button (gated on all-groups-complete + !knockout_seeded) + knockout rounds display. `TournamentScreen` — knockout bracket section + grouped standings with ADV chips.
- EV 10/10 PASS (not_authenticated; incomplete_group_fixtures; bracket_size_not_supported; happy-path ok=true; total_qualifiers=4; knockout_rounds=2; knockout_fixtures=3; group_ranks=1,1; bracket_advance_wiring; knockout_already_seeded). Leak check: all zeros.
- Security sweep: `club_admin_seed_knockout` SECDEF ✓ search_path ✓ overload_count=1 ✓ authenticated-only. `_advance_tournament_winner` SECDEF ✓ search_path ✓ overload_count=1 ✓ postgres+service_role only. Build PASS.
- Commit: `6f40e11`. Next migration: 325.

**Phase 7D (mig 325) ✅ COMPLETE (session 128):**
- Schema: `fixtures` gains `de_bracket text CHECK ('winners','losers','grand_final')`, `de_loser_to_fixture_id uuid FK → fixtures`, `de_loser_to_slot text CHECK ('home','away')`. `fixtures_home_identity` CHECK widened: `OR (de_bracket IS NOT NULL)` (LB fixtures start with NULL teams).
- `_advance_tournament_double_elim(uuid)` — internal SECDEF helper (REVOKED from PUBLIC/anon/authenticated). Routes winner forward via feeder mechanism; routes loser via `de_loser_to_fixture_id`/`de_loser_to_slot`. Draws = no-op.
- `club_admin_seed_double_elimination(p_tournament_event_id, p_competition_id)` — director call. Power-of-2 guard (4/8/16). WB R1: seeded pairs (seed[0] vs seed[n-1] etc.), status=scheduled. LB R1: pairs WB R1 losers (first loser → home, second → away), status=allocated. Loop WB R2..k: drop round (LB survivor meets WB loser, home_feeder=LB consolidation winner, away_feeder=WB loser's de_loser_to_fixture_id) + consolidation round (LB survivors face each other, home/away feeders), except after final WB round. Grand Final: home=WB Final winner, away=LB Final winner. Sets `competitions.config.knockout_seeded=true`. Audit `tournament_de_seeded`.
- `ref_confirm_tournament_match` REPLACED — branches: `IF v_fixture.de_bracket IS NOT NULL THEN _advance_tournament_double_elim ELSE _advance_tournament_winner END IF`.
- `club_admin_get_schedule` + `get_tournament_public` REPLACED — expose `de_bracket` field in fixture shape.
- Frontend: `SessionsScreen` — DE seed button (format=double_elimination, ≥4 active teams, !knockout_seeded); WB/LB/Grand Final display sections replace single knockout block for DE comps. `TournamentScreen` — same three-section split for public view.
- EV 15/15 PASS. Leak check: all zeros. Security sweep PASS. Build PASS.
- Commit: `ebe1972`. Next migration: 326.

**Phase 6 (mig 326) ✅ COMPLETE (session 129):**
- Schema fixes: `performance_results.athlete_id` made nullable (sports-day athletes are not casual squad players); `athlete_name text NOT NULL DEFAULT ''` + `competition_team_id uuid FK → competition_teams` added; UNIQUE constraint `perf_results_upsert_key (performance_event_id, competition_team_id, athlete_name, attempt_number)` added for judge re-entry UPSERT. `tournament_events.points_config` default changed to standard athletics 10-8-6-5-4-3-2-1; existing `{}` rows backfilled.
- 6 new SECDEF RPCs (all authenticated-only, anon revoked): `club_admin_set_performance_config` (lock points table — blocks once any results exist), `club_admin_add_performance_event` (director creates a discipline), `club_admin_list_performance_events` (list with result counts), `club_admin_record_result` (judge upserts an attempt), `club_admin_get_performance_results` (ranked leaderboard, measurement_type determines sort direction), `club_admin_get_sports_day_standings` (team totals: points/gold/silver/bronze/events_entered).
- `get_tournament_public` extended (4th CREATE OR REPLACE, same `p_slug text` signature): adds `performance_events[]` (per-event results with athlete/team/rank/value) and `performance_standings[]` (team totals derived from points_config).
- 6 JS wrappers in `packages/core/storage/supabase.js` + 6 barrel exports in `packages/core/index.js`.
- `SessionsScreen.jsx`: 6 new imports; performance events state (perfEvents/expandedEventId/eventResults/resultForm/sportsDayStandings); `loadTournamentDetail` + `reloadDetail` extended to also call `clubAdminListPerformanceEvents`; 3 new handlers (`handleAddPerformanceEvent`, `toggleEventExpand`, `handleRecordResult`); Performance Events section after competitions map (expandable event rows with leaderboard + result entry form); Overall Sports Day Standings section; Add Performance Event modal.
- `TournamentScreen.jsx`: reads `performance_events` + `performance_standings` from the existing `getTournamentPublic` call (no new fetch); per-discipline results sections; team standings section.
- Hygiene: 7/7 PASS (all 3 files). RPC security sweep: 6/6 PASS (SECDEF ✓ search_path ✓ overload_count=1 ✓). Casual-flow regression: PASS (no overlap with any casual surface). Build: PASS.
- Commit: `bc46b7b`. Next migration: 327.

**Phase 7 Commercial (mig 327) ✅ COMPLETE (session 130):**
- Schema: `tournament_events` + `player_of_tournament_name text`, `player_of_tournament_team text`; `equipment_bookings` + `tournament_event_id uuid FK → tournament_events ON DELETE SET NULL`; new table `tournament_sponsors` (id uuid PK, tournament_event_id FK, name text NOT NULL, logo_url, website_url, display_order int, active bool, RLS enabled, all direct access revoked).
- 9 new SECDEF RPCs (all authenticated-only, anon revoked): `club_admin_add_sponsor`, `club_admin_list_sponsors`, `club_admin_remove_sponsor` (sponsor CRUD with ownership guard via club_team_managers chain); `club_admin_set_branding` (writes primary_colour/secondary_colour/custom_logo_url into existing `tournament_events.branding` jsonb); `club_admin_set_player_of_tournament` (sets POT name + team, name_required guard); `club_admin_get_equipment_for_tournament` (returns active equipment catalogue at tournament's venue); `club_admin_book_equipment_for_tournament` (confirmed booking at status='confirmed', availability check via `_equipment_peak_committed`); `club_admin_list_tournament_equipment_bookings` (active bookings for a tournament); `club_admin_cancel_equipment_booking` (cancel director-created bookings only, cannot_cancel guard for out/returned/cancelled).
- `get_tournament_public` extended (5th CREATE OR REPLACE): adds `branding`, `sponsors[]`, `player_of_tournament_name`, `player_of_tournament_team`.
- `club_admin_get_tournament` extended: adds `sponsors[]`, `player_of_tournament_name`, `player_of_tournament_team`.
- 9 JS wrappers in `packages/core/storage/supabase.js` + 9 barrel exports in `packages/core/index.js`.
- `SessionsScreen.jsx`: 9 new imports; Branding section (primary/secondary colour + custom logo URL form); Sponsors section (add/remove with logo/website URL); Player of Tournament section (name + team name); Equipment section (catalogue picker + book form with window + active bookings + cancel). All with double-fire guards.
- `TournamentScreen.jsx`: branding applied as 4px coloured top border + optional custom logo in header; sponsor strip below header; POT trophy card after standings.
- Bug caught by ephemeral-verify: all 6 write RPCs used old `audit_events` INSERT pattern missing `entity_type` and `entity_id` (both NOT NULL since mig 003). Fixed before commit — would have thrown NOT NULL constraint violation on every write at runtime.
- EV: 13/13 PASS (name_required_rejected, add_sponsor, list_sponsors, remove_sponsor, list_sponsors_empty_after_remove, set_branding, set_player_of_tournament, get_equipment_for_tournament, invalid_window_rejected, book_equipment, list_bookings, cancel_booking, cannot_cancel_rejected). Leak-check: all zeros. Build: PASS.
- Next migration: 328.

Next migration: 331.

---

## CLASSES BOOKING + ROOM HIRE (planned session 134, 2026-06-15)

Venue-led bookable classes for members + hireable spaces for private sessions and functions.
Full plan: `~/.claude/plans/classes-and-room-hire.md`. Summary of 8 phases.
**Migrations RENUMBERED +7 (Jun 16 2026): payments epic consumed 329–337, so this epic runs
338–345, not 331–338.**

**Phase 1 — Hireable Spaces foundation (mig 338) — ✅ SHIPPED (session 138, 2026-06-16)**
New `venue_spaces` table (rooms/studios/halls/outdoor — distinct from `playing_areas` which has
the wrong abstraction for non-pitch spaces). `_space_is_available(space_id, starts_at, ends_at)`
internal helper (STABLE, definer-only) checks across both `venue_class_sessions` AND
`venue_room_hires` to prevent double-booking — references `to_regclass`-guarded so it builds in
Phase 1 before either table exists, then self-enforces once they land. 3 venue admin RPCs:
`venue_create_space`/`venue_update_space`/`venue_list_spaces` (counts self-upgrade via the same
guard). Venue UI: new **Facilities** nav group → Spaces CRUD (SpacesView). EV 14/14 + leak 0,
rpc-security-sweep + hygiene PASS, venue build clean.

**Phase 2 — Class types & scheduling (mig 339) — ✅ SHIPPED (session 139, 2026-06-16)**
3 new tables: `venue_class_types` (template — name, category, duration, capacity, cutoff hours,
`first_session_free` flag, space FK), `venue_class_series` (recurring schedule — DOW, time,
instructor, price, payment_mode), `venue_class_sessions` (instances — status: scheduled/cancelled/
completed; instructor FK→venue_admins). 11 venue admin RPCs covering CRUD, one-off + series
scheduling (series mirrors `club_create_session_series`, skips space conflicts), cancellation,
instructor reassignment, list/detail. `venue_charges.source_type` extended += `'class'`. Venue UI:
new **Classes** tab in the Facilities group (Schedule + Class-types sub-tabs; day-grouped session
cards with fill-rate pills; one-off/recurring create modal mirroring SessionsView; session detail
sheet with reassign / mark-completed / cancel / cancel-series).
**Two load-bearing cascades built forward-guarded** (`to_regclass venue_class_bookings`, no-op until
Phase 3, self-upgrade with no later edit): (1) `venue_cancel_class_session/_series` VOID+REFUND
prepaid class charges + cancel bookings + queue notify; (2) `venue_mark_class_completed` flips
un-checked-in confirmed bookings → `no_show` + bumps `no_show_count` (runtime-probes `checked_in_at`
from Phase 6 + `no_show_count` from Phase 3). EV 19/19 + leak 0, rpc-security-sweep (11 RPCs) +
hygiene PASS, venue build clean. Casual-regression N/A (no apps/inorout surface).

**Phase 3 — Member booking & timetable (mig 340) — ✅ SHIPPED (session 140, 2026-06-16)**
New `venue_class_bookings` table (status: confirmed/waitlist/cancelled/no_show; payment_status:
pending/paid/waived; payment_method: prepay/door/not_yet; UNIQUE(session,member)). New
`member_profiles.no_show_count int DEFAULT 0` + `venues.no_show_suspension_threshold int NULL` —
**landing these ACTIVATED both Phase-2 forward-guarded cascades** (re-proven live under EV). 4 member
RPCs + 1 internal helper `_apply_class_booking_charge` (single source of truth for waive-vs-charge,
reused by book + waitlist-promote): `member_list_class_sessions` (anon-callable public timetable;
auth populates per-caller booking state), `member_book_class_session` (membership gate → suspension
gate → prepay-dormancy gate → capacity/waitlist → tier `discount_pct`/`included_sessions` +
`first_session_free` waiver → charge as `source_type='class'`/`source_id=booking_id::text` matching
mig-339 cascade), `member_cancel_class_booking` (cutoff enforcement + refund + auto-promote next
waitlist — Phase 4 swaps to notify-and-claim), `member_list_my_class_bookings`. supabase.js wrappers
+ barrel. Cron: `classNotificationsJob` (confirm/waitlist + drain venue-side queued rows) +
`classRemindersJob` (~24h) + 7 mailer templates — EMAIL-only (members have no push plumbing yet),
no-op without RESEND_API_KEY. Member UI: public "What's on" weekly timetable on VenueLanding
(zero-footprint, shareable club-site wedge), "Upcoming classes" + inline cancel on MemberPass (owner
only), "My class history" on MemberProfile. EV 11/11 + leak 0 (incl. re-proof of both Phase-2
cascades), rpc-security-sweep (5) + hygiene + inorout build PASS, casual-regression PASS
(no casual surface touched; core additive-only). **Owed: real-iPhone PWA walk (Hard Rule #13).**
Stripe prepay stays DORMANT (`payment_method_unavailable` until a stripe/connected venue_integrations row).

**Phase 4 — Waitlist claim-window (mig 341) — ✅ SHIPPED (session 141, 2026-06-16)**
Notify-and-claim, replacing Phase-3's straight auto-promote (same pattern as reserve spot, mig 230).
Schema delta: `venue_class_bookings.status` += `'offered'` + new `offer_expires_at timestamptz`;
`venues.class_claim_window_minutes int DEFAULT 30` (per-venue window). An `offered` booking **reserves
the seat** (counts toward capacity exactly like `confirmed` while the window is live) — so the claim is
atomic and a new booker can't steal a held seat; the charge is applied on CLAIM, never on offer.
New internal helper `_offer_next_waitlist_spot(session_id)` (single source for "freed seat → offer the
front waitlister", queues `class_spot_offered`). `member_cancel_class_booking` rewired: freed confirmed
seat now OFFERS (not promotes); an `offered` booking is itself cancellable (decline → rolls onward);
return field `promoted`→`offered`. New `member_claim_waitlist_spot(session_id)` (authenticated; row-locked
check-and-promote; graceful `{ok:false, reason:'spot_taken'}` on expiry/gone). `member_book_class_session`
+ `member_list_class_sessions` updated to count live offers toward capacity / `spots_left`;
`member_list_my_class_bookings` + the timetable expose `offer_expires_at` and `'offered'` state. Cron:
new `classWaitlistExpiryJob` ticks `expire_class_waitlist_offers()` (service_role) — expired offers roll
to the back of the waitlist and the next person is re-offered; `class_spot_offered` added to the notify
drain + a new mailer template. Member UI (MemberPass): live **mm:ss countdown** to the claim window on an
offered booking + a "Claim spot" button (optimistic + revert + `isSavingRef`) + graceful "spot taken"
state; timetable shows a "Spot offered — claim on your pass" badge. EV 8/8 + leak 0 (claim happy-path,
claim-after-expiry → spot_taken, cron re-offer to next waitlister, AND re-proof that cancel now OFFERS
not promotes), rpc-security-sweep + hygiene 7/7 + inorout build PASS, casual-regression PASS (no casual
surface touched; core additive-only). **Owed: real-iPhone PWA walk (Hard Rule #13) — folds with Phase 3's
owed walk.**

**Phase 5 — Room hire (mig 342) — ✅ SHIPPED (session 142, 2026-06-16)**
New `venue_room_hires` table (RLS-on + REVOKE; venue_id denormalized; booker_type member/non_member;
status requested/confirmed/cancelled; deposit_pence + deposit_status none/held/returned/forfeited;
`CHECK(ends_at>starts_at)`). `equipment_bookings.room_hire_id NULL FK ON DELETE SET NULL` links
equipment hire as an add-on (additive, no mapper breakage). `venue_charges.source_type` += `'room_hire'`.
**Landing the table ACTIVATED the room-hire arm of `_space_is_available` (mig 338) — re-proven live under
EV (a class session AND a live hire each block an overlapping request).** 8 RPCs: `member_request_room_hire`
(authenticated; `_space_is_available`; links equipment add-ons; per-member throttle), `public_enquire_room_hire`
(**first anon WRITE in this epic** — enquiry-only spaces only, no charge, length caps, per-email throttle,
audited `actor_type='system'`), `venue_list_room_hires`/`venue_confirm_room_hire` (prices + raises a
`room_hire` charge + confirms add-ons + notifies)/`venue_cancel_room_hire` (refunds + returns held deposit +
cancels add-ons)/`venue_record_hire_deposit` (lifecycle), plus 2 public reads the member surface needs
(`member_list_hireable_spaces` anon, `member_list_my_room_hires` auth). Notifications EMAIL-only (members)
/ booker_email (non-members): 3 `room_hire_*` mailer templates + `roomHireNotificationsJob` cron drain.
Venue UI: new **Room hire** tab (Facilities group) — requests inbox (confirm-with-price modal / decline),
confirmed-hires list, equipment add-ons, deposit chips + record control. Member UI: "Hire a space" on
VenueLanding (`HireSpace.jsx`, zero-footprint; self-serve = request flow login-gated, enquiry-only = contact
form anon) + "Room hires" section on MemberPass. EV 13/13 + leak 0, rpc-security-sweep (8) + hygiene 7/7 +
both builds PASS, casual-regression PASS (no casual surface; core additive-only). Stripe prepay N/A (hire
fees are door/invoice via `venue_charges`). **Owed: real-iPhone PWA walk (Hard Rule #13) — folds with the
Phase 3 + 4 owed member-surface walks.**

**Phase 6 — QR check-in (mig 343)**
`venue_class_checkin(token, session_id, pass_token)` RPC — instructor-gated (assigned instructor
or venue manager); scans member pass QR; marks booking confirmed; promotes waitlist slot if needed.
Reuses BarcodeDetector already live on apps/display. Venue UI: per-session check-in scanner view.

**Phase 7 — Class packages & trial classes (mig 344)**
`venue_class_packages` + `venue_member_package_balances` tables. `member_purchase_class_package`
+ `member_get_package_balance` member RPCs. `member_book_class_session` extended: checks balance
before tier pricing — valid package deducts one session instead of creating a charge. Trial class:
`venue_class_types.first_session_free` waives charge for first booking at venue only.

**Phase 8 — HQ analytics (mig 345) — ✅ SHIPPED (session 145, 2026-06-16) — FINAL CYCLE**
apps/hq only; no new tables/columns. `hq_get_utilisation` extended with a COMPANY-level `spaces` block
(`class_hours`/`class_sessions`/`room_hire_hours`/`room_hires`/`activity_hours` from class sessions +
confirmed room hires) — kept SEPARATE from pitch `used_hours` because venue_spaces have no availability
windows (folding in would corrupt the pitch denominator). `hq_get_analytics` extended with a `classes`
drill-down (sessions, avg fill, class + room-hire revenue, busiest session, per-type fill/revenue,
instructor utilisation). New `hq_get_class_insights(company_id)` RPC: waitlist intelligence (class types
avg ≥90% full over ≥2 sessions flagged), per-instructor utilisation, per-type revenue cross-venue —
**Gaffer/Phase-7 AI context source, recorded in RPCS.md per Hard Rule #14.** **Double-count guard proven:**
class revenue sums `class`+`class_package` CHARGES (never sessions), so a pass-funded booking is counted
once; `by_type`/insights revenue is `class`-source only. UI: new "Classes" card in AnalyticsView (headline
chips + by-type/instructor tables + side-loaded "Waitlist pressure" strip) + activity chips on UtilCard &
UtilisationPanel. EV 15/15 + leak 0 (aggregation + double-count guard), rpc-security-sweep (3) + hygiene
7/7 + hq build PASS, casual-regression PASS (core additive-only, no inorout surface touched). No real-iPhone
walk owed (no PWA surface). **⛔ Member-surface real-iPhone PWA walks for Phases 3/4/5/7 + the Phase 6
scanner-camera walk are STILL OWED (Hard Rule #13).**

Stripe prepay dormant throughout — `payment_mode='prepay'` accepted by schema but booking RPC
returns `payment_method_unavailable` until venue's Stripe Connect account is active.

**🏁 CLASSES + ROOM HIRE EPIC COMPLETE — all 8 phases shipped (migs 338–345), all on main.**

---

## PLUS-ONE APPROVALS (mig 346, session 139)

Player-added plus-ones now require admin approval before they join the lineup. A non-admin's +1 enters
PENDING (`players.pending_approval=true`, `status='none'`) — takes NO squad spot, hidden from the board.
An admin approves (→ in, or → reserve if squad full) or declines (→ dormant, recoverable) via a
top-of-AdminView "🙋 PLUS-ONE APPROVALS" banner (mirrors the self-paid gold banner, surfaces live via the
existing `notify_team_change` realtime broadcast). Admin-added guests (valid admin token on `/admin`)
auto-approve straight in. The host sees "⏳ Waiting for admin approval" on their own pending +1 and can
Cancel it. RPCs: `add_guest_player` (now 3-arg, optional `p_admin_token`), NEW `admin_approve_guest` /
`admin_decline_guest`, `remove_guest_player` clears pending. State RPCs + `dbToPlayer` expose
`pendingApproval`. Push: `/api/notify` type `guestPendingApproval` targets the team's admins — DORMANT
until admins enable push. Gates: EV 8/8 + leak 0, rpc-security-sweep (4), hygiene 7/7, inorout build PASS,
casual-regression static PASS (all new logic gated on `pendingApproval`/`isPendingGuest`, no leak into
MySquads/StatsView). **⛔ real-iPhone PWA walk OWED (Hard Rule #13 — PlayerView + AdminView touched):
walk the add-+1 → "waiting" → admin approve/decline/reserve loop on a home-screen install before relying
on it for a live squad.**

---

## MATCH RESULT NOTE + POTM MODAL FIX (mig 347, session 139)

**Match result note (mig 347):** admins can attach an optional free-text note when saving a match
result — e.g. "abandoned early due to injury, declared a draw". New `matches.result_note` column;
`admin_save_match_result` gains `p_result_note` (15th arg, old signature dropped); optional "Match note"
textarea (280-char) on ScoreScreen Stage 7, pre-filled when editing an existing result; shown on the
HistoryView result card to everyone (📝). Player-route state RPC returns it via `to_jsonb`; admin route's
explicit match shape updated. EV 4/4 + leak 0, rpc-security-sweep PASS, hygiene 7/7, build PASS.

**POTM modal reappearance fix (no mig):** the voting modal now reappears on every app open while voting
is live UNTIL the player casts a vote, then never again. Previously a `localStorage` "seen" flag (added
s80) killed it permanently the first time it was dismissed without voting — tapping away to open the admin
panel meant it never returned. Now gated purely on server-truth `voted`.

**⛔ real-iPhone PWA walk OWED (Hard Rule #13 — PlayerView/ScoreScreen/HistoryView touched):** save a
result with a note → confirm it shows on the result card; abandon-without-voting the POTM modal → reopen
the app → confirm it reappears → vote → confirm it never returns.
