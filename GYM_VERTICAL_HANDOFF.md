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

## Phase 2 — Grading / belt progression  *(mig 357; new tables, reuses club/consent/caps)* — ✅ SHIPPED session 146
**Status (s146):** built + verified on branch `gym-vertical-phase2`. mig 357 applied: 3 RLS-walled
tables (`venue_grading_schemes` / `venue_grades` / `member_grades` append-only). Decisions (operator,
this session): **1A** — `venue_award_grade` gated on existing `manage_facility` cap (no dedicated
`award_grades` cap in v1; add later if coach-delegation needed). **2B + research** — grade ladder is
ordered named grades + `colour_hex` + per-grade `max_stripes`; the award carries a capped `stripes`
count (BJJ stripes / dan degrees); age-banded ladders are **separate schemes** (`age_band`
juniors/adults/all) because real kids vs adults ladders differ (BJJ kids grey→green can't get blue
till 16; TKD poom vs dan). Write RPCs (gated+audited): `venue_create_grading_scheme`,
`venue_add_grade`, `venue_award_grade`; reads `venue_list_grading_schemes`, `member_get_grade_history`;
`get_member_pass` extended with current `grades[]` (latest per scheme); `venue_list_members` extended
with `club_id`+`discipline` (additive) to drive the per-member Award action. **member_grades has a
monotonic `awarded_seq` identity column** — EV caught that within one txn `now()` is constant so two
awards tie on `awarded_at`; "current = latest" orders by `awarded_at DESC, awarded_seq DESC`. Operator:
new **Grading** sub-tab in `MembershipsView` (per-club scheme+grade setup, gated to martial-arts clubs)
+ **Award grade** action on member cards. Member: **rank chip** on `MemberPass` + **Progression**
history on `MemberProfile`, gated on `disciplineLabels.hasGrading` (martial_arts only). EV 11/11 +
leak 0, rpc-security PASS (6 RPCs), casual-regression PASS (additive-diff: every new inorout render
gated on hasGrading → casual football byte-identical; Playwright boot smoke 0 app errors), build
(inorout+venue) + hygiene clean. ⛔ **real-iPhone PWA walk OWED** (Hard Rule #13 — Pass chip + Profile
history; needs an authed member on a martial-arts club). **Next free mig = 358.** Phase 3 (PT booking)
is next.

### Phase 3 — PT / 1-on-1 appointment booking — ✅ SHIPPED s147 (mig 358)
Dedicated appointments model (NOT capacity=1 classes). 3 RLS-walled tables (`venue_trainers` —
`admin_id` nullable so a trainer is an optional staff login OR a no-login coach card;
`venue_trainer_availability` recurring weekly windows sliced into slots; `venue_appointments` with a
partial-unique `(trainer_id, starts_at) WHERE status<>'cancelled'` = one live booking per slot). 11
RPCs: operator `venue_upsert_trainer` / `venue_set_trainer_availability` / `venue_list_trainers` /
`venue_list_appointments` / `venue_pt_checkin` (clone of venue_class_checkin) /
`venue_mark_appointment_completed` (no-show bumps `member_profiles.no_show_count`, keeps charge);
member `member_list_trainers` / `member_list_trainer_slots` (availability minus booked) /
`member_book_appointment` (writes `venue_charges` source_type='pt', door path) /
`member_cancel_appointment` (honours per-trainer cutoff) / `member_list_my_appointments`. **Two levers
(operator s147 "A, but B for trials/one-offs"):** an account is ALWAYS required (auth.uid →
member_profiles); per-trainer `members_only` adds the active-membership requirement — `members_only=false`
+ price 0 = a free open session. Operator: new `apps/venue/.../TrainersView.jsx` (Trainers +
Appointments tabs; `ClassCheckinScanner` generalised with an optional `checkin` cb). Member: new
`/book` route + `BookPT.jsx` + ClubNavBar **Train** tab, gated on `disciplineLabels.hasPT`
(gym/boxing/martial_arts/fitness) → casual football byte-identical. Also extended
`venue_charges_source_type_check` to allow `'pt'` (mig 358b). EV 9/9 + leak 0, rpc-security PASS (11
RPCs), casual-regression PASS (additive-diff), Playwright /book boot smoke 0 errors, build+hygiene
clean. ⛔ **real-iPhone PWA walk OWED** (Hard Rule #13). **Next free mig = 359.** Phase 4 (fight record)
is the last phase. OPT-IN follow-up: retrofit `members_only`+price-0 to the classes epic (free/trial
classes) if the operator wants it — not bundled into 358.

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

## Phase 4 — Bout / fight record + sparring stats  *(mig 359; boxing-specific, last)* — ✅ SHIPPED session 148 — 🏁 VERTICAL COMPLETE
**Status (s148):** built + verified on branch `gym-vertical-phase4`. mig 359 applied: DORMANT
`player_match.sport_stats`/`matches.sport_stats jsonb` (additive-NULLABLE, 0 pg_proc refs → football
cascade byte-unchanged) + ONE RLS-walled table `member_bouts` (member_profile_id + club_id, result
win|loss|draw|no_contest, method/rounds/event/opponent, `is_sparring`, **`voided` SOFT-DELETE**; W-L-D-NC
derived over non-voided non-sparring rows, sparring → separate `sparring_count`). 5 RPCs (writes gated
`manage_facility` + audited): `venue_record_bout` / `venue_update_bout` / `venue_delete_bout` (soft-void) +
reads `venue_list_member_bouts` (operator, incl voided) / `member_get_fight_record` (member via pass_token,
excludes voided). Operator: per-member **Fight record** modal in `MembershipsView`
(`FIGHT_RECORD_DISCIPLINES=['boxing']`). Member: **Fight record** section on `MemberProfile` (W-L-D-NC +
sparring count + bout list), gated on `disciplineLabels.hasFightRecord` (boxing only). **Operator decisions
(3 recommended defaults confirmed):** manage_facility authority; member+staff visibility, boxing-only;
soft-void + is_sparring flag (no separate sparring table). EV 10/10 + leak 0 (EV caught + fixed a
sparring/headline consistency gap pre-commit, folded as 359b), rpc-security PASS (5 RPCs), casual-regression
PASS (additive-diff — sport_stats invisible to all RPCs), Playwright boot smoke 0 app errors, build
inorout+venue + hygiene clean. ⛔ **real-iPhone PWA walk OWED** (MemberProfile Fight record; needs an authed
member on a boxing club). The STRATEGY.md post-pilot timing gate for Phases 3–4 is RETIRED. The classes
free/trial `members_only`+price-0 retrofit stays an OPT-IN follow-up in BUGS.md — NOT built. **Next free mig
= 360.** **🏁 GYM/BOXING VERTICAL COMPLETE — Phases 0 (355) · 1 (356) · 2 (357) · 3 (358) · 4 (359).**

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

---

## ~~NEXT SESSION PROMPT — Phase 3 (PT / 1-on-1 appointment booking, mig 358)~~ ✅ DONE s147

*✅ SHIPPED session 147 (mig 358, PR #25). The block below is kept for the record — DO NOT re-run it.
For the next session use the **Phase 4** prompt at the very bottom of this file. Phases 0–3 are
shipped on main; next free mig = 359.*

**⏱ TIMING GATE — read before starting.** STRATEGY.md defers the "real build" (Phases 3–4) until
**after the football pilot (18 Jun 2026) proves the wedge**. Phases 0–2 were the low-risk, bankable
identity/grading layer; Phase 3 is the largest build of the vertical. At session start, CONFIRM with
the operator that the pilot has happened / they want to proceed before doing any execute work. If
they say hold, stop after the audit.

```
Continue the GYM / BOXING CLUB vertical — Phase 3 (PT / 1-on-1 appointment booking), mig 358.
Phases 0–2 are shipped — see CONTEXT.md SESSIONS 144–146 and GYM_VERTICAL_HANDOFF.md.

First run skills/session-start.md. Then read GYM_VERTICAL_HANDOFF.md "Phase 3" in full plus the
s144 "Modelling note". This is the LARGEST build of the vertical but still reuses every
cross-cutting primitive: gate writes via resolve_venue_caller + _venue_has_cap, audit every
write (Hard Rule #9), write money to the existing venue_charges ledger (do NOT invent a new
charge path), reuse the QR pass_token check-in bridge, mirror venue_class_series recurrence
shape for availability.

TIMING GATE: STRATEGY.md defers Phases 3–4 to post-pilot (pilot = 18 Jun 2026). CONFIRM the
operator wants to proceed before any execute work — if they say hold, stop after the audit.

CONFLICT GUARD: before branching, confirm git is on main, tree clean, zero open PRs. If not,
STOP and report.

Scope for Phase 3 (mig 358) — dedicated appointments model, NOT capacity=1 classes (decision
locked in the handoff: capacity=1 classes would force pre-creating every slot, give no bookable
trainer identity, and break waitlist/no-show semantics):
  - Schema (RLS-walled, REVOKE anon/authenticated; SECURITY DEFINER RPCs only):
      venue_trainers (admin_id → venue_admins; display_name, bio, default_session_minutes,
                      price_pence, active)
      venue_trainer_availability (recurring windows; mirror the venue_class_series shape)
      venue_appointments (trainer_id, member_profile_id, starts_at, ends_at,
                          status confirmed|cancelled|completed|no_show, price_pence,
                          payment_mode, checked_in_at, charge_id;
                          partial UNIQUE(trainer_id, starts_at) WHERE status<>'cancelled')
  - Operator RPCs (gated + audited): venue_upsert_trainer, venue_set_trainer_availability,
      venue_list_trainers, venue_list_appointments.
  - Member RPCs: member_list_trainers, member_list_trainer_slots (availability minus booked),
      member_book_appointment (writes venue_charges source_type='pt'),
      member_cancel_appointment; venue_pt_checkin (clone of venue_class_checkin);
      venue_mark_appointment_completed (no-show bumps member_profiles.no_show_count).
  - Operator UI: new apps/venue/src/views/TrainersView.jsx (reuse Icon/tab-chip/.dt/Modal +
      generalise ClassCheckinScanner).
  - Member UI + NEW route: /book → new apps/inorout/src/views/BookPT.jsx; a "Train" tab on
      ClubNavBar, gated to PT disciplines AND ≥1 active trainer (keep casual football
      byte-identical — gate the same way Phase 1/2 gated /classes and grading).
  - Money: venue_charges rows written but settlement stays DORMANT until live Stripe keys;
      'door' (pay-in-person) is the live path.

Run a full AUDIT → VERIFY → EXECUTE → VERIFY → COMMIT cycle for PHASE 3 ONLY:
  - AUDIT in plan mode first (no edits): pull venue_class_checkin + venue_create_class_series
    (recurrence) + the venue_charges write path bodies live; confirm venue_admins shape for the
    trainer link; confirm how ClubNavBar gates a tab by discipline (Phase 1/2 pattern); confirm
    the slot-availability read (availability windows minus booked appointments) shape.
  - Apply SQL to Supabase first, land _up/_down source same commit (Hard Rule #11).
  - GATES (mandatory): rpc-security-sweep (every new write RPC); ephemeral-verify (seed an
    _e2e_ venue/club/trainer/member fixture, set availability, list slots, book one → assert a
    venue_charges row + slot removed from availability, double-book same slot → assert the
    partial-unique rejects it, cancel → assert slot frees, mark no-show → assert no_show_count
    bumps, leak-check 0); casual-regression (apps/inorout App.jsx new route + ClubNavBar
    touched — prove the casual squad path byte-identical); real-iPhone PWA walk (Hard Rule #13
    — /book route + Train tab on a PT-discipline club); build/hygiene.
  - Then docs (FEATURES/RPCS/SCHEMA/DECISIONS/BUGS/CONTEXT/handoff + memory), commit, merge
    promptly, confirm main clean.

Confirm with me BEFORE building:
  1. trainer identity — is a trainer always a venue_admins staff login (managed in the Staff
     tab), or do you also want lightweight "trainer profile, no login" records (a freelance PT
     who never logs in)? Recommend staff-login-backed for v1 (admin_id → venue_admins) unless
     you want no-login trainer cards now.
  2. which disciplines get PT — gate the Train tab to which set? Recommend gym + martial_arts +
     fitness (anything non-football with ≥1 active trainer); confirm or narrow.
  3. cancellation / no-show policy — is there a cancellation cut-off window (e.g. no free cancel
     within 24h), and should a no-show still record/keep the venue_charges row? Recommend free
     cancel any time in v1 (door payment only) + no-show keeps the charge + bumps no_show_count;
     confirm.
```

*Operator answers as built (s147): (1) BOTH — `venue_trainers.admin_id` nullable = staff login OR
no-login coach card. (2) DYNAMIC off `disciplineLabels.hasPT` (gym/boxing/martial_arts/fitness). (3)
"A, but B for trials/one-offs" → per-trainer `members_only` (false + price 0 = free open session);
per-trainer `cancel_cutoff_hours` (0 = free cancel); no-show keeps the charge + bumps no_show_count.*

---

## NEXT SESSION PROMPT — Phase 4 (Bout / fight record + sparring stats, mig 359) — THE LAST PHASE

*Paste the block below to start the next session. Phases 0 (mig 355) + 1 (mig 356) + 2 (mig 357) +
3 (mig 358) are shipped on main. Next free mig = 359. This is the FINAL phase of the vertical.*

**⏱ TIMING GATE — read before starting.** STRATEGY.md deferred Phases 3–4 to post-pilot; the operator
confirmed proceed for Phase 3 on the pilot day (18 Jun 2026, s147). Re-confirm the operator still wants
to proceed with Phase 4 before any execute work — if they say hold, stop after the audit.

```
Continue the GYM / BOXING CLUB vertical — Phase 4 (Bout / fight record + sparring stats), mig 359.
This is the LAST phase. Phases 0–3 are shipped — see CONTEXT.md SESSIONS 144–147 and
GYM_VERTICAL_HANDOFF.md.

First run skills/session-start.md. Then read GYM_VERTICAL_HANDOFF.md "Phase 4" in full. This phase
is boxing-specific and must be ZERO breaking change to football: it realises the documented (dormant)
player_match.sport_stats jsonb pattern AND stores boxing data in a dedicated member_bouts table keyed
on member_profile_id (football's player_match keys on a football players row — keep them separate).

TIMING GATE: re-confirm the operator wants to proceed with Phase 4 before any execute work — if they
say hold, stop after the audit.

CONFLICT GUARD: before branching, confirm git is on main, tree clean, zero open PRs. If not, STOP
and report.

Scope for Phase 4 (mig 359):
  - Schema:
      ALTER player_match ADD COLUMN sport_stats jsonb;  -- additive-NULLABLE, DORMANT realisation
      ALTER matches      ADD COLUMN sport_stats jsonb;  -- additive-NULLABLE, DORMANT realisation
      member_bouts (RLS-walled, SECURITY DEFINER RPCs only): id, member_profile_id → member_profiles,
        club_id → clubs, bout_date, opponent_name, event_name, result win|loss|draw|no_contest,
        method (text, e.g. KO/TKO/decision/submission), rounds, is_sparring bool, stats jsonb,
        recorded_by, recorded_by_actor_type, created_at.
  - Operator RPCs (gated manage_facility + audited, Hard Rule #9): venue_record_bout / venue_update_bout
      / venue_delete_bout (or a soft-delete — confirm). Reuse resolve_venue_caller + _venue_has_cap.
  - Member/staff read: member_get_fight_record (derived W-L-D-NC, bouts list; staff reads audited per
      Hard Rule #9). Decide pass_token vs auth.uid identity (grading used pass_token; PT used auth.uid).
  - Operator UI: "Record bout" — a sub-tab in MembershipsView (sibling of the Phase 2 Grading sub-tab,
      gated to boxing/MMA clubs via disciplineLabels.hasFightRecord) OR on TrainersView. Per-member
      bout list + add/edit.
  - Member UI: MemberProfile.jsx "Fight record" section, gated on disciplineLabels.hasFightRecord
      (boxing today; martial_arts could opt in — confirm). Keep casual football byte-identical.

  HEADLINE GATE: the player_match / matches sport_stats ADD COLUMN must be additive-NULLABLE and every
  football read/write path (admin_save_match_result, all state RPCs, mappers) must be byte-unchanged —
  nothing writes or reads sport_stats yet. Prove this in casual-regression.

Run a full AUDIT → VERIFY → EXECUTE → VERIFY → COMMIT cycle for PHASE 4 ONLY:
  - AUDIT in plan mode first (no edits): confirm disciplineLabels.hasFightRecord (boxing=true already);
    pull the Phase 2 grading RPC bodies (venue_award_grade / member_get_grade_history) as the closest
    pattern to clone; confirm member_profiles + clubs shapes; confirm the MembershipsView sub-tab wiring
    (how the Grading sub-tab is gated/rendered) for the Record-bout sibling; check player_match/matches
    columns so the dormant ALTER is genuinely additive.
  - Apply SQL to Supabase first, land _up/_down source same commit (Hard Rule #11). The sport_stats
    ALTERs and member_bouts can be one migration.
  - GATES (mandatory): rpc-security-sweep (every new write RPC); ephemeral-verify (seed an _e2e_
    venue/club/member fixture, record 2 bouts (1 win 1 loss + a sparring row) → assert member_get_fight_record
    returns W-L-D derived correctly, update one, delete one, leak-check 0); casual-regression (PROVE
    football byte-identical — the sport_stats ALTER touches player_match/matches which the casual result
    cascade writes; assert admin_save_match_result + state RPCs unchanged); real-iPhone PWA walk
    (Hard Rule #13 — MemberProfile Fight record section on a boxing club); build/hygiene.
  - Then docs (FEATURES/RPCS/SCHEMA/DECISIONS/BUGS/CONTEXT/handoff + memory — mark the vertical COMPLETE),
    commit, merge promptly, confirm main clean.

Confirm with me BEFORE building:
  1. record authority — who logs a bout: manage_facility only (like grading awards, recommended), or
     also the trainer's own login (like PT check-in)? Recommend manage_facility for v1.
  2. fight-record visibility — MemberProfile section for the member + staff only (recommended), or also
     a chip on the public/Pass surface? And does martial_arts opt in to fight records too, or boxing only?
     Recommend boxing-only + private-to-member/staff for v1.
  3. delete semantics + sparring depth — hard delete a bout or soft-delete/void (keeps history)? And for
     sparring rows: just a flagged member_bouts row (is_sparring=true, recommended), or a richer
     per-round stats capture? Recommend soft-void + is_sparring flag (no extra table) for v1.
```
```
