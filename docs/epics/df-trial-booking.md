# Epic manifest — DF Sports public enrol / free-trial (PR #6 + #7)
- Epic: a prospective parent lands on DF Sports' public club page, books a free trial for
  their child in one guided flow, and CANNOT book that child into a session outside their
  age band. Done = P5 merged + DF's page published + a real-device walk.
- Plan gate: batched (approved in-session 2026-07-16)
- Merge mode: per-phase   (every phase is operator-merged; P2/P3/P5 are tier-3)
- Approved: 2026-07-16

## Decisions taken at the plan gate (do not re-litigate)
1. ~~**Age band lives on the COHORT, session points at it**~~ — ☠️ **DEAD, superseded
   2026-07-16 by mig 588. DO NOT REVIVE.** The premise (that DF runs a session per age
   group) was wrong: DF runs **ONE open mixed-age session per slot** — Club Training, Wed
   5:30–6:30, Years 2–6, coaches split by age on the day. **One session spans FIVE year
   groups, so a single `cohort_id` link cannot express it.**
   **What shipped instead (mig 588):** the band lives on the CLASS TYPE
   (`venue_class_types.school_year_min/max`, plus `min_age/max_age` for venues that group
   by age, e.g. gyms and the pre-school Tots class). The cohort stays a per-child **LABEL**
   for the register — Danny's actual need is "what year group is this child, so groups stay
   balanced", not "which session may they book".
   **And the grouping rule changed:** school year via the **31 Aug cutoff**
   (`_school_year_for_dob`), NOT age-today. Reproduced against live before fixing:
   `dob 2018-09-09` → age 7 → **Under 8s** and `dob 2019-08-20` → age 6 → **Under 6s** —
   both are school **Year 2**, and the younger flips U6→U8 on her birthday mid-season.
   Mig 580 was NOT sloppy: it explicitly rejected the cutoff *because* "DF's coaching side
   is mixed-age single sessions (Decision #2)". The mixed-age half is still true; what moved
   is that the groups are SCHOOL YEARS. **Lesson: 580's stale premise cost a full re-design
   — check a recorded decision's premise still holds before building on it.**
2. **The trial CTA is gated per-club, default OFF.** There is ONE public club page component
   (`ClubPublicScreen.jsx`) rendering every club. Ungated, PA Sports gets the button too.
   Gate = explicit switch, not data-driven — PA Sports' page must render byte-identical.
3. **#6 may ship AHEAD of PR #4b / mig 586.** `member_self_create_profile` never matches on
   email — it only checks whether THIS `auth_user_id` already has a profile. So a public
   signup makes a DUPLICATE, never a hijack. Trap 1 (email ≠ identity, confirm-email OFF)
   arms 586 precisely BECAUSE 586 matches on email to claim a shell; #6 claims nothing.
   And there are no shells to duplicate until the import, which is ordered AFTER 586.
   **Condition: `club_leads` must NEVER become an identity source.** A lead row is an
   unverified typed claim, nothing more.
4. **Design is light, app is dark.** Do NOT touch `:root` tokens.css (breaks the casual app)
   and do NOT hoist `[data-surface="mobile"]` light tokens to root (violates that file's own
   scope rule). Scope light vars to the flow's own container and derive every tint with
   `color-mix()` — the `clubPublic.css:11-21` idiom, which has zero hex literals and so
   passes the hygiene hook. Ignore `MembershipSignup`'s `Styles()` — hardcoded dark, and it
   references `--t3` 17× which is DEFINED NOWHERE (live latent bug; do not inherit).

## Base-state facts (verified 2026-07-16 against the live DB — do not re-derive)
- DF Sports Coaching: **no `club_pages` row at all**, **0 `venue_class_types`**. 4 active
  cohorts. So DF cannot exercise this flow until it has a page AND sessions (P1 + operator
  data entry).
- Clubs WITH published pages: `pa-sports` (live club), `finbars-fc` (demo), `demo-boxing`.
- PA Sports' "2 active classes" = two DUPLICATE rows of one paid, team-targeted
  `U7 Summer Holiday Camp` (`first_session_free=false`). Nothing trial-shaped. ⚠️ the dup
  looks like a data bug — NOT this epic's job, file separately.
- **`member_book_class_session` is NOT defined by mig 340 any more** — 340's version was
  superseded; the LIVE definer is `399_modular_feature_flags.sql:2704`. Patching 340 is a
  silent no-op. Guardian path = `429_...sql:232` (a COPY, not a caller — both need patching).
  Pull the live body with `pg_get_functiondef` before any CREATE OR REPLACE.
- Age-check insertion point: after the `members_only`/`membership_required` gate, before the
  no-show gate — `399:2743-2747` (member) and `429:289-291` (guardian).
- 3 club-creation RPCs, no chokepoint: `club_create` (286:49), `self_serve_create_club`
  (518:135), `superadmin_create_club` (578:138). No client-side insert exists.
- `club_pages`: PK = `club_id`; `slug` NOT NULL + UNIQUE + CHECK `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`;
  `published` DEFAULT false. No slugify helper exists in the DB — slugs are hand-typed today.
- `clubs` is always inserted BEFORE its `club_venues` link → an AFTER INSERT trigger sees NO
  venue. Keep it to `NEW.id` + `NEW.name` only.
- Reuse, already built end-to-end: per-club brand colour (DB `club_pages.primary_colour` →
  `get_club_public` → `themeVars()` → `color-mix` tints → WCAG-aware `onColour()`), anon
  public page + anon RPC, `MobileSheet` (⚠️ needs a `[data-surface="mobile"]` wrapper),
  `ageFromDob` (`MembershipSignup.jsx:119`).
- Build new: progress bar / step chrome (nothing exists — `packages/ui` is 88 stale lines),
  a DOB field with age validation (only bare `<input type="date">` exists), every anon write
  RPC, and the 4 screens.

## Phases   (status: pending | in-progress | done | blocked: <why> | needs-human: <what>)

### P1 — Auto-create a club page for every club (mig 587)
- status: **done** — PR #570 MERGED + APPLIED 2026-07-16. DF has `df-sports-coaching`
  (published=false). clubs_without_page 2→0. PA Sports branding verified intact.
- deps: none
- goal: a `club_pages` row is born with every club, so no club starts life invisible and no
  operator has to invent a slug. Backfills the two clubs that lack one (DF Sports, Demo
  Martial Arts). AFTER INSERT trigger on `clubs` + existence guard + collision-safe slug
  (bare slug first, random suffix on conflict — the `489:225-250` retry idiom; `btrim(-)`
  and the empty-string guard are load-bearing or the CHECK rejects e.g. `"FC!"` → `fc-`).
- tier-3 touch: migration
- ⚠️ MUST FIX IN THE SAME MIGRATION — seed-replay collision: `505:64` and `447:11,25` insert
  their BRANDED page with `ON CONFLICT (club_id) DO NOTHING`. With the trigger, the blank row
  lands first and the branded insert is SILENTLY skipped → on any fresh rebuild PA Sports
  loses its colours/tagline/`published=true`. Change those seeds to `DO UPDATE`. Cannot
  affect the live DB (those clubs already exist → trigger never fires for them).
- note: `published` DEFAULT false ⇒ auto-created rows are INERT/dark. The
  `_club_feature_enabled(club_id,'public_web')` gate that guards the page-write RPCs is
  bypassed by a trigger — accepted deliberately: `club_features` has 0 rows and the fn
  COALESCEs to true, and an unpublished row is inert either way.
- proof: check-build · rpc-security-sweep · ephemeral-verify (seed a throwaway club → assert
  exactly one page row, slug valid vs the CHECK regex, published=false; seed a SECOND club
  with a colliding name → assert the suffix path; assert the trigger no-ops when a page
  already exists) · leak-check `_e2e_%` = 0 · paired `_down.sql`
- PR:

### P2 — School-year grouping + the class age guard (mig 588, "#7")
- status: **done** — PR #571 MERGED + APPLIED 2026-07-16. **LIVE BUT DARK**: 0 classes carry
  a band, 0 cohorts carry a school year, 26 live bookings untouched. Nothing changes for any
  venue/gym/club until P2b sets DF's data.
- deps: P1
- shipped: `_school_year_for_dob(dob, ref)` (31 Aug cutoff, Reception=0, ref defaults today
  so groups roll up every 1 Sep) · `club_cohorts.school_year_min/max` ·
  `venue_class_types.school_year_min/max` + `min_age/max_age` · `_cohort_for_dob` prefers
  school-year cohorts, falls back to 580's age bands unchanged · `_class_age_eligibility`
  enforced in BOTH live booking RPCs.
- ⚠️ **The brief said patch migs 340 + 429 — 340 IS DEAD.** Its `member_book_class_session`
  was superseded (341→360→399); live definer = `399:2704`. Patching 340 = silent no-op.
  Both bodies were pulled with `pg_get_functiondef` and CREATE OR REPLACEd.
- proof (done): EV 7/7 driving the REAL guardian RPC via a throwaway auth session —
  cutoff-both-Year2 (the 580 bug) · rollup-1-Sep · reception=Y0 · **regression-no-band-books-
  fine** (proves the live RPCs aren't broken) · Year2-books · Reception-REFUSED ·
  Year7-REFUSED · null-dob-allowed (mig 584 precedent). Leak check clean.
- PR: #571

### P2b — Turn it on for DF + make cohorts self-serve (mig 589)  ← NEXT
- status: pending
- deps: P2
- goal:
  1. **DF data**: cohorts → Year 2..Year 6 (`school_year_min/max`), remap the 5 kids'
     `venue_memberships` off U6/U8/U10/U12, deactivate the old ones. Set `Club Training`
     band = school_year 2–6; `Tots` band = `school_year_max = -1` (pre-school — Reception is
     0, so -1 = "not yet at school"; it also ejects a child exactly when they start
     Reception, which an age band cannot do).
  2. **`club_create_cohort` + `club_update_cohort` (mig 298:157) accept school_year_min/max**
     — today they take `min_age/max_age` ONLY, so an operator can only build the age-band
     cohorts we PROVED are wrong. This is the operator's "create their own age cohorts" ask.
  3. **`venue_update_class_type` (mig 339) accepts the class band fields** — its whitelist
     doesn't know them, so a band is settable only in raw SQL today.
  4. **UI parity — the operator's explicit ask: "easy way to create their age cohorts, on
     desktop AND app."** App side EXISTS (`OperatorPeople.jsx`, `ClubAdminMemberships.jsx`
     call `clubCreateCohort`/`clubUpdateCohort`). **DESKTOP = `apps/venue` — AUDIT whether a
     cohort-CREATE modal exists at all** (it reads cohorts in `SessionsView`/`MembershipsView`
     but no create modal was found). ⛔ `apps/clubmanager` has the nicest one
     (`structure/CohortModal.jsx`) but that app is **being RETIRED** (Club Console
     Consolidation #5) — do NOT build onto it. ⚠️ `apps/venue` = MANUAL deploy.
- tier-3 touch: migration + RPC signature changes (grep every call site — Hard Rule 7)
- proof: rpc-security-sweep · ephemeral-verify · check-build · casual-regression (touches
  packages/core) · paired `_down.sql`

### P3 — club_leads + the anon plumbing (mig 589, "#6" server half)
- status: pending
- deps: P2
- goal: `club_leads` table + the anon-granted RPCs the screens need (capture a lead, list
  bookable trial sessions for a club, book the trial). Ships dark — nothing calls them.
- tier-3 touch: migration + RLS + **anon PII intake** (DPIA signed 2026-07-15)
- ⚠️ anon write = abuse surface. Needs rate limiting / a cap per IP-or-club, and
  `club_leads` must be write-only to anon (never anon-readable — it's other people's
  children's names). Trust NOTHING client-supplied as identity (trap 4:
  `MembershipSignup.jsx:158` pre-fills the login email but lets the user EDIT it and the RPC
  trusts `p_email` — do not repeat that).
- proof: rpc-security-sweep (anon grants, search_path, overloads) · ephemeral-verify ·
  adversarial security review (can anon read another family's lead? enumerate? flood?) ·
  audit_events per Hard Rule 9 · paired `_down.sql`
- PR:

### P4 — The four screens, on their own route (dark)
- status: pending
- deps: P3
- goal: `/c/<slug>/trial` — public page → signup S1 parent → S2 child (DOB → suggested
  group) → pick session (+ loading + full/waiting-list states) → confirmation. Built to
  `design_handoff_trial_booking_flow/`, reconciled to tokens per decision 4. NOTHING links
  to it — walkable only by typing the URL.
- tier-3 touch: none expected (apps/inorout/src → check-live-config will flag PROTECTED)
- ⚠️ routing: custom switch in `App.jsx:93-137`, NOT react-router. No `history.pushState`
  anywhere — the 4 screens MUST live in component state inside ONE route or it's 4 full
  page reloads.
- ⚠️ `index.html:58` hardcodes a dark `<body>` — a light page must override the body bg,
  not just the container.
- proof: node --check · check-lint · check-hygiene · check-build · casual-regression ·
  Playwright walk (server MUST be `npm run dev --prefix apps/inorout -- --host 127.0.0.1`
  — bare vite binds [::1] only and qa-suite SILENTLY SKIPS otherwise) · **real-iPhone walk
  (Hard Rule 13)** — MobileSheet stacking + the missing `#m-sheet-host` fallback cannot be
  reproduced on desktop
- PR:

### P5 — Wire the gated CTA onto the public club page (THE LIVE SWITCH)
- status: pending
- deps: P4
- goal: the trial CTA appears on DF's page and NOWHERE else. Per-club switch, default OFF.
- tier-3 touch: outward — **SHIPS-LIVE**. This is the only phase a real parent can see.
- ⚠️ patch ALL THREE render sites (`clubPublicSections.jsx:38` TopBar pill, `:96` hero CTA,
  `:572` GetInvolved) — per `feedback_patch_every_render_site`. Note `TopBar` is passed bare
  `website` (`ClubPublicScreen.jsx:105`), so a website-less club shows no top pill AND a dead
  `href="#"` main CTA today.
- proof: everything in P4 + an explicit assertion that PA Sports' page is UNCHANGED with the
  switch off · ship-safety verdict · adversarial refute-pass · `/prod-verify` after merge
- PR:

## DF's live setup (created 2026-07-16 via the venue RPCs — NOT a migration)
⚠️ **This exists ONLY in the live DB. There is no source file.** PA Sports' equivalent setup
IS a migration (505), so the precedent says DF's should be too — on a fresh rebuild DF would
have no pitch, no classes, no sessions. **Fold it into 589** rather than leave it undocumented.

| Thing | Value |
|---|---|
| Venue | `v_ffff5528a0` · token `7857fd68-60e3-41c4-b8a5-726119ab32a8` |
| Space | `7dd27ddf-e2e3-48f2-abb1-2bdea748ea76` — Kenilworth Secondary School 4G Pitches (outdoor, cap 60) |
| Class type | `102f8869-2dee-4311-9e56-413393d210a0` — **Club Training** (Wed 17:30–18:30, 39 sessions) |
| Class type | `0ec92e71-2396-4f2b-8e57-1be5c8b37853` — **Tots** (Sat 09:00–10:00, 34 sessions, parents stay) |
| Instructor | ⚠️ **the OPERATOR, as a PLACEHOLDER** — swap to Danny when he is invited LAST |
| Term dates | Kenilworth School 2026/27 (ksn.org.uk/765/term-dates): Autumn 3 Sep–18 Dec (HT 26–30 Oct) · Spring 4 Jan–25 Mar (HT 15–19 Feb) · Summer 12 Apr–21 Jul (HT 31 May–4 Jun) |

- Both class types: `members_only=false` (⚠️ **it DEFAULTS TRUE** — left alone, a class is
  invisible to the prospective parent the whole trial flow exists for) and
  `first_session_free=true`.
- "Term time" = **one series per term SEGMENT** — `venue_class_series` has a single
  continuous `series_start`/`series_end` and cannot skip a half-term. Each segment ends on
  the last SCHOOL day (a Friday), which also excludes every break-opening Saturday for free.
  Verified: 0 sessions in any half-term/holiday, 1 distinct local start time (no BST drift).
- Taxonomy warts: `space_type` ∈ studio/room/hall/outdoor (a 4G pitch → `outdoor`);
  class `category` ∈ fitness/yoga/dance/martial_arts/other (football → `other`).

## OPEN — needs the operator (2026-07-16)
- 🔴 **Reception/Year 1 Saturday class — NEEDS A TIME.** Confirmed to exist, parents stay
  (so Ofsted is clear — the threshold is under-8s for >2h). Tots holds Sat 09:00–10:00.
  Create as a third class type, band `school_year_min=0, school_year_max=1`.
  *Without it, Reception + Y1 fit NEITHER Tots (`≤ -1`) nor Club Training (`2–6`) — the gap
  Mia Bennett (dob 2021-02-03, Year 0) currently falls into.*
- **Danny**: still NOT invited. **0 pending invites platform-wide = the email-identity hole
  is UNARMED.** `instructor_id` FKs to `venue_admins`, so "make Danny the instructor" MEANS
  creating his invite. Keep him last.
- **Mia Bennett** — DF member with no attendable class until the Reception/Y1 class exists.
  Fictional seed data; decide in 589.

## Owed outside this epic
- DF's page needs BRANDING + PUBLISHING (P1 only creates the inert row). Editor exists:
  `ClubAdminClubPage.jsx` → `venue_set_club_page`.
- **PA Sports has DUPLICATE `U7 Summer Holiday Camp` rows** — looks like a data bug. Not this
  epic. File via /backlog-capture.
- 🔧 **`.claude/hooks/pre-commit-build.sh` hardcodes `ROOT=/Users/tarny/platform`** — it
  `cd`s to the MAIN checkout, so committing from a git WORKTREE inspects the wrong repo and
  the migration/lint/build gates silently no-op. Both this epic's PRs were gated by hand.
  The hooks are meant to be deterministic, not dependent on the agent remembering. Fix in a
  dedicated dev-tooling commit.

## Log
<!-- one line per phase outcome: date · phase · result · PR# -->
- 2026-07-16 · plan gate · approved: cohort-link+override, per-club gated CTA, 5 phases (P1
  added — auto club page was new scope from the operator), #6 cleared to ship ahead of 586.
- 2026-07-16 · P1 · done · #570 — mig 587 applied; DF + Demo Martial Arts backfilled, inert.
  Caught+fixed a seed-replay trap the trigger would have introduced (both reviewers
  independently caught a `DO UPDATE` that could re-publish a taken-down page).
- 2026-07-16 · **decision REVERSED** · the plan-gate "session→cohort" model died on contact
  with the real session model (ONE mixed-age session, Years 2–6). Operator's ORIGINAL brief
  (a band on the class type) was closer to right — it just needed school years, not ages.
- 2026-07-16 · P2 · done · #571 — mig 588 applied, LIVE BUT DARK. Supersedes 580's
  age-today placement with the 31 Aug school-year cutoff.
- 2026-07-16 · DF setup · space + Club Training (39 Wed) + Tots (34 Sat) created via the
  venue RPCs, term-time-accurate. NOT yet in source — fold into 589.
- 2026-07-16 · **P4 RISK** · the design's session PICKER + "we suggest the Development
  group" sparkle banner assume MULTIPLE sessions to choose between. DF runs ONE. Screen 3
  becomes a single card and the DOB→suggestion has no job at DF. **Re-scope P4 against the
  real model before building four screens around a suggestion DF cannot use.**
</content>
