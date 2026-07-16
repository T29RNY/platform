# DF SPORTS — Coaching-Academy Onboarding & Gap-Fill

> Build invocation (epic): `/loop /dev-loop DF_SPORTS_ONBOARDING_HANDOFF.md`
> Plan gate: batched · **Merge mode: AUTO — all tiers, operator-authorized 2026-07-15** · Review cadence: **PHASE BOUNDARY** · Next-free migration: **577** (first-come-on-main).
> **Autonomy contract:** run hands-off; merge+deploy every green PR (all tiers) within a phase; **stop for operator
> review only at the END OF EACH PHASE.** PRs merge via GitHub (the `pre-push-guard.sh` hook still bars direct main pushes).
> EXCEPTION — external gates that still PAUSE their named PR regardless, because they are not mine to clear:
> ✅ **DPIA extension — SIGNED 2026-07-15** (#4/#6/#11 unblocked) · **device walks** → #6/#10/#13 · **real FA snippet**
> → #15 · **Stripe live keys** → real money · **App-Store freeze** → native /hub #8–13 if an Apple review is open.
> Code may ship to prod; **DF is not pointed at real families for MONEY until Stripe live is signed** (DPIA now cleared).
> Scope maturity: builds on `CLIENT_ONBOARDING_IMPORT_HANDOFF.md`, `PA_SPORTS_DEMO_HANDOFF.md`,
> `CLUB_MANAGER_DPIA_AND_SAFEGUARDING_PACK.md` (DPIA approved 2026-07-08) — inherit their locked decisions.

---

## WHAT IT IS

Package In or Out to **pilot, demo, and onboard DF Sports** — a facility-less kids' football **coaching academy**:
Danny + several DBS coaches, **ages 2–12**, ~hundreds of kids, age-banded weekly sessions + **holiday camps** +
birthday parties + 1-1 + school PPA, **its own competitive league teams**, feeds local Kenilworth clubs, **hires
venues it does not own**, and runs today on **Google Forms + bank transfer at ~£80/term/child**.

DF Sports is **a `club` (football discipline) with the same shape as the live PA Sports pilot** — the runtime
(club-admin/coach/guardian /hub tracks, cohorts→teams, memberships + per-child billing, holiday camps end-to-end,
competitive teams, public club page, the U18 safeguarding data model) **already exists**. The work is **onboarding +
polish + a coach cut-down login + academy-specific compliance**, built strictly additively so no live venue/gym/club regresses.

**The session model (confirmed):** his weekly coaching runs as **one open, mixed-age session per time-slot** ("Club
Training, Wed 5–6") that kids book into; coaches split the room into age bands and rotate stations on the day. The
platform was explicitly designed for this (mig 362). So there is **no one-coach-owns-a-cohort** assumption on his
coaching side — coaches are session staff. His **competitive league teams** keep the separate one-coach-owns-a-squad model.

**Primary users:** Danny (`club_admin`) · coaches (new team-less `club_coach` login) · parents (`guardian`) ·
kids (`member` profiles, mostly no login) · anonymous prospect parents (public page).

---

## LOCKED DECISIONS (confirmed this session)

1. **DF = a `club`, onboarded OPERATOR-LED** via a `superadmin_create_club` RPC that mints a shell venue stamped
   `origin='self_serve'` (the trap). No new entity type. Self-serve club signup (PR5) stays dark.
2. **Weekly coaching = the "course you buy up front" model** — a term is a CLASSES `season` (gets free-trial + waiting
   list); sessions run as open mixed-age class sessions. Confirmed engine fork (was the one open product question).
3. **Coach model = (ii) COACH CUT-DOWN LOGIN.** Coaches log in and see **their sessions + attendees + medical/allergy**;
   they do **NOT** see payments. A new **team-less `club_coach`** identity — NOT a venue-admin, NOT a widened team-coach.
   Read + take-the-register (attendance write included). Built additively per the REGRESSION RULES below.
4. **Real children's data gated on a DPIA EXTENSION** (academy scale + coaches seeing medical). Human/legal gate.
5. **Payments into DF's own Stripe (Connect), bank transfer kept** — card is the only payer-facing method; bank
   transfer is admin-recorded. Stripe dormant until live keys (Phase 7).
6. **Under-5 Ofsted registration + Tax-Free-Childcare = OFF the table for now** — additive later (PR #18 parked); until
   then DF keeps any long under-5 camps off the platform.
7. **DBS = warning for the pilot, HARD-BLOCK before scaling** (more important now coaches see medical).
8. **Free trial = full account first** (parent creates the child record, then books the trial) — safer, less anon PII.
9. **No computed league table for external-league teams** (FA link only, by design).

---

## KEY AUDIT FACTS (load-bearing — do not re-derive)

- **Next-free migration = 577** (highest on disk = 576; verify at build, first-come-on-main).
- **`superadmin_create_club`:** clone mig-518's atomic body (venue shell → owner → club → `club_venues`) + mig-085's
  `is_platform_admin()` gate + canonical audit. **MUST stamp `origin='self_serve'`** or `get_my_world`/nav.js hands Danny
  a full operator hat with no club-admin surface. Owner = pending-invite by `p_owner_email`; never return the venue token.
- **Coach identity is TWO systems today** — `venue_admins` (login staff, keyed by user_id; what `instructor_id` points at)
  and `club_team_managers` (team-scoped). A **team-less coach fits NEITHER** — that's why `club_coach` is a NEW arm/hat.
- **DBS record is club-level & standalone** (`club_staff_dbs`, keyed `member_profile_id + club_id`) — but the only
  *listing* (`venue_list_club_staff`) and every UI require a team. Team-less coach roster + DBS = new club-level path.
- **Mixed-age single session already works** (mig 362); class booking has NO age gate today (deliberate). Age-range is optional/off-by-default.
- **FA fixture ingest is ALREADY SHIPPED** (`fa_ingest_upsert_fixtures`, mig 450 + `_fa_parser.js` + cron). Gap = operator UI + a real snippet.
- **`venue_list_members` (mig 410) has a LIVE PII leak** — DOB + guardian contact to plain `staff`. Fix = mirror mig-524's cap-gate.
- **Deputising already works (desktop)** — an owner invites a co-owner/manager who auto-inherits the club-admin hat
  (mig 520/522); designate a Safeguarding Lead separately (mig 467/469). No mobile deputy screen yet.
- **DESIGNS ARE IN HAND** (high-fidelity, build to them): trial flow → `design_handoff_trial_booking_flow/` (PR #6);
  POTM award card → `design_handoff_player_of_the_match/` (PR #14); coach view → `design_handoff_coach_view/`
  (PR #8/10/11/12). Each folder has a README spec + a `.dc.html` reference. Reconciliation with our hygiene rules
  (all decided): (1) map the design palette to tokens — club accent = existing club-brand token, add ONE new semantic
  `--warn` medical/allergy red (`#DC2626`) to `tokens.css`; NO hardcoded hex; (2) rename any "MOTM" label → **POTM**;
  (3) **Phosphor fill weight is now allowed for a narrow named set only** — `warning`, `star`/`star-four`, the active
  nav-tab icon, and status/celebration badges; thin stays the default everywhere else.
- **BUILD-FIRST tooling commit (opens Phase 0, before PR #6/#8/#14):** add the `--warn` token to `tokens.css` +
  codify the narrow fill-weight exception in `skills/scripts/check-hygiene.sh` as a **dedicated commit** (override
  discipline — never bypass the hook). Small (~XS); unblocks every design PR.

### REGRESSION RULES (the coach-login touches shared plumbing — additive-only, byte-identical)

Verified consumers: role resolver `get_my_world`/`nav.js`; class booking (340/429); `venue_class_sessions.instructor_id`;
medical `club_manager_get_member_detail` (306); staff list `venue_list_club_staff` (305); attendance (304/552); `venue_admins`
caps (237). **Every one can be extended byte-identically if:**
- **Coach = NEW arm + NEW low-rank nav.js hat + payments-free `tabsFor`** — never a `venue_admins` operator row (would
  re-introduce the operator-hat-with-payments bug migs 520/522 fixed) and never a widened `club_team_managers` gate.
- **Role resolver:** reproduce every existing arm verbatim, add one new `SELECT INTO` + one new return key (the mig-520/522
  template). Rank the coach hat BELOW operator/guardian defaults. Grep every consumer (Hard Rule 12 — the is_self 12-day precedent).
- **Age-gate:** new nullable `min_age`/`max_age`, default NULL, branch only fires when both age AND dob are set → existing gym/venue bookings identical. Add to BOTH 340 and 429.
- **Instructor:** keep single `instructor_id` (NOT NULL, check-in principal) untouched; add a SEPARATE `venue_class_session_coaches` join for the extra coaches.
- **⚠️ HIGH-SCRUTINY #1 — Medical:** do NOT loosen Tiers 1/2 of `club_manager_get_member_detail`. Add a **Tier-3** scoped
  exactly to "a child booked into a session THIS coach is assigned to" — never "any child in the club." Wrong `OR` = a
  reportable data breach. Gate: rpc-security-sweep + DPIA.
- **⚠️ HIGH-SCRUTINY #2 — Staff/DBS board:** do NOT UNION null-team rows into `venue_list_club_staff` (SafeguardingBoard
  keys youth-DBS warnings off `cohort_id` → a team-less DBS-less coach would silently ESCAPE the warning). Return team-less
  coaches in a SEPARATE array + explicit youth handling.
- **Attendance:** new coach-scoped RPC (mirror `club_manager_mark_camp_attended`), leave existing gates identical.
- **Test tenants:** **PA Sports** (live club — walk all 5 personas), **Demo Sports Centre** (`demo_venue` — gym/classes,
  prove age-gate-off identical), **casual demo** (`team_demo` — football). Mandatory gates: casual-regression, ephemeral-verify (`_e2e_` fixtures), rpc-security-sweep.

---

## ROADMAP — PRs in order of completion

Tags: **Tier 1/2/3** · **CLEAR/PROTECTED** · Size XS–L · **Merge: Auto** (I merge+deploy) or **🚦You** (you decide).
Migration numbers assigned sequentially from 577 at build time.

### PHASE 0 — Security + onboarding foundation

### PR #0 · `venue_list_members` PII gate
T2 · PROTECTED · XS · Merge: 🚦You (RLS/PII). Mirror mig 524 (NULL email/dob/guardians for non-`manage_memberships`).
Gates: rpc-security-sweep · ephemeral-verify · check-build.
Done: plain-`staff` token gets those fields NULL; owner/manager output byte-identical.

### PR #1 · `superadmin_create_club` RPC
T3 · PROTECTED · S–M · Merge: 🚦You (auth/migration). Clone 518 body + 085 gate; stamp `origin='self_serve'`; pending-invite owner.
Gates: schema-sync · rpc-security-sweep · ephemeral-verify · paired _down.sql · check-build.
Done: minting DF yields a shell venue `origin='self_serve'` + one `club_venues` link + a pending-invite owner who resolves into the club-admin hat, never operator.

### PR #2 · Superadmin onboarding UI
T2 · CLEAR · M · Merge: Auto. `apps/superadmin` view (reuse `Venues.jsx`) calling PR #1.
Gates: check-build · browser smoke.
Done: a platform admin creates a facility-less club end-to-end and sees club_id/venue_id/owner-invite.

### PR #3 · `_cohort_for_dob` helper
T2 · CLEAR · XS–S · Merge: 🚦You (migration). DOB→cohort placer over `club_cohorts.min_age/max_age`.
Gates: paired _down.sql · ephemeral-verify · check-build.
Done: correct cohort across band boundaries incl. birthday-cutoff; NULL when no band.

### PHASE 1 — Stand DF up

### PR #4 · Single-club member/child/guardian import (MVP)
T3 · PROTECTED · M · Merge: 🚦You (minors bulk PII). Bespoke `is_platform_admin()` importer into `member_profiles`+`member_guardians`+`venue_memberships` (cohort via PR #3), PR4 safety patterns.
Gates: schema-sync · rpc-security-sweep · ephemeral-verify · paired _down.sql · ✅ DPIA (signed 2026-07-15) · 🚦 operator sign-off before first real roster (at the Phase 1 boundary) · check-build.
Done: a pasted U18 roster imports with zero consent/auth fields set, guardians linked, cohorts auto-placed; a re-run upserts by natural key.

### PR #4b · Let an imported family actually GET IN (claim-on-sign-in for members) 🔴 BLOCKS #4
T3 · PROTECTED · M · Merge: 🚦You (safeguarding — an email match hands over a child's medical record).
**Why it exists:** PR #4 mints unclaimed shells and its header asserts "a guardian claims their profile later via the
existing email-match sign-in flow (`member_claim_profile`)". **That flow does not exist.** `member_claim_profile` (mig
570) has zero app callers, and it is the ONLY function that can set `auth_user_id` on an existing profile (verified
against `pg_proc`). Meanwhile `member_self_create_profile` never looks for a claimable shell — it INSERTs a new row —
so an imported parent who signs up is **duplicated** and their child stays orphaned, silently. Import DF's roster
without this and every family is stranded. Shape ≈ PR #564 (claim-on-sign-in), but for members not venue_admins.
**🚦 BLOCKED ON AN OPERATOR DECISION — the claimable-shell rule. Three traps, all confirmed in the live DB:**
1. **Never trust `p_email`.** `MembershipSignup.jsx:158` pre-fills the login email but lets the user EDIT it, and the
   RPC takes `p_email` from the client. A claim MUST match `auth.users.email` (OTP-verified) or anyone can claim a
   stranger's child by typing their address.
2. **An email match is genuinely AMBIGUOUS.** A family email sits on the parent AND the child (live today:
   `bennett.family@example.com` → Claire Bennett + Leo Bennett, 7). An arbitrary `LIMIT 1` could claim a mother AS her
   own child. Note `get_user_relationships` also does `WHERE auth_user_id = v_uid LIMIT 1`, so a wrong claim is silent.
3. ⛔ **The obvious discriminator is BANNED.** "Has a `member_guardians` row → is a child → not claimable" is the exact
   rule mig 583 shipped and **mig 584 operator-corrected**: DF's 16-yo coaches legitimately have guardians on file, and
   it silently minted DUPLICATE people. Do not re-add it.
Candidate rules to choose between (operator call, not ours): claim only when EXACTLY ONE unclaimed shell matches the
verified email (0 → create as today; 2+ → refuse + surface to the operator rather than guess); and/or gate on age
(dob NULL or 16+, aligning with mig 584's coach rule) rather than on the presence of a guardian link.
Also decide: cross-club shells. The importer matches a guardian by email *within one club*, so a parent with kids at
two clubs gets TWO shells — but the model assumes one profile per person (`LIMIT 1`). Single-club DF is unaffected;
this bites the moment a second club imports.
Gates: rpc-security-sweep · ephemeral-verify · paired _down.sql · 🚦 operator decision on the rule · 🚦 DPIA check
(claim = access to special-category data) · check-build.
Done: an imported parent signs in with the email on their shell and lands on THEIR child — no duplicate person; a
mismatched/ambiguous case creates nothing and is surfaced, never guessed.

### PR #5 · Club-level coach roster + DBS/qualification records (no team)
T3 · PROTECTED · S–M · Merge: 🚦You (safeguarding data). Add a club-level coach/staff path so Danny lists coaches + records DBS/qualifications WITHOUT a team; team-less coaches shown in a SEPARATE array (not a null-UNION) with explicit youth-DBS handling.
Gates: schema-sync · rpc-security-sweep · ephemeral-verify · paired _down.sql · check-build.
Done: Danny adds a session-coach with no team + records their DBS; the coach + status shows on the desktop board and mobile ClubAdminPeople, and a missing/expired DBS still trips the youth warning.
**🔵 BUILT — DRAFTED, AWAITING APPLY SIGN-OFF (tier-3).** mig 582 (`club_coaches` table + `venue_upsert_club_coach` / `venue_remove_club_coach` / `venue_list_club_coaches`) + paired `_down`; 3 JS wrappers + barrel; read-wired into desktop SafeguardingBoard + mobile ClubAdminSafeguarding + ClubAdminPeople (team-less coaches in a SEPARATE array, server-computed `serves_youth` folds a crit-DBS session coach into the youth warning). DBS recording reuses the already-team-less `venue_upsert_staff_dbs`. Proven: lint/hygiene/build (inorout+core+venue) · pre-apply **ephemeral-verify 13/13 + leak=0** (DDL+seed+assert+rollback) · casual-regression PASS-by-scope (no casual surface touched, +36/−0 additive supabase.js) · check-live-config CLEAR on code (migration = tier-3). **NOT APPLIED — operator applies mig 582 then confirms live `pg_proc` security + walks the board.** Write UI ("add session coach" picker) = clean tier-2 fast-follow; RPCs proven so it's trivial.

### PHASE 2 — Growth funnel + core runtime

### PR #6 · Public enrol / free-trial CTA + leads (full-account-first)
T3 · PROTECTED · M · Merge: 🚦You (anon PII intake). His #1 growth job. New `club_leads` + guided full-account signup + trial booking wired onto the public club page (today: external link only); DOB pre-suggests a cohort.
Gates: schema-sync · rpc-security-sweep · ephemeral-verify · paired _down.sql · ✅ DPIA (signed) · 🚦 device-walk · check-build.
Done: a visitor creates an account + child on the public page and books a free-trial session; the operator sees the lead.

### PR #7 · Optional per-session age range (default off)
T3 · PROTECTED · S · Merge: 🚦You (money path). Nullable `min_age`/`max_age` on `venue_class_types`; enforce in 340 + 429 only when set.
Gates: rpc-security-sweep · ephemeral-verify · casual-regression · paired _down.sql · check-build.
Done: with no age set, gym/venue bookings are byte-identical; with a range set, an out-of-band child → `{ok:false,reason:'age_out_of_range'}`.

### PHASE 3 — Coach cut-down login (model ii) — additive-only

### PR #8 · Team-less `club_coach` identity + login + new resolver arm + coach hat
T3 · PROTECTED · M · Merge: 🚦You (role resolver, Hard Rule 12). New coach association (member-profile keyed) + a new `get_my_world` arm + a new low-rank nav.js hat with a **payments-free** tab set. NOT a venue_admin.
Gates: rpc-security-sweep · ephemeral-verify · casual-regression · paired _down.sql · check-build.
Done: a club_coach logs in and lands on a coach hat with no payments tab; every existing hat (operator/team_manager/guardian/member/referee) resolves byte-identically for PA Sports + real operators.

### PR #9 · Coach ↔ session association (additive)
T2 · CLEAR · S–M · Merge: Auto. New `venue_class_session_coaches` join; keep single lead `instructor_id` untouched.
Gates: rpc-security-sweep · ephemeral-verify · paired _down.sql · check-build.
Done: N coaches attach to one session; existing single-instructor gym/PA classes unchanged (zero join rows).

### PR #10 · Coach cut-down view (sessions + attendees roster)
T2 · CLEAR · M · Merge: Auto (🚦You for the device-walk). Reuse the team_manager roster/detail components, session-scoped, no money.
Gates: check-build · 🚦 device-walk.
Done: a coach sees their upcoming sessions and each session's attendee list with age.

### PR #11 · Coach medical access — session-scoped Tier-3 (⚠️ HIGH-SCRUTINY)
T3 · PROTECTED · S–M · Merge: 🚦You (special-category data). Add a THIRD auth tier to `club_manager_get_member_detail` scoped to "a child booked into a session THIS coach is assigned to." Tiers 1/2 untouched. Return shape byte-identical.
Gates: rpc-security-sweep · ephemeral-verify · paired _down.sql · ✅ DPIA (signed — covers coach-sees-medical) · check-build.
Done: a coach sees medical/allergy ONLY for children in their own session; a coach with no session for that child → `not_authorised`.

### PR #12 · Any-coach session register (attendance write)
T2 · CLEAR · S–M · Merge: Auto. New coach-scoped attendance RPC (mirror `club_manager_mark_camp_attended`); existing operator/team-coach gates untouched.
Gates: rpc-security-sweep · ephemeral-verify · paired _down.sql · check-build.
Done: an assigned coach marks their session register from /hub; other tenants' attendance gating unchanged.

### PHASE 4 — Competitive teams

### PR #13 · Coach mobile fixture creation
T2 · CLEAR · M · Merge: Auto (🚦You device-walk). New `club_manager_create_fixture` (`club_team_managers`-gated) + /hub UI.
Gates: rpc-security-sweep · ephemeral-verify · paired _down.sql · 🚦 device-walk · check-build.
Done: a coach creates a fixture from /hub; it appears in `club_manager_list_team_fixtures`.

### PR #14 · Guardian lineup/POTM/stats reader + kid "award card"
T2 · CLEAR · S–M · Merge: Auto. Guardian-gated reader over mig-516 stats/lineups (mirror 426/428 gating) + a shareable "Player of the Match" card off the same read.
Gates: rpc-security-sweep · paired _down.sql · check-build.
Done: a guardian sees the child's lineup slot + goals/assists/POTM; the award card renders; a non-guardian gets `not_guardian`.

### PR #15 · FA fixture-import operator UI
T2 · CLEAR · S · Merge: Auto (🚦You for the FA snippet). Operator screen over the shipped ingest (`venue_update_club_league`, `fa_last_synced_at`).
Gates: check-build · 🚦 real FA snippet from DF.
Done: operator saves an FA URL and imported fixtures appear `source='fa_import'`.

### PHASE 5 — Exit path + compliance-at-scale (before scaling beyond the pilot)

### PR #16 · Member offboard + record export (the exit path)
T3 · PROTECTED · S–M · Merge: 🚦You (retention/erasure). `venue_member_offboard` (left/graduated + reason) firing the DPIA Part-D clock + a parent "download my child's record" export.
Gates: schema-sync · rpc-security-sweep · ephemeral-verify · paired _down.sql · 🚦 DPIA retention alignment · check-build.
Done: marking a child left/graduated starts the retention clock and removes them from live rosters; a parent can export the record.

### PR #17 · DBS hard-block on coach assignment
T3 · PROTECTED · S–M · Merge: 🚦You (safeguarding). Flip coach assignment (and `club_coach` grant) to hard-block a non-`valid` DBS.
Gates: rpc-security-sweep · ephemeral-verify · paired _down.sql · 🚦 operator sign-off · check-build.
Done: granting a coach with an expired/absent DBS access to a youth session/team is refused.

### PR #18 · DBS / qualification expiry reminders
T2 · CLEAR · S · Merge: Auto. Expiring-soon nudge over `club_staff_dbs.expiry_date` (+ optional first-aid/coaching-badge records).
Gates: paired _down.sql · check-build.
Done: a DBS within N days of expiry surfaces to the welfare board / owner.

### PHASE 6 — Deferred (separate scope — parked by decision)

- **Ofsted-URN + under-5 camp guard + Tax-Free-Childcare status** (Decisions #6) — build when DF revives under-5 camps / childcare funding.
- **Coach:child ratio config + booking guard** — needs the coach/staff counts from Phase 3; add once coach-login is live.
- **Player development reports + kid badges/progress** (2–12) — the premium differentiator; own scope.
- **Sibling/family auto-discount · one-tap weather cancel-all-today · wraparound camp add-ons · coach hours/payroll ·
  franchise/multi-location console (the DF-as-channel opportunity) · mobile deputy screen.**

### NON-CODE GATES (human/legal — not mine to do)

- ✅ **DPIA extension — SIGNED 2026-07-15** (academy scale + coaches see medical). #4/#6/#11 unblocked.
- 🚦 **Stripe live-key swap (Phase 7)** + webhook `charge.refunded`/`invoice.payment_failed` fix — blocks real money.
- 🚦 **Real FA Full-Time snippet from DF** — blocks PR #15.
- 🚦 **Native device walks** (PR #6/10/13) + **App-Store privacy-label / age-rating review** for the youth build.
- 🚦 **Ofsted Childcare Register registration** — only if Phase 6 under-5/TFC is revived.

---

## 🚦 GATES the loop must stop at

Every tier-3/PROTECTED PR (#0,1,3,4,5,6,7,8,11,16,17); every migration; every money/auth/medical change; every
rpc-security-sweep + ephemeral-verify + casual-regression; and all NON-CODE gates above. CLEAR tier-1/2 PRs
(#2,9,10,12,13,14,15,18) merge+deploy automatically once CI is green and the review passes — except their device-walk
🚦 where tagged. **Nothing tier-3 auto-merges; no main push (`pre-push-guard.sh`).**

## DONE =

DF is stood up operator-led (PR #1/2), hundreds of kids+guardians imported (PR #4), Danny lists coaches + DBS (PR #5),
parents book a free trial on the public page (PR #6), **coaches log in to a cut-down view — their sessions, attendees
and medical, no payments, and take the register** (PR #8–12), his competitive teams fan out lineup/POTM (+ award card)
to parents (PR #13–15), kids can be offboarded/graduated with an export (PR #16), and DBS hard-block + expiry reminders
land before scaling (PR #17/18). Every phase proven against PA Sports + Demo Sports Centre + casual demo with no
regression. DPIA extension signed 2026-07-15; real money flows once Stripe live is signed.

---

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

**MISSED — the exit path.** The scope was intake-only; nothing let a child *leave* — which is DF's *defining identity*
("feeds local Kenilworth clubs"). The approved DPIA already keys retention to a "leaving" trigger, but no PR fired it and
there was no export/portability. **Fixed:** PR #16 (`venue_member_offboard` + parent record export).

**OPPORTUNITY — DF is a channel, not a customer.** DF has stood up the junior sections of 10+ Kenilworth clubs for 12+
years. `superadmin_create_club` (PR #1) is a **vending machine for every club DF feeds**, making the deferred franchise
console and the dark self-serve club vertical cheap — a repeatable coaching-academy SKU sellable to every grassroots
coach. Tax-Free-Childcare (parked) is the monetization multiplier no grassroots competitor has.

**FUTURE-PROOF — the `origin='self_serve'` stamp (Decision #1).** One enum value makes the operator-minted club
byte-identical to what self-serve will one day mint — zero backfill when compliance unblocks it, and the franchise
vending machine nearly free. Trivial now, unlocks the whole self-serve/franchise future.

**WOW — every audience covered.** Danny: paste his roster and watch hundreds of kids auto-band into cohorts in seconds;
his dead public page becomes a trial-lead machine. Parents: "your child was Player of the Match, 2 goals" pushed after a
game + a 30-second trial. Coaches: their own cut-down login with the kids and medical in their hand pitchside. Kids (was
the hole): the **award card** — a shareable "Player of the Match" image off data already captured. Vendor: stand up a
whole academy live in five minutes — the sales close for every grassroots coach.

---

## Related

`CLIENT_ONBOARDING_IMPORT_HANDOFF.md` · `PA_SPORTS_DEMO_HANDOFF.md` ·
`CLUB_MANAGER_DPIA_AND_SAFEGUARDING_PACK.md` · `CLUB_MANAGER_APP_HANDOFF.md` ·
`CLUB_CONSOLE_CONSOLIDATION_HANDOFF.md` · `COACH_PITCH_BOOKING_HANDOFF.md` · `STRATEGY.md`
