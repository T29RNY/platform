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

### P2b — Make school-year bands reachable (mig 589, the CAPABILITY)
- status: **needs-human: apply mig 589, THEN merge the PR (that order — see below)**
- deps: P2
- **SPLIT 2026-07-16.** P2b as first written bundled the capability with DF's data. The
  data half is blocked on an operator input (the Reception/Y1 class time), and would have
  REMOVED a child's access the moment it landed: DF's 6 kids are school years 6/4/2/2/2/**0**,
  and banding Club Training to Years 2–6 + Tots to pre-school leaves **Mia Bennett (Y0)
  able to book nothing** — today, bandless, she can book both. So the data moved to P2c and
  P2b ships the capability alone.
- goal (DONE): `club_create_cohort` + `club_update_cohort` take a school-year band;
  `club_list_cohorts` RETURNS it (it didn't — the client could set a band and never read it
  back); `venue_update_class_type` learns the four band columns. Cohort create AND edit on
  desktop AND phone, sharing one contract (`packages/core/constants/cohortBands.js`).
- ⚠️ **THE MANIFEST'S FILE POINTERS WERE WRONG — the 340→399 trap, twice.** It named
  mig 298:157 (cohort pair) and mig 339 (`venue_update_class_type`). **Both were
  superseded**: the live definers are **389** and **399** (confirmed against
  `pg_get_functiondef`; exactly one overload of each). Patching 298/339 would have been a
  silent no-op — the exact failure 588's own header warns about.
- ⚠️ **The manifest was also wrong that apps/venue has no cohort modal.** It has a full
  create+edit one at `MembershipsView.jsx:2505` (`CohortModal`) — it's just an internal
  function in a 3,500-line file, not a `*CohortModal.jsx`. Desktop was an EXTENSION, not a
  build. `apps/clubmanager` untouched per the retirement decision.
- **INVARIANT INTRODUCED:** a cohort/class is banded by school year XOR age, never both
  (588's resolver makes a year band win outright, so a mixed band is dead data that still
  renders). RPCs reject it (`band_conflict`); both UIs offer it as an either/or toggle.
  `p_grouping` ('school_year'|'age') exists because 389's all-COALESCE update could SET a
  band but never CLEAR one — so switching a cohort off ages was impossible. Omit it and
  389's exact semantics survive, which is what the two SeasonRolloverModal callers rely on.
- **Three gaps found and fixed that the manifest never listed:**
  · Season rollover bumped min/max age +1 — a year cohort has NULL ages so it silently
    no-opped while still showing a promotion chip. Now defaults OFF with "moves up on its
    own each 1 Sep" (588's cutoff already rolls every child on 1 Sep).
  · Youth/DBS detection keyed on `category='youth' || max_age<18` — a year cohort has NULL
    ages, so the DBS warning silently SKIPPED exactly the cohorts 588 introduced. Now
    `isYouthCohort` (shared); any school-year band counts as youth.
  · The phone's new edit path would have stamped `category='youth'` on a null-category
    cohort (desktop create allows null) — a rename would have flipped a "First Team" into
    the DBS-warning set. Caught by the QA reviewer.
- **SECURITY (found by the security reviewer, fixed here):** `venue_update_class_type` has
  NO cap gate (399's design — any staff role may rename/re-space a class). Fine while every
  field was operational, but the band columns are what `_class_age_eligibility` reads to
  refuse a booking: a staff-role admin WITHOUT `manage_memberships` could clear a U12's band
  and let a parent book a 6-year-old in. 589 adds the cap **scoped to band keys only**, so
  no existing caller changes. EV-proven: staff cannot clear, staff can still rename.
- tier-3 touch: migration + RPC signature changes (7→9, 8→11 — DROP the old arities first)
- proof (done): **EV 19/19 on the UNAPPLIED migration** — MCP `execute_sql` runs a
  multi-statement call in ONE transaction, so the rollback reverts the DDL too; the
  migration is fully proven while still unapplied, and the catalog was asserted back to
  389/399 afterwards ([[reference_ev_before_apply]]). Includes the real point: a band
  written through the RPC is then ENFORCED by 588's guard (admits Rhian/Y2, refuses
  Mia/Reception, admits NULL dob). + a second EV 3/3 for the cap gate · check-lint ·
  check-hygiene · both builds · Playwright walk of the desktop band picker (2/2) ·
  casual-regression (casual token routes identical to a stashed origin/main baseline —
  1 pre-existing red, `tokens.memberpass-frozen`, PROVEN pre-existing) · paired `_down.sql`
- ⚠️ **APPLY 589 BEFORE MERGING — not the other way round.** The new wrappers always send
  `p_school_year_min/max`, which the live 7/8-arg functions reject, so merging first would
  404 cohort create/edit **and the existing Season rollover** (a working flow). The reverse
  is safe: old JS → new RPCs resolves via the NULL defaults (EV-proven).
- **NOT strictly dark** (an adversarial pass refuted that): `bad_age_band` now rejects a
  min>max band the UI previously saved as nonsense, and the venue cohort chip re-words
  ("16–? yrs" → "Ages 16+") now both apps share one label. 0 live rows affected; the chip
  lands on the next MANUAL venue deploy.
- PR: **#573** — CI green on platform-clubmanager (the live inorout app); platform-ref red
  = the known every-PR false alarm.

### P2c — Turn it on for DF (mig 590)
- status: **needs-human: apply mig 590** (P2b/589 is APPLIED + MERGED, so the dep is met).
  Unlike 589 there is no apply-order trap here — 590 is data-only, touches no RPC and no JS,
  so apply and merge are independent. **This is the first phase a DF parent could feel.**
- deps: P2b ✅
- **Operator decision 2026-07-16: ONE COHORT PER SCHOOL YEAR.** Pre-school + Reception +
  Year 1..6 = 8 cohorts. A cohort is a register LABEL — Danny's need is "what year group is
  this child, so groups stay balanced" when he splits a mixed-age session on the day, and
  per-year is the only shape that answers it precisely. The 4 age cohorts are DEACTIVATED,
  not deleted (0 club_teams reference them — verified live).
- Reception/Y1 Saturday class: **10:00–11:00** (operator), straight after Tots. Mirrors Tots
  exactly: same space, same instructor, same 6 term segments, 34 Saturdays, free + door.
- ⚠️ **Why the class is in the SAME migration as the bands:** DF's children are school years
  6/4/2/2/2/**0**. Banding Club Training to 2–6 and Tots to pre-school leaves **Mia Bennett
  (Y0) able to book NOTHING**. Creating the class in the same migration is what stops that.
- 🐛 **EV CAUGHT A REAL BUG — a silent 1-hour BST drift.** `generate_series(DATE, DATE,
  INTERVAL)` resolves to the **timestamptz** overload, so `d` is already tz-aware and
  `AT TIME ZONE` runs BACKWARDS (timestamptz → naive local), which the timestamptz column
  then re-reads as UTC. Measured: 17 Oct 2026 → 11:00 local, 31 Oct → 10:00 — the autumn
  term straddles the 25 Oct clock change, so **half of DF's parents would have arrived an
  hour early**. Fix = `d::date` (forces `date + time` → naive timestamp → the intended
  local→timestamptz direction). Build/lint/hygiene could never see this; only the EV's
  "exactly 1 distinct local start time" assertion caught it. That invariant is the same one
  the DF setup notes recorded for the existing classes — it earned its keep.
- tier-3 touch: migration + a REAL club's live data
- proof (done): **EV 11/11** against a throwaway DF-SHAPED fixture (Hard Rule 15 — never DF
  itself), asserting the outcome that matters: Mia is REFUSED Club Training but CAN book
  Reception & Y1 (access preserved), a Y2 books Training and is refused Reception, Tots
  EJECTS a Reception child (what an age band cannot do), NULL dob still admitted (mig 584),
  34 Saturdays all at 10:00 local, no space clash with Tots. Leak check 0/13; DF's real rows
  confirmed untouched. Paired `_down.sql` (⚠️ reverse 590 BEFORE 589; deletes the Reception
  class — check for bookings first).
- PR:
- goal:
  1. **DF data**: cohorts → school years (Y2..Y6), remap the 6 kids' `venue_memberships`
     off U6/U8/U10/U12, deactivate the old ones. `Club Training` band = school_year 2–6;
     `Tots` band = `school_year_max = -1` (pre-school — ejects a child exactly when they
     start Reception, which an age band cannot do).
  2. **The Reception/Y1 Saturday class — operator gave the time 2026-07-16: 10:00–11:00**
     (Tots holds 09:00–10:00, so it slots straight after). Band `school_year_min=0,
     school_year_max=1`. **Without it Mia Bennett (Y0) can attend nothing** — she fits
     neither Tots (`≤ -1`) nor Club Training (`2–6`).
  3. Fold DF's live setup into source (venue/space/class types created via RPCs, no source
     file — see "DF's live setup" below). PA Sports' equivalent IS a migration (505).
- tier-3 touch: migration + DF's real data
- proof: ephemeral-verify · a walk of the year-cohort paths P2b could NOT test (no
  school-year cohort exists on any seed yet, and Hard Rule 15 forbids creating one against
  demo data — so the rollover auto-chip + the year-band label are UNPROVEN in a browser
  until DF has real year cohorts)

### P3 — club_leads + the anon plumbing (mig 591, "#6" server half)
- status: pending
- deps: P2  (renumbered 589 → 591: P2b took 589 and P2c takes 590)
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
- ✅ **Reception/Year 1 Saturday class — TIME GIVEN 2026-07-16: 10:00–11:00.** Straight
  after Tots (09:00–10:00). Parents stay (so Ofsted is clear — the threshold is under-8s
  for >2h). Create as a third class type, band `school_year_min=0, school_year_max=1`.
  Builds in **P2c**. *Without it, Reception + Y1 fit NEITHER Tots (`≤ -1`) nor Club
  Training (`2–6`) — the gap Mia Bennett (dob 2021-02-03, Year 0) falls into.*
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
- 🔧 **The gate scripts diff against LOCAL `main`, which is routinely stale** (found P2b).
  `check-diff-triggers.sh:26` and `check-live-config.sh:24` both use
  `git diff --name-only main...HEAD`. The shared checkout sits on a feature branch, so its
  `main` was 3 commits behind `origin/main` — both scripts blamed P2b's diff for P1's and
  P2's already-merged migrations (447/505/587/588). It only ever OVER-reports (fails safe),
  but it makes a "deterministic" gate depend on whether someone ran `git pull`. Use
  `origin/main...HEAD`, or the merge-base.
- 🔧 **`check-live-config.sh` can't see UNTRACKED files** (same family, worse). `git diff`
  only reports tracked paths, so a brand-new migration — the single thing most needing a
  ship-safety verdict — is classified as *nothing* until it's `git add`ed. P2b's 589 was
  invisible to the gate until staged. Should `git add` first, or use
  `git status --porcelain` / `ls-files --others`.
- 🔧 **`node --check` cannot parse `.jsx` on Node 24** — it throws
  `ERR_UNKNOWN_FILE_EXTENSION` on the extension, not the syntax. The dev-loop proof gate
  lists it as step 1 for "each changed .js/.jsx"; for JSX it is pure noise that *looks*
  like a failure. ESLint is the real parser gate. Drop .jsx from that step or route it
  through a parser that handles JSX.
- 🔧 **A fresh `git worktree` has no `node_modules` and no gitignored `.env.local`** — so
  `check-lint.sh` SKIPS ("eslint not installed", i.e. the runtime-ReferenceError gate is
  silently inactive) and every app boots unconfigured, which fails every e2e as a
  mysterious "page didn't render". Both cost real time in P2b. Worth a one-line worktree
  bootstrap (`npm install` + copy `.env.local` from the main checkout) in the dev-loop's
  worktree step.
- 🔧 **ESLint `no-undef` does NOT catch an import of a name a module doesn't export** — the
  import statement declares the binding regardless, so it's `undefined` at runtime. P2b hit
  this for real: the band helpers were added to the `@platform/core/storage/supabase.js`
  import block when they live in the `@platform/core` barrel — lint passed clean. This is
  the mig-070 `is_self` class (Hard Rule 12). A `check-exports.sh` that resolves every
  named import against its module's actual exports would catch it deterministically.

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
- 2026-07-16 · **P2b SPLIT → P2b (capability) + P2c (DF's data)** · the data half would have
  left Mia Bennett (school Year 0) unable to book anything, and was blocked on the
  Reception/Y1 class time (operator gave it: Sat 10:00–11:00). Capability ships alone.
- 2026-07-16 · **P2b ✅ APPLIED + MERGED + DEPLOYED** · #573 — mig 589 applied (4 RPCs, one
  overload each, PostgREST cache flushed), PR merged, inorout prod deploy Ready, **apps/venue
  MANUALLY DEPLOYED to venue.in-or-out.com** (plain `npm run build` + prebuilt upload — NOT
  `vercel build`, which ships a blank page; live bundle grep-verified + browser-smoked).
  Post-deploy: casual demo player route intact in live prod (the `packages/core` barrel was
  the real risk). Data confirmed unchanged: 0 year bands, 0 conflicts, DF's 6 kids untouched.
- 2026-07-16 · **P2c built, EV 11/11, needs-human: apply 590** · operator chose ONE COHORT
  PER SCHOOL YEAR. **The EV caught a silent 1-hour BST drift** (`generate_series(DATE,…)`
  returns timestamptz → `AT TIME ZONE` ran backwards) that would have had half of DF's
  parents arrive an hour early after the 25 Oct clock change. No build/lint/type check could
  have seen it.
- 2026-07-16 · P2b · built, EV 19/19 + 3/3, **needs-human: apply 589 THEN merge** · PR TBD
  — mig 589 makes 588's school-year band writable/readable at last (`club_list_cohorts`
  never returned it, so a client could set a band and never read it back). The manifest's
  own pointers were stale AGAIN (298/339 → really 389/399 — the 340→399 trap, twice), and
  its "no cohort modal exists in apps/venue" was wrong (one's been there all along at
  `MembershipsView.jsx:2505`). **Lesson, same as 580's:** this manifest's base-state facts
  have now been wrong three times in one epic — verify a recorded pointer against
  `pg_get_functiondef` / the actual file before building on it, every time.
  Three unlisted gaps fixed (season rollover silently no-opping on year cohorts; the
  youth/DBS warning silently SKIPPING year cohorts; the phone's edit stamping
  category=youth). Security review found + EV-proved a real hole: a staff-role admin
  without `manage_memberships` could clear a class's age band and let a 6-year-old book a
  U12 — now capped.
</content>
