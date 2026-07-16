# Epic manifest — DF Sports public enrol / free-trial (PR #6 + #7)
- Epic: a prospective parent lands on DF Sports' public club page, books a free trial for
  their child in one guided flow, and CANNOT book that child into a session outside their
  age band. Done = P5 merged + DF's page published + a real-device walk.
- Plan gate: batched (approved in-session 2026-07-16)
- Merge mode: per-phase   (every phase is operator-merged; P2/P3/P5 are tier-3)
- Approved: 2026-07-16

## Decisions taken at the plan gate (do not re-litigate)
1. **Age band lives on the COHORT, session points at it** — `venue_class_types.cohort_id`
   → `club_cohorts(min_age,max_age)`, with a per-session `min_age`/`max_age` OVERRIDE
   (operator's call). Resolution = per-bound COALESCE(session, cohort). Both NULL on both
   sides → no check (the brief's "enforce ONLY when set").
   *Why not min/max on the session alone (as the brief said): `_cohort_for_dob` returns a
   COHORT, and sessions had no cohort link — so the brief's own DOB-suggestion half had no
   path to a session. (b) is the only shape where both halves work, and it reuses DF's four
   existing correct bands (U6 4–6, U8 7–8, U10 9–10, U12 11–12) instead of duplicating them.*
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
- status: pending
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

### P2 — Age band on sessions + enforce at booking (mig 588, "#7")
- status: pending
- deps: P1
- goal: `venue_class_types.cohort_id` (FK → club_cohorts) + nullable `min_age`/`max_age`
  override. Enforce in BOTH live booking RPCs, ONLY when a band resolves. Ships dark — no
  session has a band yet, so no booking behaviour changes for anyone.
- tier-3 touch: migration + RLS/RPC (money-adjacent: the booking path)
- ⚠️ CREATE OR REPLACE off the LIVE body (399 member / 429 guardian), NOT off mig 340.
- proof: check-build · check-rpc-security · check-rpc-columns · rpc-security-sweep ·
  ephemeral-verify (throwaway club+cohort+session+child: in-band books; out-of-band rejects;
  NULL band on both sides = no check; session override BEATS the cohort; NULL dob allowed —
  mirror the mig-584 `coach_must_be_16` precedent of never rejecting an unknown dob) ·
  check-mapper-sync · check-audit-events · paired `_down.sql`
- PR:

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

## Owed outside this epic (operator / data, not code)
- DF needs its page BRANDED + PUBLISHED (P1 only creates the inert row) and needs
  `venue_class_types` SESSIONS with a `cohort_id` — without sessions the picker is empty and
  the flow is the same dead end as today's external link. Check whether an admin UI path
  exists to create class types, or whether this is concierge SQL.
- Do NOT invite Danny — he is invited LAST, and trap 1 arms the moment any owner invite exists.
- PA Sports' duplicate `U7 Summer Holiday Camp` rows — file via /backlog-capture.

## Log
<!-- one line per phase outcome: date · phase · result · PR# -->
- 2026-07-16 · plan gate · approved: cohort-link+override, per-club gated CTA, 5 phases (P1
  added — auto club page was new scope from the operator), #6 cleared to ship ahead of 586.
</content>
