# Epic: Guardian /hub follow-ups (on-device walk findings, 2026-07-10)

Source: operator on-device authed guardian walk after the Team privacy fix (#434).
Reference tenant: PA Sports. Guardian = child-proxy (`child_profile_id`), multi-child aware.
Run via `/dev-loop` per phase. **Plan gate: batched. FULL AUTONOMY GRANTED (operator,
2026-07-10): "proceed through its build apply and merges, overriding the hard rule, you
have full autonomy… to plow through the remaining PRs."** → I self-apply migrations + merge
PRs; the human tier-3 sign-off gate is waived by explicit operator grant. I STILL run every
automated quality/safety proof (build, lint, hygiene, rpc-security, ephemeral-verify+rollback,
QA+security reviews, casual-regression, leak-check) and keep every migration additive +
reversible + non-destructive. Two hard external blockers remain (NOT overridable by me):
Stripe live keys/Connect (P12 — credentials I don't have; wire+hand off) and on-device authed
walks (app behind login). **OPERATOR DECISION 2026-07-11: on-device walks are BATCHED to the
END of the epic — operator will walk all guardian/app surfaces then. I no longer pause per phase
to flag a walk; I proceed through build→apply→merge and list the owed walks for the final pass.** Reuse over new systems; keep desktop⇄mobile in sync.

Universal lessons (apply every phase): nav must clear the docked nav / new modals use the
shared `MobileSheet` ([[reference_hub_sheet_nav_ios_stacking]]); reuse the guardian_* / desktop
data contract ([[feedback_mobile_reuses_desktop_data_contract]]); tappable tiles / row-tap detail;
STRICT aggregate-only privacy for other children.

Next free migration = **538** (534 schema + 535 create-rpcs + 536 guardian-reader + 537 class-types-camp-flags all APPLIED-live; re-confirm off main before taking a number).

## Product decisions (operator, 2026-07-10)
1. Holiday camps = a **real feature**, built on the **existing classes engine** (reuse
   create→target→book→pay→guardian-surface; add a "camp" flavour) — NOT a new subsystem.
   Owners/admins create on desktop AND app (club-admin `/hub`) → make available to **all or a
   cohort** → guardians **book + pay**. Multi-child aware. Camp needs a **VENUE** — either a
   pre-registered location OR a **brand-new location** (create inline). Camp fields: date, time,
   information, **dietary**, **pick-up & drop-off** (time/location), + any other relevant.
2. Detail = **street address (text), not a map**.
3. Pay-now: add the fast-path now **and** wire ready for Stripe go-live (yes to Stripe Phase 7).
4. Coach/admin per-player doc-status: **both** surfaces (desktop venue lens + coach /hub); reuse
   desktop if it exists (audit: it does NOT — new reader needed).
5. Reminders: **email + push**; yes to Stripe.

## Phases

| # | Phase | Tier | Deps | Status | Stops for human |
|---|-------|------|------|--------|-----------------|
| 1 | Schedule crash (infinite render loop) + app-wide error boundary | 1 | — | **DONE** (#435 merged) | merge (done) |
| 2 | Sessions tab rebuild: rename Matches→Sessions, blend training, month in date, tappable session/fixture detail sheet (name+location/address text already returned), "See all fixtures/training →" | 1 | — | **DONE** | merge |
| 3 | League: tiles → month-grouped tappable rows + detail sheet (fields already returned) | 1 | — | **DONE** | merge |
| 4 | Team name in header ("Arjan · Earlsdon Lions U7"), multi-team aware (reuse `guardian_list_child_team`) | 2 | — | **DONE** | merge |
| 5 | Membership Pay-now: desktop `existingUrl` fast-path (open `charge.pay_url`) + wire Stripe checkout path ready for go-live | 1 | — | **DONE** | merge |
| 6 | Guardian EDIT medical/emergency (backend `member_update_child` exists; swap read-only review for edit form) | 2 | — | **DONE** | merge |
| 6b | Audit-flag fidelity: `member_update_child` should flag `medical_updated` when dietary_notes/send_notes/consent_administer_medication change (special-category). SQL-only. | 3 | — | **DONE (mig 532 APPLIED)** | merge |
| 7 | League detail rich fields: `guardian_list_child_leagues` +venue_name/venue_address/ref_name (fixtures) + kickoff/pitch/venue/address/ref (results) | 3 | 3 | **DONE (mig 533 APPLIED)** | merge |
| 8 | Fixture detail address: `guardian_list_child_fixtures` +venue_address (HOME venue). ⚠️ AWAY has no data (opponent ground not stored — free-text opponent only); documented limitation | 3 | 2 | **DONE (mig 533 APPLIED)** | merge |
| 9 | **Holiday Camps — COMPLETE (all 5 sub-phases built)**: P9.1 (534) schema · P9.2 (535) create RPCs · P9.3a (536) reader+cohort · P9.3b guardian render · P9.4 (537) desktop create UI · P9.5 app club-admin /hub create surface. ⛔ on-device/venue walks batched to epic end. | 3 | 2 | **DONE (build)** | walks (batched) |
| 10 | Coach/admin per-player **doc-status**. **P10a reader (mig 538) + P10b coach /hub surface DONE** → P10c desktop venue-club-lens (needs its OWN venue-token reader — P10a is coach-auth only) = last P10 piece. Status flags only (no medical content). DPIA nuance: medical-review flag is person-global (no club_id on member_record_reviews). | 3 | — | **building** | **apply(×N)** + merge(×N) |
| 11 | Payment **reminders** cadence: `get_membership_reminders_due` filter → due−7/−1/0, offset-aware dedup key, email templates + **push** channel, cron | 3 | — | pending | **apply** + merge |
| 12 | Stripe Phase 7 **go-live** (live keys + Connect + webhook) — OPS/human; draft+verify only, I can't set live credentials | 3 | 5 | pending | **human ops** |

## P9 — Holiday Camps DESIGN (audited 2026-07-10; camp = a class-type flavour, reuse the class engine)

Booking modes: **BOTH** per-day and block (operator choice per camp). Existing engine:
`venue_class_types` (catalogue, has venue_id + space_id NOT NULL, members_only) → `venue_class_sessions`
(bookable, single-day `starts_at`/`ends_at`, price_pence, payment_mode) → `venue_class_bookings`
(1 row = member+session) → `venue_charges source_type='class'` → `get_my_money` (stream:'class', pay_url)
→ pay path (stripeInitChargeCheckout / pay_url). Guardian book+pay + charge + Sessions "Camps & extras"
render (GuardianMatches) ALL REUSE UNCHANGED.

**Gaps → the build:**
- **Schema (P9.1, mig 534, additive):** on `venue_class_types` add `is_camp bool=false`, `camp_info text`,
  `camp_dietary text`, `pickup_time time`, `dropoff_time time`, `pickup_location text`, `dropoff_location text`,
  `booking_mode text='per_day' CHECK(per_day|block)`, `audience text='all' CHECK(all|team)`,
  `target_team_id uuid→club_teams`. On `venue_class_sessions` add `end_date date` NULL (set = block spanning
  starts_at::date..end_date; NULL = single-day, keeps `ends_at>starts_at` CHECK valid). All safe-defaulted →
  existing classes/gym/football untouched. No `venue_charges.source_type` change.
- **Create RPC (P9.2):** extend `venue_create_class_type` (+camp params +audience/target_team_id; DROP old sig
  per overload rule) + NEW `venue_create_camp(venue_token, class_type_id, instructor_id, date_from, date_to,
  daily_start_time, price_pence, payment_mode, booking_mode)` — per_day emits N consecutive daily sessions;
  block emits ONE session with end_date. (venue_create_class_series is WEEKLY, doesn't fit consecutive days.)
- **Guardian reader (P9.3):** extend `guardian_list_child_class_options` — expose `is_camp` + camp-detail +
  `end_date`/`booking_mode`, AND apply the audience/cohort filter (include camp if audience='all' OR child is
  active `club_team_members` of target_team_id). Patch GuardianMatches/GuardianMembership mappers (HR#12).
  Guardian Sessions "Camps & extras" renders camp detail (dietary/pickup/dropoff/block-dates) in the sheet;
  book via the existing guardian_book_class_session path.
- **Desktop create UI (P9.4):** apps/venue ClassesView — "Holiday camp" type toggle exposing camp fields +
  audience picker + per_day/block + date range, wired to the extended create RPCs.
- **App create UI (P9.5):** NEW club-admin `/hub` camp-create surface in apps/inorout (none exists — class
  creation is desktop-only today). Mirrors desktop contract (feedback_mobile_reuses_desktop_data_contract).

**P9.3 build notes (from P9.2 review):** (a) SECURITY-LOAD-BEARING — the reader MUST treat an
`audience='team'` camp with `target_team_id IS NULL` as "show to NO ONE" (the deleted-team fail-closed
state); the `EXISTS active club_team_members` test already yields zero for NULL target, so keep that
shape and never fall back to "show to all" on a NULL target. (b) Known product gap (not a bug): a club
*unlink* (removing a `club_venues` row) does NOT fire the FK SET NULL, so a team camp keeps targeting a
team whose club left the venue — visibility-only, no PII; revisit if venue↔club unlink becomes common.
(c) Block camps clash-detect only the day-1 window (inherent to "block = ONE session"); if interior-day
double-booking matters, occupancy/clash logic would need to become `end_date`-aware — note in P9.4/P9.5.

**P9.2 build note (from P9.1 review):** the create RPC MUST reject `audience='team'` with a NULL
`target_team_id` at write time — the schema CHECK only guards `all ⟹ NULL` (the reverse is left to
the RPC so the FK's ON DELETE SET NULL never aborts a team/club delete; team+NULL = "hidden, target
gone"). Reader P9.3: `include if audience='all' OR (audience='team' AND EXISTS active club_team_members
(team_id=target_team_id, member_profile_id=child, is_active))` — team+NULL naturally matches no child.

**Resolved design decisions:** (1) camp = `is_camp` flavour of `venue_class_types` (mirrors is_sparring/
members_only), NOT a new subsystem. (2) block = one session + `end_date` = one booking/charge; per_day = N
daily sessions booked individually. (3) **brand-new location** = reuse `self_serve_create_venue` (heavy) OR,
preferred, a lightweight `venue_create_space` on the existing venue (space_id is NOT NULL on types+sessions +
a `_space_is_available` clash-check, so a camp needs a venue+space either way — reuse, no space-optional
schema change). (4) targeting all-vs-team is NET-NEW (classes are venue-only scoped today).

## Log
- 2026-07-11 P10b DONE — coach /hub doc-status surface. NEW screen TeamManagerDocs.jsx (compliance board) + a "Documents & clearance" drill-in from TeamManagerPeople (mirrors the Reliability & Smart-Teams drill-in — local state, teamId from the team selector, NO MobileShell route change → additive/casual-safe). Reads clubManagerGetTeamDocStatus(teamId): summary card (X of Y need attention / everyone cleared) + a "what's required" line + per-member rows with status chips (Consents signed/required · ID · Medical → ✓ done / ! due / … in review) + an overall badge (Cleared / N to chase / In review). Status flags only (no medical content surfaced). Gates: inorout build PASS, lint (no-undef) + hygiene 8/8 (both files), casual-regression STATIC PASS (team_manager /hub only, no casual src/views/App.jsx). check-live-config CLEAR (tier-1). QA review OVERALL PASS (shape mapping correct, chips/badges consistent, requirements-line join correct in all cases, drill-in wiring sound). Security inherited from P10a's reviewed reader (pure caller). ⛔ owed: coach /hub docs walk (batched to epic end).
- 2026-07-11 P10a DONE — mig 538 APPLIED-live: coach doc-status reader `club_manager_get_team_doc_status(p_team_id)`. Per active team member: consents (current policy_documents accepted), ID proof (id_mandate → member_id_documents status), medical review (within 12mo) → done|due|submitted|na + outstanding (family-action) + all_clear; team summary + requirements. Same logic as guardian reader (mig 431), aggregated. **STATUS FLAGS ONLY — no medical content (snapshot never selected); coach sees completeness not special-category data.** Coach-auth (club_team_managers, mig-517 preamble), authenticated-only, read-only. EV 7/7 + leak-0 (3 members clear/behind/pending-id + summary + non-manager + unauth — auth.uid via set_config). rpc-security PASS. QA PASS + Security SECURE-TO-SHIP (no medical/storage_path/signature leak, cross-team/club scoping tight). Fixed a stale SCHEMA.md note same commit (member_id_documents.status 'verified'→'approved', + document_type enum — a footgun QA flagged). DPIA nuance (non-blocking): medical-review flag is person-global (member_record_reviews has no club_id) — a boolean, no content, matters only for a rare multi-club player; noted for P10c. DARK-in-prod (no consumer until P10b). Split rationale: P10a = coach reader (backend); P10b = coach /hub surface; P10c = desktop admin venue-token reader + surface.
- 2026-07-11 P9.5 DONE → **P9 COMPLETE**. App club-admin /hub camp-create — the /hub's FIRST create surface. NEW screen ClubAdminCampCreate.jsx (MobileSheet, phone twin of the desktop CampModal) opened via an "Add holiday camp" button in ClubAdminSchedule (More → Schedule). Reuses the EXACT desktop contract: club admin passes shell venue_id as venueToken → resolve_venue_caller(venue_admins/auth.uid); two-step venueCreateClassType(camp)→venueCreateCamp(sessions) with typeIdRef retry-reuse; loaders venueListSpaces(is_active)/venueListAdmins(active)/clubListTeams(clubId, club-scoped so the team picker only offers the admin's OWN club's teams — tighter than the RPC allows). No new backend/RPC. Gates: inorout build PASS, lint (no-undef) + hygiene 8/8 (both files), casual-regression STATIC PASS (club-admin /hub, no casual src/views or App.jsx). check-live-config CLEAR (tier-1). QA review OVERALL PASS (9/9, faithful port, no scope hole; 3 non-blocking notes: created camp shows in the guardian app not this Training/Fixtures diary [by design]; CTA scrolls vs pinned footer; zero-staff blocks on instructor). Security inherited from P9.2's reviewed RPCs (pure caller, no new authz). ⛔ owed: on-device club-admin camp-create walk (batched to epic end).
- 2026-07-11 P9.4 DONE — desktop venue camp-create UI (apps/venue ClassesView) + mig 537. New "Add holiday camp" button → CampModal: full one-form camp create (name/space/instructor/per_day|block/date range/daily start+length/capacity/price+payment/audience+team picker/info/dietary/pickup+dropoff), two-step (venueCreateClassType camp → venueCreateCamp sessions) with typeIdRef retry-reuse (no duplicate type). mig 537 = ADDITIVE venue_list_class_types +is_camp/audience/target_team_id (the mig-360 column list predated the camp cols → the "Camp" pill was dead; HR#12 fix). Gates: venue build PASS, lint+hygiene 8/8, rpc-security PASS, read-back EV+leak-0, casual-regression N/A (venue app). QA review caught + I FIXED 2 defects (dead pill → mig 537; retry double-create → typeIdRef); re-review confirmed both resolved. check-live-config CLEAR (venue, tier-1). ⛔ owed: venue camp-create walk (batched to epic end; live submit would pollute demo seed). Known limit: step-1 field change after a step-2 fail needs cancel+restart (orphan type is dark).
- 2026-07-11 P9.3b DONE — guardian Sessions "Camps & extras" render (GuardianMatches.jsx, frontend). Threads the mig-536 camp fields onto each camp item; list row gains a "Camp" badge (amber pill) + block camps show a start–end date range (campWhen helper); detail sheet (MobileSheet) gains camp-detail KV rows — Info, Dietary, Pick-up (time+location), Drop-off (time+location), and a block date range in the header. Regular classes render byte-identical (campWhen == old subtitle for non-block, badge/rows gated on is_camp). tier-1 (check-live-config CLEAR — not an HR#13 protected file). Gates: build PASS, lint (no-undef) PASS, hygiene 8/8, casual-regression STATIC PASS (guardian mobile/screens, not a casual src/views surface). QA PASS (no regression, null-safe, field mapping consistent) — fixed the one flag (block range duplicated in header + KV → dropped the redundant KV). DARK-in-prod (badge/detail inert until a camp exists; no create UI yet). ⛔ owed: on-device guardian Sessions walk (BATCHED to epic end per operator).
- 2026-07-10 P9.3a DONE — mig 536 APPLIED-live: guardian reader `guardian_list_child_class_options` extended (CREATE OR REPLACE, same sig). +9 additive camp keys (is_camp/booking_mode/end_date/camp detail) + AUDIENCE/COHORT filter: audience='all' → verbatim old venue-scope (zero regression, all existing classes byte-identical); audience='team' → EXISTS active club_team_members(target_team_id, child) VENUE-AGNOSTIC, FAIL-CLOSED on NULL target. EV 9/9 + leak-0 (all-camp/team-camp-venue-agnostic/regular shown · other-team + NULL-target HIDDEN · camp fields exposed · unauth rejected — auth.uid via set_config jwt, `_e2e_` fixture rollback). rpc-security PASS. QA PASS (no regression/dup) + Security SECURE-TO-SHIP (no cross-child leak, no PII, fail-closed verified). mapper-sync false-positive (raw passthrough). DARK-in-prod (no team camp exists; new keys unused until P9.3b). **P9.3b note:** an in-progress block camp drops off the bookable reader once starts_at passes (correct for booking) — the guardian "booked/what's-on" view (GuardianSchedule, a different reader) must surface a booked block camp across its span; render camp detail (dietary/pickup/dropoff/block end_date) in the "Camps & extras" sheet. Split rationale: P9.3a = security-critical backend (reader/filter, no UI); P9.3b = frontend render (touches apps/inorout → casual-regression + native walk owed).
- 2026-07-10 P9.2 DONE — mig 535 APPLIED-live: create RPCs. EXTENDED `venue_create_class_type` (+10 camp params, old 11-arg sig DROPPED+re-granted, audience/target validation: team⟹target required + club_venues-scoped, all⟹NULL) + NEW `venue_create_camp` (booking_mode derived from the type; per_day → N daily sessions clash-skipped, block → 1 session end_date=date_to clash→hard-error; not_a_camp guard). Wrappers venueCreateClassType(+camp kwargs)/venueCreateCamp + barrel. EV 8/8 + leak-0 (per_day 3 end_date NULL · block 1 end_date set · team-target persisted · 4 reject paths · 2 audits — `_e2e_` fixture auto-rollback). rpc-security 2/2 (overload=1 each). build+lint+hygiene 8/8. casual-regression STATIC PASS (additive venue-class wrappers, zero casual-flow touched). Review: QA+Security PASS. DARK-in-prod (no camp-create UI yet). ⛔ P9.4/P9.5 build the create surfaces; on-device walk owed then.
- 2026-07-10 P9.1 DONE — mig 534 APPLIED-live: additive Holiday-Camps schema on the class engine. `venue_class_types` +is_camp/camp_info/camp_dietary/pickup_time/dropoff_time/pickup_location/dropoff_location/booking_mode(per_day|block)/audience(all|team)/target_team_id(FK→club_teams SET NULL) + relaxed integrity CHECK `audience<>'all' OR target_team_id IS NULL` (biconditional avoided — a review caught that a biconditional + ON DELETE SET NULL would abort team/club hard-deletes; team⟹target now enforced by the P9.2 RPC instead). `venue_class_sessions` +end_date(date NULL, CHECK end_date>=starts_at::date). All safe-defaulted → verified: 4/4 existing types + 8/8 sessions byte-identical (is_camp=false, audience='all', end_date NULL). Dark schema (no consumer yet — RPCs P9.2). Camp reuses class engine wholesale (bookings→charges source_type='class'→get_my_money→pay). schema-sync trivially satisfied (additive-only, no existing column renamed/moved/dropped).
- 2026-07-10 P1 DONE — #435 merged live. GuardianSchedule dep stabilised + ErrorBoundary. On-device authed guardian walk owed (auth-gated).
- 2026-07-10 P2 DONE — Sessions tab: rename, blend Matches/Training/Camps, month dates, tappable detail sheet (MobileSheet), "See all fixtures/training →" deep-link to filtered Schedule. Reused readers only, selfMode kept fixtures-only. QA PASS. On-device walk owed.
- 2026-07-10 P3 DONE — League Fixtures/Results: tiles → month-grouped compact rows (JULY 2026 headers), each tappable → MobileSheet detail (opponent/H-A/date/kickoff/pitch/score). Client-only, mig-428 fields only (venue/ref = P7). QA PASS vs RPC SQL. On-device walk owed.
- 2026-07-10 P4 DONE (#438) — header subline shows the active child's team (multi-team "Team +N"), reuse guardian_list_child_team, role-guarded, no stale flash. QA PASS.
- 2026-07-10 P5 DONE — Pay-now fast-path: open `charge.pay_url` (server-provided, ^https-validated, caller-scoped) before the dormant Stripe endpoint, mirroring desktop MemberProfile. Works now for manual/bank links; card checkout still awaits Stripe Phase 7 (P12). QA+Security PASS. FOLLOW-UP (backlog): add a `^https?:` scheme allowlist to the shared `native/open-external.js` (defense-in-depth; sources already trusted).
- 2026-07-10 P7+P8 DONE — mig 533 APPLIED-live: guardian_list_child_leagues fixtures/results +venue_name/venue_address/ref_name (+kickoff/pitch on results); guardian_list_child_fixtures +venue_address. HOME-venue only (club_fixtures stores home playing_area→venue; AWAY opponent is free-text w/ NO stored ground → venue_* NULL, honest). Additive, EV-proven (venue+address+ref populate) + leak-0. Client: League detail + Matches detail show Venue/Address/Referee. On-device walk owed.
- 2026-07-10 P6 DONE — guardian medical/emergency review sheet now EDITABLE (was read-only): ec1/ec2 contacts + dietary_notes + send_notes + 2 consents, saved via existing `member_update_child` (whitelist update → detailed medical fields preserved, no data loss) + `guardian_confirm_record_review`. Backend reused, no migration. QA+Security PASS (guardian-gated, no IDOR/injection, audited). NOTES: (a) old read-only `KV` helper now dead code (tiny cleanup owed); (b) detailed medical fields (conditions/allergies/medications/gp) not surfaced — parity follow-up needs the mig-431 snapshot enriched; (c) → P6b audit-flag fidelity. On-device walk owed.
