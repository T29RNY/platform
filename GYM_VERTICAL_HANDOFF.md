# Gym / Boxing Club Vertical — Build Handoff

*Created session 143 (2026-06-17). Status: PLANNED, not started. Pre-build audit of the
existing club/membership system complete (clean — see CONTEXT.md SESSION 143). Next free
migration at time of writing = **355**.*

---

## Why this exists

Question that started it: *"could our system work for gyms, boxing clubs etc?"* Answer:
**~80% is already built.** Over ~30 sessions the platform grew the spine of a gym product —
Classes (migs 338–345), Membership V2 / club OS (283–313), Payments (Stripe + GoCardless,
329–337), Equipment hire (255–260), QR check-in, packages, waitlists, staff/DBS, consent
e-sign (which already covers **waivers**). This handoff plans only the missing 20%.

**Core idea:** a gym/boxing club is a `club_membership` **context** — NOT a new app, NOT a
new theme. Operator runs it from `apps/venue`; the member lives in the `apps/inorout` club
context. Everything ships behind the existing `teams.multi_context_nav` flag (dark by
default), **zero footprint on the casual football experience**.

**Guiding principle:** *reuse the right primitives, don't overload the wrong entity.* Reuse
`venue_charges`, the QR `pass_token`→member bridge, `resolve_venue_caller`/`_venue_has_cap`
gating, `audit_events`, the class no-show contract, and recurrence shapes — add small new
tables only where the domain genuinely differs (trainers, grades, bouts).

## Strategy / timing (read before starting)

`STRATEGY.md` defers "second sport" to **post-pilot-case-study**. The football pilot is
**18 Jun 2026**. This plan is **bankable**: Phases 0–2 are low-risk anytime; Phases 3–4 are
the real build and should wait until after the pilot proves the wedge. Don't start the week
of the pilot. Phase 0 first; each phase is independently shippable.

## Audit facts that shape the plan (verified live, session 143)

- The whole club/membership supply side is **wired and working live** (memberships, class
  scheduling, booking/cancel/waitlist/check-in/packages, club sessions+attendance, context
  routing). The one bug found (BST recurring-session times) was fixed in mig 353.
- **"Multi-sport" is real schema but DORMANT logic** — `sport` columns exist but nothing
  branches on them. Phase 0's `discipline` work is what makes a vertical real.
- **No "trainer" bookable identity** — `venue_class_sessions.instructor_id` → `venue_admins`.
  This is the PT gap (Phase 3).
- **`clubs` has no `discipline` column** — vertical identity gap (Phase 0).
- **`player_match.sport_stats jsonb` does not exist** — it's a documented dormant pattern in
  DECISIONS.md, never applied. Phase 4 realises it.
- QR check-in (`venue_class_checkin`: scanned `/m/<pass_token>` → `venue_memberships.pass_token`
  → member) is fully reusable for PT + sparring.
- `ClubNavBar.jsx` already notes its "Classes" tab is omitted until a `/classes` route exists
  — Phase 1 lights it.
- Waivers already done via `policy_documents` + `consent_acceptances` (versioned e-sign).

---

## Phase 0 — Vertical identity / labelling  *(mig 355; config-only, near-zero build)* — ✅ SHIPPED session 144
**Status (s144):** built + verified on branch `gym-vertical-phase0`. `clubs.discipline`
applied (mig 355, text+CHECK pick-list); `member_get_self`/`venue_list_clubs` extended;
`venue_set_club_discipline` (gated `manage_facility`, audited) + `venueSetClubDiscipline`
wrapper; `disciplineLabels.js` (boxing→fight-record, grades→martial_arts) threaded through
`deriveClubContext`→`ClubNavBar`. EV 7/7 + leak 0, rpc-security PASS, casual-regression PASS,
build+hygiene clean. NO operator UI control yet (set via RPC) — wire alongside Phase 1.
⛔ real-iPhone PWA walk OWED. **Next free mig = 356.** Scope confirmed with operator:
discipline-as-pick-list, NOT a generic config engine (see DECISIONS s144).

**Goal.** A club declares a `discipline` so the member app reads "Boxing"/"Gym"/"Yoga" and
shows the right tab set. No new theme (gold/green/red tokens unchanged).
- **Schema:** `ALTER TABLE clubs ADD COLUMN discipline text NOT NULL DEFAULT 'football' CHECK (discipline IN ('football','gym','boxing','martial_arts','yoga','dance','fitness','other'))`.
- **RPCs:** extend `member_get_self()` (add `discipline` to each `active_clubs[]` entry) + `venue_list_clubs`; new `venue_set_club_discipline(p_venue_token, p_club_id, p_discipline)` (gated `manage_facility`, audited).
- **Wrappers:** `venueSetClubDiscipline` → supabase.js + barrel.
- **New member config:** `apps/inorout/src/lib/disciplineLabels.js` — `LABEL_MAPS[discipline]` → `{classesTab, bookCta, rankWord, ...}`. Pure copy.
- **Threading:** add `discipline` to `deriveClubContext()`; `ClubNavBar` reads it for tab labels.

### Modelling note — multi-sport sports centres (operator Q, s144)
`discipline` is **one per club** by design — the club's *primary* identity, mirroring how a
**venue** has a primary `sport` plus an offered-set `sports text[]` (mig 269). The two entities
do different jobs and this is deliberate:
- **A sports centre = one VENUE containing several CLUBS, one discipline each.** `club_venues`
  is many-to-many and `venue_list_clubs` already returns every club at a venue. A leisure centre
  doing boxing + yoga + a gym floor is a Boxing club, a Yoga club, and a Gym club under one venue —
  separate memberships, fees, schedules, grading. The member sees the right vocabulary per club,
  and the multi-context switcher (s141/s143) lets a two-sport member flip between their two
  `active_clubs[]` entries. **This is already supported — nothing to build.**
- **A member who does two sports at the same centre = two memberships** (two clubs / two
  `active_clubs[]` entries), NOT one multi-sport club.
- **The one gap discipline-per-club can't express:** a *single* club the member treats as one
  multi-sport thing. Handle via existing layers, not a club-level change: a "one fee, everything"
  product is a **membership tier with `sports_included text[]`** (already exists) and the club is
  tagged `'fitness'`/`'other'`; sport-by-sport booking is just classes/sessions (sport-agnostic,
  tagged at session/class-type level).
- **Extension path IF a true single-multi-sport-club ever appears:** add `clubs.disciplines
  text[]` later — cheap, additive, reversible, exactly as the venue side did in mig 269. Do NOT
  pre-build it; decide the shape against a real sports-centre customer.

## Phase 1 — Sparring / open-mat availability  *(mig 356; highest reuse)* — ✅ SHIPPED session 145
**Status (s145):** built + verified on branch `gym-vertical-phase1`. `venue_class_types.is_sparring`
applied (mig 356, additive bool DEFAULT false). NO new write RPC — threaded `p_is_sparring` through
`venue_create_class_type` (signature change: old 9-arg DROPped + re-granted) + `venue_update_class_type`
(jsonb patch) + `is_sparring` added to `venue_list_class_types`/`member_list_class_sessions` (badges) +
`discipline` added to `get_member_pass` (Pass-surface nav consistency). Operator toggle in
`ClassesView` ClassTypeModal (create + edit) + types-table "Sparring" pill. Member surface = new
`/classes` route → new `ClassesScreen.jsx` (club + venue picker) rendering the reused
`ClassesTimetable` (now sparring-badged); `ClubNavBar` Classes tab lit for non-football disciplines
(football byte-identical). EV 5/5 + leak 0, rpc-security PASS (both write RPCs: SECDEF + search_path +
1 overload + anon/auth grants), casual-regression PASS (additive diff proof — no casual surface
touched), build (inorout+venue) + hygiene clean, Playwright boot smoke of `/classes` (renders SignIn,
0 console errors). ⛔ **real-iPhone PWA walk OWED** (Hard Rule #13 — new route + NavBar tab; needs an
authed member on a non-football club). **Next free mig = 357.** Decision (sparring = class-type flag,
not a new entity) recorded in DECISIONS s145.

**Goal.** "Who's in for Thursday sparring?" — members book In/Out on a session.
**Decision:** reuse the class-session booking model wholesale; do NOT reuse `players.status`
(that presupposes a football squad/rollover; a sparring night *is* a class session with
capacity, booking, waitlist, QR check-in, no-show).
- **Schema:** `ALTER TABLE venue_class_types ADD COLUMN is_sparring boolean NOT NULL DEFAULT false`.
- **RPCs:** none new (reuse `venue_schedule_class_session`/`venue_create_class_series`/`member_book_class_session`/`member_claim_waitlist_spot`/`venue_class_checkin`). Optionally thread `p_is_sparring` through class-type create/update.
- **Operator UI:** `apps/venue/.../ClassesView.jsx` — "sparring/open-mat?" toggle.
- **Member UI + NEW route:** add `/classes` to `apps/inorout/src/App.jsx` → render `ClassesTimetable.jsx` for the selected club. This lights the dormant `ClubNavBar` "Classes" tab. Boxing tab set → Sessions / Classes / Pass / Profile.

## Phase 2 — Grading / belt progression  *(mig 357; new tables, reuses club/consent/caps)*
**Goal.** Per-club, per-discipline grading scheme; current grade + history; on Pass/Profile.
- **Schema:** `venue_grading_schemes` (club_id, discipline, name, active); `venue_grades` (scheme_id, name, rank_order, colour_hex, UNIQUE(scheme_id, rank_order)); `member_grades` (append-only award log → "current" = latest per member+scheme; mirrors consent_acceptances).
- **RPCs:** `venue_create_grading_scheme`, `venue_add_grade`, `venue_list_grading_schemes`, `venue_award_grade` (gated `manage_facility` OR a new `award_grades` cap via `_venue_has_cap`), `member_get_grade_history`; extend `member_get_venue_membership_pass` to include current rank.
- **Operator UI:** new "Grading" sub-tab in `apps/venue/.../MembershipsView.jsx` (already multi-sub-tab) + "Award grade" on a member.
- **Member UI:** `MemberPass.jsx` rank chip; `MemberProfile.jsx` "Progression" history. Rank word from `disciplineLabels`. Renders only for grading disciplines.

## Phase 3 — PT / 1-on-1 appointment booking  *(mig 358; largest build, reuses charges+QR)*
**Goal.** Trainer-as-resource + availability; member books a slot; charge via `venue_charges`;
QR/in-person check-in; cancellation.
**Decision:** dedicated appointments model, NOT capacity=1 classes (which would force
pre-creating every slot, give no bookable trainer identity, and break waitlist/no-show
semantics). Reuse every cross-cutting primitive instead.
- **Schema:** `venue_trainers` (admin_id → venue_admins; display_name, bio, default_session_minutes, price_pence, active); `venue_trainer_availability` (recurring windows; mirrors venue_class_series shape); `venue_appointments` (trainer_id, member_profile_id, starts_at, ends_at, status confirmed|cancelled|completed|no_show, price_pence, payment_mode, checked_in_at, charge_id; partial UNIQUE(trainer_id, starts_at) WHERE status<>'cancelled').
- **RPCs:** operator `venue_upsert_trainer`/`venue_set_trainer_availability`/`venue_list_trainers`/`venue_list_appointments`; member `member_list_trainers`/`member_list_trainer_slots` (availability minus booked)/`member_book_appointment` (writes `venue_charges` source_type='pt')/`member_cancel_appointment`; `venue_pt_checkin` (clone of venue_class_checkin); `venue_mark_appointment_completed` (no-show bumps member_profiles.no_show_count).
- **Operator UI:** new `apps/venue/src/views/TrainersView.jsx` (reuse Icon/tab-chip/.dt/Modal + generalise ClassCheckinScanner).
- **Member UI + NEW route:** `/book` → new `apps/inorout/src/views/BookPT.jsx`. "Train" tab on ClubNavBar, gated to PT disciplines AND ≥1 active trainer.
- **Money:** `venue_charges` rows written but settlement stays DORMANT until live keys; `door` mode is the live path.

## Phase 4 — Bout / fight record + sparring stats  *(mig 359; boxing-specific, last)*
**Goal.** Capture a bout/sparring record on MemberProfile. Zero breaking changes to football.
**Decision:** realise the documented `player_match.sport_stats jsonb` pattern (additive,
dormant) AND store boxing data in a dedicated `member_bouts` table keyed on
`member_profile_id` (football's `player_match` keys on a football `players` row).
- **Schema:** `ALTER player_match/matches ADD COLUMN sport_stats jsonb` (dormant realisation); `member_bouts` (member_profile_id, club_id, bout_date, opponent_name, event_name, result win|loss|draw|no_contest, method, rounds, is_sparring, stats jsonb, recorded_by).
- **RPCs:** `venue_record_bout`/`venue_update_bout`/`venue_delete_bout` (gated, audited); `member_get_fight_record` (derived W-L-D; staff reads audited per Hard Rule #9).
- **Operator UI:** "Record bout" in MembershipsView (sibling of Grading) or TrainersView.
- **Member UI:** `MemberProfile.jsx` "Fight record" section.
- **Headline gate:** the `player_match`/`matches sport_stats` add MUST be additive-nullable and football read/write paths byte-unchanged.

---

## Per-phase cycle (mandatory)
Every phase: SQL applied to Supabase first → `_up.sql` + `_down.sql` source same commit
(Hard Rule #11) → **rpc-security-sweep** → **ephemeral-verify** (every new write RPC,
`_e2e_` fixture, auto-rollback, leak-check) → **casual-regression** (anything touching
apps/inorout — prove the casual squad path byte-identical) → build/hygiene → **PWA
real-device walk** (Hard Rule #13, any new route/nav) → docs (FEATURES/RPCS/SCHEMA/DECISIONS/
BUGS) → commit → merge promptly (cloud-session discipline) → confirm main clean.

## Critical files
- `packages/core/storage/supabase.js` (+ `index.js` barrel) — all wrappers.
- `apps/inorout/src/lib/deriveContext.js`, `lib/disciplineLabels.js` (new), `components/ui/ClubNavBar.jsx`, `App.jsx` (new `/classes`, `/book` routes, flag-gated/fall-through).
- `apps/inorout/src/views/ClassesTimetable.jsx`, `MemberPass.jsx`, `MemberProfile.jsx`, `BookPT.jsx` (new).
- `apps/venue/src/views/ClassesView.jsx`, `MembershipsView.jsx`, `TrainersView.jsx` (new), `ClassCheckinScanner.jsx`.

## Open decisions to confirm with operator before building
1. Scope — all 5 phases, or only generic-gym (0–1, maybe 3) and defer boxing-specific (2,4)?
2. PT model — dedicated appointments (recommended) vs capacity=1 classes.
3. Boxing depth — is grading + fight-record wanted now, or split into a "martial-arts add-on"?
