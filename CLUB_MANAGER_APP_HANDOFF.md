# Club Manager App — Epic Manifest

*Scoped 2026-07-08. Audit + plan only — no code yet.*
*Runs as an UNMANNED epic loop: `/loop /dev-loop CLUB_MANAGER_APP_HANDOFF.md`.*
*Each `### PR #n` = one dev-loop cycle → one PR.*

**Merge mode: auto** · **Plan gate: batched**

> **🟢 2026-07-08 — OPERATOR CLEARED G2 + G3 (in-session standing sign-off, recorded in DECISIONS.md).**
> The loop is now authorized to complete #10 → #8 → #7 → #9 → #11 fully autonomously: draft new
> venue-token SECURITY-DEFINER RPCs + matchday tables, EV-prove (rollback + leak-check 0), **APPLY to
> the live DB** (re-derive free mig # off `main`; land `.sql` same commit), auto-merge each green PR.
> **Proof gates stay ON** (rpc-security-sweep + ephemeral-verify + leak-check-0 before every apply).
> DPIA APPROVED → #11 builds against real data. Stripe = test-mode (G4 deferred). **The ONE remaining
> stop = G5:** the real-club demo→live swap (real children's data to prod) + Apple companion review —
> loop builds #12 to go-live-ready and hands back. Real-iPhone `/hub` walks (HR#13, #4/#7/#8) logged as
> owed (agent can't drive a device), to clear before G5. Build order below.

### 📌 EPIC STATUS LOG
- **PR #1 — ✅ MERGED #355 (2026-07-08).** App shell + SSO auth + navy/gold tenant theming +
  read-only dashboard (DBS/This-week/Money tiles). Built in worktree `clubmanager-pr1` off
  `main`. Proven: eslint + hygiene 8/8 + build + **live Playwright SSO smoke as demo PA admin**
  (real seed data, 0 console errors). Fresh QA+Security review clean (crash/race/slug-fragility
  fixed pre-merge; security CLEAN). Ship-safety CLEAR (source-only, no deploy). Hygiene scope
  extended to `apps/clubmanager/src` (own commit). **⛔ OWED: G1** — operator creates the
  `platform-club-admin` Vercel project (`rootDirectory: apps/clubmanager`) + sets
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/`VITE_AUTH_COOKIE_DOMAIN`, then `/prod-verify`.
  **Future hardening owed:** have `venue_list_clubs` carry the real `club_pages` slug so branding
  isn't derived from the club id (currently guarded by a `club.id === selectedClubId` match).
- **PR #2 — ✅ MERGED #356 (2026-07-08).** People + Structure views. Structure = cohort→team org
  chart + create/edit cohort, create/edit/archive team, team invite QR (`clubEnsureTeamInviteLink`
  + react-qr-code). People = coaches/staff (`venueListClubStaff` + DBS R/A/G) + members
  (`venueListMembers`). Feature-gated nav (`getVenueFeatureFlags`). Token Modal + ToastProvider.
  Proven: gates green + live smoke (real cohorts/teams; team EDIT write persisted+reverted zero
  residue; invite QR real code; 4 real coaches). QA+Security clean (Members double-unwrap blocker
  fixed). Ship-safety CLEAR. **⚠️ SCOPE DEFERRED (auth/data-driven):** coach-ASSIGN write + per-team
  youth ROSTER + clinical member detail — the only club-roster reads are coach-`auth.uid`-scoped
  (admin can't call), clinical fields are G3-gated child data, and NO venue-token club-roster read
  exists. → land with coach persona (PR #4) / safeguarding (PR #11) or a future venue-token roster
  RPC. Structure shows member COUNTS only (no minor PII).
- **PR #3 — ✅ MERGED #357 (2026-07-08).** Schedule: clash-aware multi-ground occupancy calendar
  (`getOperatorPitchOccupancy`) + create fixture (`venueUpsertClubFixture`) + create training series
  (`clubCreateSessionSeries` — venue-token twin; `club_manager_*` are coach-auth) + bump-proposals
  panel (`venueListBumpProposals`/`venueResolveBump`, accept/**decline**). Ground picker = Decision-2
  target-venue picker. Clash = `slot_unavailable` (P0001) caught → toast, write rejected (zero
  residue). Proven: gates green + live smoke (real occupancy 2 grounds; real fixture pickers; clash
  surfaced zero residue). QA+Security clean (bump-action `reject`→`decline` blocker fixed). CLEAR.
- **PR #4 — ✅ MERGED #360 (2026-07-08) · SHIPS-LIVE (first live-app deploy).** Coach `/hub`
  Tonight + People tabs in `apps/inorout/src/mobile` (were placeholders). Additive: 2 new screens
  (`TeamManagerTonight` availability board via `clubManagerListTeamFixtures`; `TeamManagerPeople`
  roster via `clubManagerGetTeamMembers` + medical-notes FLAG only, G3 boundary held) + 2 branches
  in MobileShell (no casual/guardian/operator/referee branch touched; scoped `[data-surface=mobile]`).
  Proven: hygiene 8/8 + lint + inorout build + casual-regression STATIC PASS + live browser smoke as
  demo coach (both tabs, real data). Reviews: Security CLEAN (child G3 boundary), QA ship-safe
  (race guard + dead import fixed), adversarial CANNOT-REFUTE casual safety. Own-app CI green;
  prod deploy live + healthy (0 console errors). Operator authorized ships-live unmanned. ⚠️ Rebased
  twice onto advancing main (#358/#359). ⛔ **real-iPhone /hub coach walk OWED** (HR#13, before G5).
  NB: adult-self + training-session availability deferred (no coach-scoped session-attendance-board
  RPC; would need new backend — not additive).
- **PR #5 — ✅ MERGED #361 (2026-07-08) · CLEAR.** Comms: compose+send club/cohort/team announcement
  via `clubSendAnnouncement` (venue-token, `manage_memberships`; delivery = existing broadcast cron)
  + session-local sent list. Proven: gates green + smoke (form + audience picker + send-validation;
  successful-send NOT fired vs pilot — cron emails real recipients — verified by code+reviews).
  QA+Security CLEAN. **DEFERRED (backend-needing):** persistent admin sent-history read; Decision-9
  admin/welfare nudge (broadcast cron is outbound-to-members only, no admin-recipient branch); coach
  team announcements (coach-auth → /hub); two-way chat (separate epic).
- **PR #6 — ✅ MERGED #364 (2026-07-08) · CLEAR (built display-only).** Memberships money dashboard:
  KPIs (active/MRR/renewals) + collected/outstanding + outstanding-subs list + members roster + tiers
  — all venue-token PURE reads (`venueMembershipSummary`/`venueGetCharges`/`venueListMembers`/
  `venueListMembershipTiers`), NO Stripe, NO writes → check-live-config CLEAR despite PROTECTED label.
  Proven: gates green + smoke (real data: 31 active, £550 MRR, £600 outstanding). QA+Security CLEAN.
  Member join stays the apps/inorout `/q` surface (not admin console). Noted: `venue_list_members`
  over-fetches (dob/email/guardian) — future payload trim. Join-link surfacing → PR #10.
- **⚠️ Migration numbering:** parallel sessions advancing main — next free was 510, now **≥515**
  (510–514 taken by other in-flight branches per MEMORY). **Re-derive off `main` at PR #7/#8 build.**
- **PR #7 — SPLIT after audit 2026-07-08; operator chose 7a.** The audit found "#7" conflated three
  surfaces with different auth: **7a** coach team-reliability board + Smart-Teams (coach-auth, mirrors
  mig 516, scaffolding exists in the TeamManager* /hub screens) — **✅ BUILT 2026-07-08 (mig 517, PR open)**: reader `club_manager_get_team_ratings_table` (neutral engine shape + reliability, denominator = RSVP-solicited fixtures only) + new /hub `TeamManagerSquad` (reliability board + balancer, drill-in from People); engines reused unchanged; rpc-security/EV+leak-0/build/hygiene/casual-static/QA+Security all clean; check-live-config CLEAR; ⛔ real-iPhone walk owed; **7b** Gaffer
  club-context RPC + dark panel (needs a new coach-auth path in `api/gaffer.js`) — **DEFERRED** (its own
  PR, ships dark); **7c** adult-player-self `/hub` track (own reliability/POTM — the "adult-player wow")
  — **DEFERRED** as a genuine new-surface product decision (no scaffolding today; strategically the
  attendance-wedge engagement play but a large build). Engines confirmed NEUTRAL (no lift); reliability
  is a new coach-auth SQL aggregate; BT skill axis degenerates for club league games (opponent-vs-us has
  no intra-squad A/B) → 7a rating leans on goals/POTM/form/reliability, balancer = training/scrimmage tool.
  7a = 1 tier-3 reader migration (517) + wrapper + a coach `/hub` reliability+balance screen. (original audit note below)
- **PR #7 (original audit note) — ⏸️ DEFERRED to the tier-3 batch (audit 2026-07-08).** No clean CLEAR slice exists:
  (1) the shared engines (`playerRating.js` `computePlayerRatings`, `groupBalancer.js`
  `generateBalancedTeams`) are ALREADY pure/neutral/storage-agnostic → NO lift needed, and PR #8 can
  consume them directly (so #8 does NOT depend on #7 — the manifest's sequencing premise is void).
  (2) Club Smart-Teams/rating is BLOCKED on PR #8: Bradley-Terry needs per-player match results
  (team_assignment + W/L) which `club_fixtures` lack (aggregate score only; per-player = PR #8's build).
  (3) A proper (all-time) club reliability board needs a NEW venue-token aggregate reader RPC (only a
  per-session admin read exists, `club_get_session_rsvps`; client-side all-time = O(sessions) chatty).
  (4) `gaffer_get_context_club_*` don't exist = new RPCs. So #7's real value = migrations (tier-3) or
  #8's data. → build #7 in the tier-3 migration batch (draft + EV-prove + STOP for apply sign-off),
  AFTER #8 lands the per-player match data. Gaffer UI is flag-gated OFF (`VITE_GAFFER_ENABLED`) so it
  ships dark later.
- **TIER-3 CLUSTER (need human sign-off — migrations / DPIA / go-live):** #7 (reliability-aggregate +
  gaffer readers migration, post-#8), #8 (matchday tables/RPCs = G2), #11 (DPIA = G3), #12 (go-live = G5).
- **PR #10 — ✅ BUILT 2026-07-08 (mig 515, PR open) · tier-3 CLEAR (venue-admin console + separate manual-deploy project).**
  Resolved via arch decision A: 3 NEW venue-token twins (`venue_get_club_page`/`venue_set_club_page`/
  `venue_publish_club_page`, mig 515) mirror the club-manager originals (446/448) with the auth block
  swapped for the venue-token preamble (template = `venue_set_club_discipline` 355): `manage_facility`
  cap + `club_venues` scope (`club_not_in_venue`) + kept `public_web` feature gate. New console view
  `apps/clubmanager/src/views/ClubPage.jsx` (`/club-page` flipped live, admin-hat only) edits
  slug/3-colours/crest+hero URL/tagline/about/socials/publish; reuses the Comms.jsx idiom. Public
  reader `get_club_public` UNCHANGED (U18 transform server-side). Proven: mig 515 applied-to-live +
  `.sql`/`_down.sql` same commit; rpc-security 3/3; EV 11/11 + leak-0 (all paths + rejects, auto-rollback);
  real auth-path confirmed (demo admin = `owner` on `demo_venue` → `manage_facility` passes, demo_venue
  has a linked club); build PASS (clubmanager+inorout); hygiene 8/8; casual-regression STATIC PASS
  (packages/core additive-only). **DEFERRED:** crest/hero FILE upload (club-media bucket RLS is
  club-manager-auth → venue admin can't upload; URL fields ship now, venue-token signed-upload = follow-up);
  safeguarding edit (tightening-only twin, separate). ⛔ **owed: live ClubPage UI walk** (needs interactive
  SSO; cleared at the manual clubmanager deploy / supervised prod-verify).

## ✅ ARCHITECTURE DECISION — RESOLVED 2026-07-08: OPTION (A)
**Operator chose (A): add venue-token admin RPCs** so the club owner/admin can do the coach-auth
features (club-page edit, all-club roster read, club reliability) from the ONE admin console — keep
everything unified (do NOT scatter to coach surfaces / option B). So #7, #10, and the #2 roster gap
each get a new venue-token SECURITY-DEFINER reader/writer (tier-3 migration, draft + EV-prove + STOP
for operator apply-sign-off; never apply unmanned). Details of the split below (kept for context).

## (historical) venue-admin vs club-manager auth split
The Club OS backend splits two personas: **venue-admin (venue-token)** = structure/schedule/tiers/
comms/staff (ALL SHIPPED #2/#3/#5/#6) vs **club-manager/coach (`auth.uid` + club_team_managers)** =
rosters, club-page edit, session detail, reliability/Smart-Teams. Decisions 2/3 assumed the venue-admin
does everything via venue-token, but rosters (#2 deferred), reliability (#7), and club-page (#10) are all
coach-auth. To finish those in the venue-admin console needs either (a) NEW venue-token RPCs for each
(tier-3 migrations), or (b) coach surfaces + broadening console access to coach-only users (a PR#1-shell
change). **Operator call required.**

## STATUS 2026-07-08 (autonomous CLEAR stretch complete — 6 PRs shipped)
✅ MERGED: #1 shell #355 · #2 People/Structure #356 · #3 Schedule #357 · #4 coach /hub (SHIPS-LIVE) #360 ·
#5 Comms #361 · #6 Memberships #364. Remaining = tier-3/human-gated:
- **#10** club-page (coach-auth → needs venue-token RPC or coach surface — arch decision above)
- **#7** reliability/Gaffer (needs migrations; Smart-Teams blocked on #8's per-player data)
- **#8** matchday line-ups — ✅ **BUILT 2026-07-08 (mig 516, PR open)** · check-live-config CLEAR (additive coach
  screen). 2 new tables (club_fixture_lineups + club_fixture_player_stats) + 3 coach-auth RPCs (get_fixture_detail/
  set_fixture_lineup/record_fixture_stats) + get_club_public top-scorer un-nulled (U18-safe, senior-only). New /hub
  screen TeamManagerMatchday (tap a fixture → pick XI + log stats/POTM + result), drill-in from TeamManagerLeague.
  Proven: mig 516 applied-to-live + _down same commit; rpc-security 4/4; EV 9/9 + leak-0 (auth.uid simulated); no
  get_club_public regression; build PASS; hygiene 8/8; casual-regression STATIC PASS; QA/Security/adversarial all
  clean. ⛔ **owed: real-iPhone /hub matchday walk (HR#13)** — logged, cleared before G5. This LANDS the per-player
  data PR #7's Smart-Teams/reliability was blocked on.
- **#9** season rollover — ✅ **BUILT 2026-07-08 (PR open) · CLEAR (no migration).** Composes existing
  venue-token writers `clubUpdateCohort` (age +1 + relabel U11→U12) + `clubArchiveTeam` in one reviewed
  `SeasonRolloverModal` in the clubmanager Structure console. Adult cohorts default OFF (no age creep);
  partial-failure keeps the modal open and re-applies ONLY failures (never double-promotes — QA-flagged,
  fixed). Roster auto-carry DEFERRED (coach-auth / no venue-token roster writer — players re-join promoted
  teams via the existing join flow). Proven: hygiene 8/8, lint, clubmanager build, check-live-config CLEAR,
  QA review (fix-first #1 resolved). ⛔ clubmanager manual-deploy + SSO walk owed.
- **#11** safeguarding board — ✅ **BUILT 2026-07-08 (PR open) · CLEAR (no migration, G3 DPIA cleared).**
  Welfare-officer compliance board in the clubmanager console (`/safeguarding` flipped live): DBS clearance
  R/A/G (reuses People `dbsChip`; cert number never leaves server) + youth-cohort no-DBS **display-only
  warnings** (never enforced) + read-only public-page protection panel (min_public_age/hide_public_rosters;
  loosening is a policy decision, not built) + **Lead-only, count-only** open-concerns panel (button-triggered
  audited read; non-Lead sees neutral message, never a count — existence-oracle safe; no incident content on
  the dashboard). Composes existing venue-token readers only. Proven: hygiene 8/8, lint, build, check-live-config
  CLEAR, QA SHIP + safeguarding-security review SECURE-TO-SHIP (all 7 boundaries hold). Deferred: welfare-officer
  NAME (needs venue-token committee reader = tier-3), enforced DBS-assignment block (product+legal), count-only
  concerns reader (GO_LIVE_ISSUES hardening). ⛔ clubmanager manual-deploy + SSO walk owed. · **#12** go-live (G5)
**✅ G1 DONE 2026-07-08** — created Vercel project `platform-club-admin` (tarny-s-projects, isolated from
the live inorout project) + deployed the built app as prebuilt-static (venue/hq pattern). LIVE + public
at **https://platform-club-admin.vercel.app** — verified: signs in as demo admin → navy/gold PA Sports
console with real data. ⚠️ prebuilt-static = MANUAL redeploy on future changes (not git-auto-deploy;
rebuild `apps/clubmanager` with `.env.local` public creds → `vercel deploy --prod` from
`apps/clubmanager/dist`, linked to platform-club-admin). Optional follow-ups: git-integration for
auto-deploy; a `club.in-or-out.com` subdomain + `VITE_AUTH_COOKIE_DOMAIN=.in-or-out.com` for seamless
cross-app SSO (currently localStorage auth on the .vercel.app URL — sign in works, just not shared-cookie SSO).
**Remaining human actions:**
tier-3 migration apply sign-offs (#7/#8; hard guardrail = never apply unmanned) · G3 DPIA · G5 go-live ·
the arch decision above.

### ⚙️ UNMANNED RUN POLICY (operator standing authorization, 2026-07-08)

The operator has **pre-authorized this epic to run fully hands-off** and has recorded that
authorization here, in writing. Within this epic, this block **IS the "explicit human
sign-off"** the dev-loop hard-guardrails require — it is not a relaxation of the guardrails,
it is the sign-off, granted in advance, for a bounded scope. The loop therefore, **without
pausing**, may:

- **Commit, open PRs, and auto-merge** every PR whose merge-judge is AUTO-MERGEABLE **and**
  every PROTECTED PR once its automated proof gates are green (build, check-lint,
  check-hygiene, casual-regression where applicable, rpc-security-sweep, ephemeral-verify +
  leak-check 0, QA + adversarial-security reviewers clean, CI green). Proof gates are
  **non-negotiable and stay ON** — "unmanned" means self-*checking*, not un-checked.
- **Apply additive/dark migrations** (new tables / new SECURITY-DEFINER RPCs, matching
  `_down.sql`, EV-proven with rollback + leak-check 0, rpc-security clean) to the live DB, and
  land the `.sql` source in the same commit (HR#11). Re-derive the free migration number off
  `main` at apply time.
- **Deploy** to the new `platform-club-admin` Vercel project (preview + production) and run
  Playwright smoke, unattended.
- Write status back into this manifest and advance to the next PR on its own.

**The loop STOPS and hands back to the human ONLY at these three gates** (auto-approval cannot
*satisfy* them — it can only unsafely skip them, so they remain real stops):

1. **🚦 G3 — Real-kids DPIA / safeguarding legal gate** (PR #11 exposure + PR #12). The four
   `GO_LIVE_ISSUES.md` items are **DRAFTED for sign-off** in `CLUB_MANAGER_DPIA_AND_SAFEGUARDING_PACK.md`
   (DPIA · controller/processor record · Appropriate Policy Document · retention schedule). The
   operator initials Parts A–D, ticks the four `GO_LIVE_ISSUES.md` boxes, and records it in
   `DECISIONS.md` → gate clears. Until then the loop builds these surfaces **dark/demo-only** and
   does not expose real child special-category/DBS/flag data.
2. **G4 — Stripe live-key flip: OUT OF LOOP SCOPE (operator flips post-epic).** The loop builds
   everything against Stripe **test mode** and **completes without waiting** — it is not a mid-run
   stop. `vercel env add` / `gh secret` / `stripe` writes stay human-gated so the loop physically
   cannot flip them. The operator swaps live keys + own `whsec` into the new Vercel project after
   the epic is otherwise done.
3. **🚦 G5 — Real-club public go-live** (PR #12). The single remaining intent stop: after G3 is
   signed and the operator has flipped Stripe (G4), a human confirms intent to onboard a real club
   with real children's data to production + clears the App-Store companion review. The demo→live
   tenant swap happens here.

Everything else runs to green PRs on its own. `/hub`-touching PRs (#4, #7, #8) still **note**
the owed real-iPhone walk (HR#13) but do **not** block the loop — they proceed to merged PR and
the device walk is logged as owed, to be cleared before G5. Still hard-denied regardless of this
policy: pushing to `main` directly, force-push, reading `.env`, and touching the LetTrack project.

---

## WHAT IT IS (plain English)

A **dedicated, unified front-end** — `apps/clubmanager` (today a bare "coming soon" stub) —
so a grassroots football club is run from **ONE home** instead of today's split across the
venue-operator app (`apps/venue`, where club structure/memberships/fixtures live) and the
main app's `/hub` (where the guardian + coach mobile tracks live).

It is a **desktop-first web admin console** for the people who run a club (admin/owner,
welfare officer), **paired with the mobile companion that already exists natively inside
`apps/inorout /hub`** for the people on the move (coach, parent, adult player). The two
surfaces **share one data layer** (`@platform/core`) — they never fork logic.

**The headline reality: the backend is ~90% already built.** Club OS shipped across
migrations **286–309** (structure, sessions, attendance, comms, staff+DBS, merch),
**371–372** (identity spine + `get_my_world`), **389–393** (cohorts/teams, QR join,
membership-gated join, manager comms, pro-rated subs), **394–451** (club leagues +
grassroots fixtures, pitch-clash protection, public club page, FA ingest, fixture
availability), and **466–469** (safeguarding incident routing). This epic is therefore
**a new front-end over existing RPCs, plus a handful of genuine gaps** — not a backend
rebuild. That single fact shapes the whole roadmap: it is front-end-heavy, backend-light,
and — because it is a greenfield app that nothing live depends on — **almost every PR ships
CLEAR / dark**.

Roles served, each with the job they hire it for:
- **Club admin / owner** (desktop) — "run my whole club from one screen; never chase a
  spreadsheet, a WhatsApp group, or a missing DBS again." Wow = a Monday-morning **ops/
  compliance home**: "3 coaches missing DBS · 2 U12 fixtures clash on Pitch B Saturday ·
  4 unpaid subs" — each a one-click fix.
- **Team manager / coach** (phone, pitchside) — "know who's coming, pick my team, log the
  result, with cold thumbs and one bar." Wow = a **one-thumb matchday**: availability →
  suggested XI → tap score → tap POTM, done before the car.
- **Guardian / parent** (phone) — "tell the coach in/out in two taps; see my child's whole
  week in one place." Wow = the unified **"[child]'s week"** agenda (already built in
  `GuardianSchedule`).
- **Adult player** (phone) — the guardian flow minus the child proxy: **self-serve** in/out,
  no "message the manager." A thin new track.
- **Welfare / safeguarding officer** (desktop) — "see at a glance every adult around kids is
  cleared; be the obvious first contact." Wow = a **red/amber/green compliance board**. This
  role has no dedicated surface today — the clearest white-space.

---

## LOCKED DECISIONS (assumptions to confirm at the human review)

1. **Surface split (RECOMMENDED, confirm):** `apps/clubmanager` is the **desktop-first admin
   web console ONLY**. The **mobile companion = the EXISTING native `/hub` tracks in
   `apps/inorout`**, extended — NOT a second mobile app. Rationale: two mobile apps for the
   same users = split brand, split push, duplicate App-Store binary. The desktop console is
   web-only → **not under the App-Store review freeze**, so admin work is free to ship.
   *(Open question if the operator wants `/hub` folded INTO clubmanager instead.)*
2. **Auth model: auth.uid-first, single SSO, NO master token in the bundle.** Sign in once
   (Supabase auth, existing `*.in-or-out.com` cookie SSO); `get_my_world()` resolves the
   person's roles. **Club-admin writes reuse the EXISTING venue-token RPCs via
   `resolve_venue_caller` stage-1b** (pass `venue_id` as the credential; server verifies
   `auth.uid → venue_admins(status='active')`) — exactly as logged-in staff already do in
   `apps/venue`. **No third auth system, no `club_admin_*` RPC family unless decision (a)
   below forces it.** The dev/demo master token is NEVER shipped to the client (mirrors the
   `self_serve_create_venue` mig-484 posture).
   **⚠️ Multi-venue clubs (a club spans venues via `club_venues`, M:N):** the credential is an
   active `venue_admins` row for **ANY** of the club's `club_venues` (NOT a single "the club's
   venue"); **structural/scheduling writes that target a specific ground show a target-venue
   picker** — the platform already solved this exact ambiguity (DECISIONS.md:607/862/1106 venue
   picker; `_membership_covers_venue(club_id,venue_id)` FEATURES.md:191; the club-broadcast cron
   already derives `venue_id` from `club_venues`). PR #3 must wire the picker.
3. **"Club admin" == active `venue_admins` for one of the club's `club_venues`.** At club
   creation the admin is provisioned a `venue_admins` row (like `self_serve_create_venue`). A
   club owner who is *not* a venue operator is served by that provisioning, not by a new auth
   layer. *(This is the single biggest architectural fork — confirm at review.)*
9. **Inbound admin/welfare notification path (confirm the channel).** The Monday-morning ops/
   compliance wow is **pull-only** unless something summons the admin — and a web console has no
   push (push is native-only in `apps/inorout`; the only comms plumbing, `get_pending_club_
   broadcasts` cron, is OUTBOUND to members). Decision needed: an **email/digest nudge** reusing
   the broadcast cron, **or** route admin alerts to the admin's `/hub` push. Without it the
   compliance board is a screen nobody re-opens. (Folded into PR #5 comms + PR #10 board.)
10. **Adult-player experience = the full In-or-Out differentiator, not RSVP parity.** Self-serve
   in/out is table-stakes (Spond has it). The adult Sunday-league player's wow is getting **their
   own reliability / POTM / Gaffer inside the club** via the shared engine (PR #7) — which no club
   competitor offers.
4. **Teams split → BRIDGE WITH A SHARED ENGINE (do NOT unify tables).** Casual `teams`
   (anon/token, internal scrimmage, in-band `players.status`) and Club OS `club_teams`
   (authenticated `member_profiles`, external fixtures, out-of-band `club_fixture_availability`)
   stay **two storage models** — they are genuinely different domains and unifying would force
   one auth model onto the other (a compliance regression for youth). **Identity is already
   one** (`people`/`person_id` + `get_my_world`). The missing 20% is a **shared pure-compute
   engine layer** (`packages/core/engine/*` — balancer, rating, reliability) the codebase is
   one refactor away from. Club POTM/reliability/Smart-Teams/Gaffer reuse the *engines*, not
   the casual *tables*. (Full reasoning in SWEEP → reconciliation.)
5. **Design system: inherit `apps/inorout/src/theme/tokens.css`; treat `@platform/ui` as
   do-not-use.** `@platform/ui` is a stale contract-violating kit (Inter, raw hex). Borrow the
   **`apps/hq` desktop shell skeleton** (3-column layout, data-dense `.atable`, company
   switcher = club switcher) but **re-skin it against `tokens.css`** — Bebas Neue headings, DM
   Sans body, Phosphor `weight="thin"`, only `#60A0FF`/`#FF6060` hardcoded.
6. **White-label theming = per-tenant scoped CSS vars, zero `:root` mutation.** Reuse the
   public-page pattern (`themeVars(branding)` → scoped `--cp-*` on the shell container, tints
   via `color-mix()`, WCAG-legible ink via `onColour()`). PA Sports navy/gold is the reference
   tenant; brand colour flows only through accent/derived tints, type/icon system stays fixed.
7. **Real-kids DPIA / safeguarding is a HARD LEGAL GATE, not a code gate.** The safeguarding
   incident module + any surface exposing child special-category/DBS/flag data to a real youth
   club is **blocked** until the four `GO_LIVE_ISSUES.md` items (DPIA signed · controller/
   processor documented · Appropriate Policy Document · retention rule) are ticked. The app is
   built dark/demo until then. This is a human/DPO action `dev-loop` cannot satisfy.
8. **Matchday depth (line-ups + per-player stats) is the one real new-build.** Aggregate score
   + manager-picked POTM already exist; a picked XI and goals/assists/cards on `club_fixtures`
   do **not**. This is the biggest wow and the only substantial new backend — isolated to its
   own tier-3 PR.

---

## KEY AUDIT FACTS (load-bearing — don't re-derive)

- **Next free migration = 505.** Source tree maxes at `501_*`; **502/503/504 are applied-to-
  live but NOT yet in `rls_migrations/` source** (cloud-session drift, MEMORY). Re-confirm the
  free number off `main` before writing any SQL (first-come-on-main, CLAUDE.md cloud discipline).
- **`apps/clubmanager` is a 17-line stub** (`src/App.jsx` = "Coming soon"; `package.json` deps
  `@platform/core` + `@platform/ui`, dev port 5174). No router, auth, tokens, or `.vercel`.
- **⚠️ VERCEL NAMING TRAP (do not get this wrong):** the Vercel project literally named
  **`platform-clubmanager` deploys `apps/inorout`** (the LIVE consumer app) — a historic
  misnaming (`apps/inorout/.vercel/project.json`, `DOMAIN_MIGRATION.md:356/383-394`). A real
  Club Manager app **MUST get its own NEW Vercel project** (e.g. `platform-club-admin`) with
  `rootDirectory: apps/clubmanager`, its own SPA-rewrite `vercel.json` (clubmanager has none),
  and **its own Stripe env** (live keys currently live in `platform-clubmanager` = inorout).
  Reusing the name would repoint or starve the live consumer app.
- **The identity spine is the crown jewel: `get_my_world()`** (`packages/core/storage/
  supabase.js:6720`, migs 372/494) returns, in one call for the signed-in person:
  `player_fixtures{league,casual}`, `ref_assignments`, `club_memberships[]`, `guardian_of[]`
  (+ children's sessions), `admin_roles[]` (team_admin/venue_admin), `coaching[]`
  (club_team_managers), and playing-vs-reffing `conflicts[]`. Build ALL navigation off this
  role set, never a hard-coded single role. Already consumed by `apps/inorout` `nav.js:resolveRoles`.
- **State ownership is provably achievable:** `apps/venue/src/App.jsx` has **zero
  `supabase.rpc()` call sites** — pure `useState` containers, every mutation via a
  `@platform/core` wrapper. clubmanager replicates this; App.jsx state wrappers stay pure setters.
- **Reuse inventory — every job below already has reader + writer + JS wrapper (NO new backend):**
  club setup/branding (`get_club_public`/`club_set_page`/`club_publish_page`, migs 444–448) ·
  cohorts/teams (`club_list_cohorts`/`club_create_team` etc, 298/389) · people+guardians+invites
  (`member_get_self`/`member_list_children`/`club_team_join_context`/`member_join_club_team`,
  282/287/390/391) · DBS (`venue_upsert_staff_dbs`/`venue_list_club_staff`, 305) · recurring
  training + fixtures + **pitch-clash protection** (`club_manager_create_session_series`/
  `venue_upsert_club_fixture`/`get_pitch_occupancy`/bump-proposals, 302/394/414/416/417) · In/Out
  for training AND matches (`member_rsvp_session`/`guardian_set_fixture_availability`/
  `club_manager_list_team_fixtures`, 299/426/451) · memberships/tiers/pro-rating/pass/renewals
  (`get_venue_signup_tiers`/`member_enrol_membership`/`club_manager_team_payments`, 296/393/398 —
  **Stripe present but DORMANT/test-mode**) · comms (`club_send_announcement`/
  `club_manager_send_announcement` → `get_pending_club_broadcasts` cron, 307/392/434) ·
  safeguarding tighten + committee/welfare (`club_set_safeguarding`/`club_add_committee_member`,
  446/449) · incident safeguarding flag (466–469, venue-side).
- **GENUINE GAPS (the only net-new backend):**
  1. **Matchday line-ups / squad selection for `club_fixtures`** — no reader/writer. Availability
     exists; availability→picked XI does not. NEW writer (`club_manager_set_fixture_lineup`) +
     likely a `club_fixture_lineups` table (or a selection column).
  2. **Per-player match stats on grassroots fixtures** (goals/assists/cards/minutes) — the
     `match_events`/`player_match` engine binds to league/casual `fixtures`/`matches`, NOT
     `club_fixtures` (grassroots carry aggregate score only; `get_club_public` top-scorer is
     already `null` for this reason). NEW writer + table, OR a documented decision to route
     grassroots matches through the ref/casual engine (needs a ref-player→`member_profile` link).
  3. **Club-admin dashboard aggregate** — `get_my_world` gives `coaching[]`/`admin_roles[]` but no
     single "everything about club X as admin" roll-up. Compose **client-side from existing
     venue-token reads** to keep the dashboard PR dark/CLEAR; a roll-up RPC is an optional later
     optimization.
  4. **Shared club-compute readers** — reliability derivable from `club_fixture_availability` +
     `club_session_attendance`; Gaffer needs `gaffer_get_context_club_*` readers (foundation
     `resolve_agent_caller` mig 454 already carries `club_ids`).
- **The three write-auth classes a new write must route to correctly** (mixing them breaks the
  RLS wall): **(A) venue-token** `resolve_venue_caller` + `_venue_has_cap(...,'manage_memberships')`
  (club-admin structural writes); **(B) club-manager auth.uid** `auth.uid→member_profiles→
  club_team_managers(is_active)` + often `_club_feature_enabled(club_id,'public_web')` (coach
  writes); **(C) member/guardian auth.uid** + `member_guardians(invite_state='accepted')` gate
  (parent-on-behalf-of-child). Every write: SECURITY DEFINER, `search_path` pinned, single
  overload (DROP old on arg change), **REVOKE from named roles not just PUBLIC** (Supabase
  default-privileges footgun auto-grants anon), audit_events insert (Hard Rule #9, **flags not
  child PII**).
- **U18 safety — reuse the SERVER transform, never re-implement client-side:** age = `member_
  profiles.dob` (NULL ⇒ treated as minor, fail-safe); `get_club_public` (mig 445) renders minors
  as `first_name + surname-initial`, `photo_url` hard-NULL, `hide_public_rosters` ⇒ empty
  members[]. Never expose a minor surname/photo on any unauth surface; never let a non-guardian
  set a child's availability/join (server enforces, client must mirror); never log child PII to
  audit; `club_set_safeguarding` is **tightening-only** (`safeguarding_cannot_weaken`).
- **`SCHEMA.md` is known-stale** for `club_fixtures`/`club_leagues` column lists — confirm exact
  columns via the mig-394+ files or `Skills/scripts/check-db-schema.sh` before any new SQL. FA
  columns confirmed: `club_leagues.{fa_source_url,fa_embed_code,fa_last_synced_at}`,
  `club_fixtures.{source,fa_fixture_key,club_team_id,is_home,home_score,away_score,status,
  playing_area_id,official_id,ref_name,scheduled_date,kickoff_time,share_code,notes}`.
- **2026 competitive baseline (confirmed via WebSearch 2026-07 — Spond grassroots guide,
  FirstWhistle "best football apps 2026", 360Player Lineup docs, LoveAdmin grassroots buyers
  guide, FA "Safeguarding in the digital world", TeamFeePay; + repo `COMPETITORS.md`):** table-stakes = RSVP for training+
  matches, team messaging (In-or-Out is only *partial* — biggest parity gap), subs/fees
  collection, GDPR member DB with consent, safeguarding/DBS, fixtures/results, lineup/minutes,
  ratings/POTM. Differentiators = the availability→auto-open engine and the Gaffer AI (no
  competitor has either) + full-stack (team+venue+display+ref+league+tournament). **You cannot
  out-free Spond (1M+ UK MAUs on £0)** — win on depth + differentiator, not price.

---

## ROADMAP — PRs in dependency order

> Greenfield + dark-until-launch ⇒ most PRs are **CLEAR**. The only tier-3 gates are new
> migrations/RPCs, the real-kids DPIA/safeguarding go-live, Stripe live keys, and public launch.
> Each PR = one `/dev-loop` cycle. Gates cite the repo's deterministic scripts + the human 🚦 stops.

### PR #1 — App shell + auth + tenant theming + read-only dashboard   TIER-1 · CLEAR *(first dark slice)*
Stand up `apps/clubmanager`: Vite + **react-router** (a real multi-section console warrants a
router over the hand-rolled `getRoute()`); import `tokens.css` (do NOT build on `@platform/ui`);
Supabase SSO reuse (`cookieAuthStorage`); **auth.uid boot → `getMyWorld()` → role set**; per-tenant
theming via scoped `--cp-*` vars read from `club_pages` branding (PA Sports navy/gold reference).
Dashboard = **compose client-side from existing venue-token + auth.uid reads** (no roll-up RPC —
keeps it dark/CLEAR): compliance/this-week/money tiles, each with explicit **empty / loading /
error** states (a zero-DBS-issues board must render "all clear", not blank; a failed read shows a
retry pill — copy the `GuardianMatches.jsx` loading/error/empty card triad). Include a **role/hat
context switcher** (distinct from the club switcher — one person may be admin + parent + player;
resolved off `get_my_world()`). **Build the shell as a reusable multi-vertical operator-console
skeleton** (hq-shell reskin + spine nav + scoped theming) — it is the substrate for venue/league/
gym consoles too, not a clubmanager-only asset. **Own NEW Vercel project** (`platform-club-admin`,
NOT `platform-clubmanager`) + SPA-rewrite `vercel.json`.
- Gates: `node --check`, check-hygiene (see 🚦 hygiene-scope note), check-build, Playwright smoke
  (app boots, SSO resolves a demo club admin, dashboard renders seed data + empty-state on a clean
  club, role/club switchers work, 0 new console errors).
- Done: the console loads for a signed-in demo club admin, themed navy/gold, showing real seed data.

### PR #2 — Structure + people + roster read/manage views   TIER-1 · CLEAR
Left-rail IA (Home/People/Structure/Schedule/Memberships/Matchday/Comms/Club-page/Safeguarding),
**role-gated off the spine** (`admin_roles`/`coaching`/`guardian_of`/`club_memberships`) and off
`club_features` flags (three-layer gate: nav+route+RPC — never show a flag-off section). Reuse
`StructureTab`/`CohortModal`/`TeamModal`/`TeamInviteModal` (`clubEnsureTeamInviteLink`), `MembersTab`,
`club_manager_get_member_detail`, `venue_assign_team_manager`. Optimistic-UI + `saving`-guard + toast
triad on every write (copy `GuardianMatches.jsx`/`ClubSettingsScreen` patterns).
- Gates: `node --check`, check-hygiene, check-build, Playwright (create/edit/archive a team on demo,
  invite QR renders, member detail opens; 0 new errors).
- Done: an admin manages cohorts→teams→rosters→coaches end-to-end on the demo club.

### PR #3 — Schedule: recurring training + fixtures, clash-aware   TIER-1 · CLEAR
Surface `club_manager_create_session_series`/`club_create_session`, `venue_upsert_club_fixture`,
`get_pitch_occupancy`/`get_operator_pitch_occupancy`, and the **existing** bump-proposal flow
(`club_manager_list_bump_proposals`/`resolve_bump`). Clash protection already lives in the
pitch-occupancy triggers (`slot_unavailable`) — the UI surfaces + resolves conflicts, it does not
re-implement them. Multi-ground calendar view with the **target-venue picker** for a club that
spans `club_venues` (Decision 2) — a write must name which ground it books.
- Gates: `node --check`, check-hygiene, check-build, Playwright (create a recurring series + a
  fixture on demo, force a clash → `slot_unavailable` surfaced, bump proposal resolves; multi-venue
  picker selects the right ground).
- Done: an admin schedules training + fixtures across grounds with clashes caught.

### PR #4 — In/Out availability for training AND matches   TIER-1 · CLEAR
Wire the mobile companion side (extend `apps/inorout /hub`, NOT a new mobile app) + the desktop
read: adults for themselves (`member_rsvp_session`/`guardian_set_fixture_availability` with no
`p_for_profile_id`), guardians for kids (with the accepted-guardian gate), coach reads via
`club_manager_list_team_fixtures`. Build the coach `tonight` + `people` mobile tabs (currently
placeholders in `MobileShell`). Optimistic toggles; **offline-tolerance flagged** for pitchside.
- Gates: `node --check`, check-hygiene, **casual-regression** (touches `apps/inorout/src` — MANDATORY,
  additive-diff only), check-build, Playwright (guardian sets child availability; adult sets own;
  coach sees counts). ⛔ real-iPhone `/hub` walk owed (Hard Rule #13).
- Done: in/out works for training + matches, self + child, on phone and desktop read.

### PR #5 — Comms surface (announcements)   TIER-1 · CLEAR
Read `member_list_club_announcements`/`guardian_list_child_notices`; compose via
`club_send_announcement` (admin, venue-token) + `club_manager_send_announcement` (coach, auth.uid,
reaches players + accepted guardians). Unread badges (`guardian_mark_notice_read`). Also decide +
wire the **inbound admin/welfare notification channel** (Decision 9 — email digest via the existing
broadcast cron, or `/hub` push to admins) so the compliance/ops dashboard actually summons its owner.
**Two-way chat is explicitly OUT** (a separate, larger, safeguarding-heavy epic — see SWEEP/missed).
- Gates: `node --check`, check-hygiene, check-build, Playwright (admin + coach broadcast on demo,
  member feed shows it, unread badge clears; admin digest/nudge fires).
- Done: club-wide + team announcements send and surface; admin nudge live; chat deferred.

### PR #6 — Memberships & payments dashboard + in-app join   TIER-2 · PROTECTED *(Stripe test-mode)*
Read-only money first: `club_manager_team_payments` (paid/owes roster), `get_venue_signup_tiers`
(tiers + pro-rating). Then surface the **existing** membership-gated join (`member_join_club_team`,
`MembershipSignup`, pro-rating) in-app. **Stays Stripe TEST mode** until the money 🚦 gate — displaying
money ≠ moving money; degrade gracefully while live keys are off.
- Gates: `node --check`, check-hygiene, check-build, Playwright (payments roster renders; join flow
  reaches Stripe test checkout). 🚦 Stripe live-keys gate deferred to PR #11.
- Done: an admin sees who's paid/owes; a member can join+enrol against test Stripe.

### PR #7 — Shared-engine neutral-shape lift + club reliability / Smart-Teams / Gaffer   TIER-2 · CLEAR/PROTECTED
**Sequenced BEFORE matchday on purpose (SWEEP fix — PR #8 reuses this engine).** The decision-4
payoff, mostly a **JS refactor, not a migration**: lift `packages/core/engine/*` (balancer,
Bradley-Terry rating, reliability) to a documented **neutral input shape** (they're 90% there —
already storage-agnostic), feed them the club roster + a thin club `winRate`/turnout adapter derived
from `club_fixture_availability`+`club_session_attendance`. This produces the neutral squad/rating
API that PR #8's "availability→suggested XI" consumes — do it first. Add `gaffer_get_context_club_*`
reader RPCs (pointed at club tables; reuse the shared system prompt + `ai_briefings` audit —
GAFFER.md pattern; no new provider wiring). Record every shared reader's club consumers in RPCS.md
(HR#14). This is also the **adult-player wow** (Decision 10 — own reliability/POTM/Gaffer in-club).
- Gates: `node --check`, check-hygiene, casual-regression (engine refactor must be additive/
  byte-identical for casual — MANDATORY), check-build; rpc-security-sweep on the gaffer readers (T3
  slice only if a migration is needed). Playwright (club reliability board renders; Gaffer club panel).
- Done: club teams + adult players get POTM/reliability/Smart-Teams/Gaffer via the shared engines,
  casual unchanged; the neutral engine API is documented and ready for PR #8.

### PR #8 — Matchday depth: line-ups + per-player stats   TIER-3 · PROTECTED *(migration apply)*  🚦
The one substantial new backend; **depends on PR #7's neutral engine API.** Loop drafts `.sql`
(+`_down.sql`), **re-derives the free migration number off `main` at build time** (source 501 vs live
504 drift — 505 is an estimate), runs **ephemeral-verify** against live DB with rollback, then **STOPS
at the apply sign-off gate**. NEW `club_fixture_lineups` (or a selection payload) +
`club_manager_set_fixture_lineup` writer + per-player stat writer (goals/assists/cards/minutes) on
`club_fixtures`, OR the documented decision to route grassroots matches through the ref/casual
`match_events` engine (needs ref-player→`member_profile` link — decide at audit). Availability→
suggested XI **reuses PR #7's shared squad engine** (no longer a forward reference).
`get_club_public.stats` top-scorer un-nulled once stats land (respect the U18 transform).
- Gates: **rpc-security-sweep** (SECDEF, search_path, single overload, REVOKE named roles, audit),
  **ephemeral-verify** (`_e2e_` throwaway fixture, rollback, leak-check 0), check-build, Playwright
  (mocked lineup + stat entry). 🚦 **migration apply = human sign-off** (confirm the number off main first).
  ⛔ real-iPhone coach walk.
- Done: a coach picks an XI from availability, logs per-player stats, POTM; top-scorer board populates.

### PR #9 — Season rollover: cohort roll-forward + team archiving   TIER-2 · CLEAR
The annual grassroots must-have STRATEGY.md:309 flags as only "Partial": every summer a club promotes
each cohort a year (U11→U12), archives last season's teams (`club_teams.archived_at` already exists,
mig 389), and bulk re-registers. Distinct from the Stripe fixed-term **billing** season (mig ~405) —
this is the **club-structure roll-forward**. Likely a small `club_roll_season` writer (bump cohort
`min_age`/`max_age`/labels, archive old teams, carry rosters forward with a confirm step) + a review
UI. Confirm at audit whether an RPC is needed or it composes from existing cohort/team writers.
- Gates: `node --check`, check-hygiene, check-build; rpc-security-sweep + ephemeral-verify **only if**
  a new writer lands (else CLEAR). Playwright (roll a demo cohort forward, old teams archived, rosters
  carried). 🚦 migration apply only if a new RPC is introduced.
- Done: an admin rolls the whole club to the new season in one guided flow; last year archived, not lost.

### PR #10 — Public club page + white-label theming admin   TIER-1/2 · CLEAR
Reuse the modular club-page RPCs (444–451) + `ClubSettingsScreen` wizard/dashboard wholesale for the
admin edit surface; the public `/c/<slug>` renderer already exists. Prove multi-tenant via PA Sports
navy/gold. Crest upload = standard web `<input type=file>` → `club-media` bucket (no native camera).
- Gates: `node --check`, check-hygiene, check-build, Playwright (edit branding on demo → `/c/<slug>`
  reflects it; safeguarding transform intact for youth rosters).
- Done: an admin edits their branded public page; white-label proven on the reference tenant.

### PR #11 — Welfare / safeguarding compliance board + DBS surfacing   TIER-3 · PROTECTED  🚦
Welfare-officer red/amber/green board over `club_committee.is_welfare`, `club_staff_dbs`
(status/expiry), `club_set_safeguarding` (tighten-only), and the incident flag (466–469, respecting
the `is_safeguarding_flagged IS NOT TRUE` reader invariant + Lead-only audited reads). **Surfaces**
DBS status prominently; a **hard-block on assigning a non-`valid`-DBS coach to a youth cohort is a
product+legal decision** (currently unenforced) — draft it, do not auto-enforce. **This PR cannot go
live to a real youth club until the DPIA gate (🚦 below) clears** — built dark/demo only.
- Gates: check-hygiene, check-build, Playwright (demo compliance board renders R/A/G). 🚦 **DPIA/
  safeguarding legal go-live gate** blocks real-club exposure. ⛔ real-device walk.
- Done: welfare officer sees a clearance board on demo; real-club exposure blocked pending the gate.

### PR #12 — Go-live   TIER-3 · PROTECTED  🚦🚦
Real club onboarded; **DPIA + 3 companion items signed** (controller/processor doc · APD · retention);
**Stripe LIVE keys in the new Vercel project** (its own `whsec`); public launch; native `/hub`
companion changes cleared through the App-Store review. **Demo→live swap:** onboard the real club as
its OWN tenant (fresh `clubs`/`venue_admins` provisioning) — never repoint the demo/seed rows; the
seeded demo club stays a demo; leak-safety per HR#15 (no `_e2e_`/demo ids in the live tenant).
- Gates: prod-verify the merged surfaces on the new project; live rpc-security sweep; Stripe live
  smoke. 🚦 **all human/legal/Apple gates.**
- Done: a real grassroots club runs live on Club Manager with the compliance stack signed.

---

## 🚦 GATES THE LOOP MUST STOP AT (human / legal / migration / Stripe / Apple)

- **Hygiene-scope note (do first):** `apps/clubmanager/src` is **NOT** covered by the hygiene hook
  (only `apps/inorout/src` + `packages/core` are). The stub already drifts (Inter/`#F59E0B`). Extend
  `post-edit-hygiene.sh` / `check-hygiene.sh` scope to `apps/clubmanager/src` **before PR #1 build** —
  cheap insurance against design-system drift. *(Owner decision — touches the hook, own commit.)*
- **G1 — Vercel project creation:** a NEW project (`platform-club-admin` or similar), NOT
  `platform-clubmanager` (= live inorout). `rootDirectory: apps/clubmanager`. (Operator.)
- **G2 — Migration 505+ apply (PR #8, after EV passes):** new matchday tables/RPCs. **Re-derive the
  free number off `main` at build time** (source 501 vs live 504 drift). Human sign-off. *(PR #9 season
  rollover also hits this gate only if it introduces a new writer.)*
- **G3 — DPIA / safeguarding legal gate (PR #11/#12):** the four items are drafted in
  `CLUB_MANAGER_DPIA_AND_SAFEGUARDING_PACK.md` — operator initials Parts A–D, ticks the four
  `GO_LIVE_ISSUES.md` boxes, records in `DECISIONS.md`. Blocks real-youth-club exposure of child
  special-category/DBS/flag data until signed.
- **G4 — Stripe live keys: operator flips POST-EPIC, out of loop scope** (live keys + own `whsec` in
  the NEW project's env). The loop never waits here — it completes in test mode.
- **G5 — App-Store review (companion):** any `/hub`/`MobileShell`/auth/native change is under the
  binary freeze during Apple review; real-iPhone walks owed (Hard Rule #13) on every PR touching
  `apps/inorout/src` (PR #4, #7, #8).

## DONE =
`apps/clubmanager` is a live, white-label, desktop-first admin console (own Vercel project) that runs
a grassroots club end-to-end off the existing Club OS backend; the coach/parent/player companion is the
extended native `/hub`; the shared-engine bridge (PR #7) gives club teams + adult players POTM/
reliability/Smart-Teams/Gaffer with casual unchanged; matchday line-ups/stats (PR #8) are live; season
rollover (PR #9) works; and a real club is onboarded with the DPIA/safeguarding stack signed and Stripe
live (PR #12). Every tier-3 gate cleared by a human.

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

- **MISSED (the gaps between the lenses):** **(a) Two-way chat.** Announcements (PR #5) are cheap, but
  Spond's daily-habit hook is *two-way* team chat — a large, RLS-heavy, safeguarding-sensitive build
  (child-safe chat, guardian visibility). It is deliberately OUT of this epic; flag it loudly as the
  #1 follow-on so the estimate isn't blown by silent scope-creep. **(b) The reverse/undo & portability
  paths** no forward-flow lens designed: bulk member **import** (a club switching from Pitchero arrives
  with a spreadsheet — `CLIENT_ONBOARDING_IMPORT_HANDOFF.md` already scopes this for superadmin; the
  club-admin console is its natural home) and **export/GDPR data-portability** (a club leaving must get
  its data out — the mirror of import, and a DPIA expectation). **(c) The FA Matchday overlap:** FA
  Matchday is the *official* registration/results app affiliated English teams must use — decide
  integrate-vs-mirror-vs-ignore, or clubs run two systems. **(d) DBS-to-assignment enforcement** and
  **(e) guardian-erasure semantics** (a guardian self-deleting does NOT reach the child's profile;
  DBS cert numbers survive a scrubbed account) — both are unenforced today and are DPIA questions, not
  code defaults. **(f) Multi-venue club credential ambiguity** — RESOLVED into Decisions 2/3 + PR #3
  (credential = `venue_admins` for ANY `club_venues` row; target-venue picker). **(g) Season rollover**
  — RESOLVED into new PR #9 (annual cohort roll-forward + archive; STRATEGY.md:309 had it only
  "Partial"). **(h) No inbound notification path for the pull-only desktop console** — RESOLVED into
  Decision 9 + PR #5 (email digest via the broadcast cron, or `/hub` push to admins) — without it the
  compliance wow is a screen nobody re-opens. **(i) demo→live swap** — scoped in PR #12 (real club =
  its own tenant, never repoint demo/seed rows, HR#15 leak-safety).
- **OPPORTUNITY:** this app is the **substrate the deferred epics have been waiting for.**
  `SELF_SERVE_MULTI_VERTICAL_HANDOFF.md` PR5 ("club" self-serve track) is **blocked precisely on this
  app's compliance stack** — building Club Manager unblocks self-serve club onboarding. It is also the
  club-operator home that **Gaffer AI** (scope already carries `club_ids`), **`apps/league`** league
  management, and the live self-serve tournaments plug into. And it is the sales/demo centrepiece: one
  navy/gold PA Sports console that shows a whole club running end-to-end is a far stronger pitch than
  the scattered venue+hub surfaces. Strategically it converts a pile of shipped-but-siloed backend into
  a single sellable **Club/Org SKU** (market bears £/mo SaaS + ~1.5–2.5% + ~15–20p clip — Pitchero/Spond
  model; you cannot out-free Spond, so sell depth). Two extensions the sell should reflect: **(1) the
  PR #1 shell is a reusable multi-vertical operator-console substrate** — reskin it once and the future
  venue/league/gym consoles are nearly free, a bigger prize than one SKU; **(2) STRATEGY.md:116–122's
  sharper framing — the Club/Org wedge is ATTENDANCE, not admin.** The mobile attendance surface (PR #4
  / `/hub`) is the adoption/stickiness wedge; the admin console is the system-of-record it makes sticky.
  Reweight the launch story accordingly (and white-label theming opens reseller / county-FA / franchise).
- **FUTURE-PROOF (the one highest-leverage bet):** **build every screen's navigation and role
  resolution off `get_my_world()` from PR #1, never off a hard-coded club-only role.** One human
  legitimately holds many hats (club admin + parent of two + adult player + occasional ref) *across
  apps*. The spine already returns that whole role set in one call and already powers `/hub`. Wiring the
  new console to it (rather than a club-local identity model) is the single choice that keeps the app
  correct as roles multiply, makes the desktop↔`/hub` parity free (same data layer), and lets every
  future vertical/role slot in additively. Cost now ≈ one resolver call; cost of getting it wrong ≈ a
  forked identity model to unpick later. **Co-equal second substrate bet:** the neutral-shape
  shared-compute-engine lift (Decision 4 / PR #7) — and it must be **sequenced before any feature PR
  that reuses it** (fixed: PR #7 now precedes matchday PR #8). The two substrate bets together —
  `get_my_world()` nav + the engine neutral-shape lift — are what make every later feature additive.
- **WOW (per audience):** **Admin** — the Monday ops/compliance home (DBS + clashes + unpaid, each
  one-click). **Coach** — one-thumb pitchside matchday (availability→XI→score→POTM before the car).
  **Guardian** — "[child]'s week" in one screen, in/out on every item (already built — surface it).
  **Adult player** — NOT the RSVP-parity Spond already has, but **their own reliability / POTM / Gaffer
  inside the club** via the shared engine (PR #7) — the full In-or-Out differentiator no club competitor
  offers. **Welfare officer** — a role with *no* surface today gets a red/amber/green clearance board =
  the clearest differentiated white-space (its wow is real only once the admin/welfare notification
  channel of Decision 9 summons them — the two findings are the same).
  The cross-audience wow that no competitor can touch: **availability confirmed by a parent on a phone
  auto-opens the coach's team sheet and feeds the Gaffer's balance suggestion** — the auto-open engine +
  AI, end to end, which Spond/Pitchero/360Player structurally cannot do.

## Related
- `CLUB_STRUCTURE_HANDOFF.md` + `project_club_structure_epic` — migs 389–393 (structure/join/comms/subs).
- `MODULAR_PLATFORM_HANDOFF.md` + `project_modular_platform` — migs 394–451 (club pages, fixtures,
  availability, FA ingest, clash protection).
- `SAFEGUARDING_MODULE_HANDOFF.md` + `GO_LIVE_ISSUES.md` — the DPIA hard gate + incident routing (466–469).
- `SELF_SERVE_MULTI_VERTICAL_HANDOFF.md` — PR5 club track this epic unblocks.
- `CLIENT_ONBOARDING_IMPORT_HANDOFF.md` — the bulk-import path (MISSED-b) whose natural home is this console.
- `GAFFER.md` — the AI layer (`resolve_agent_caller` mig 454 already scopes `club_ids`).
- `get_my_world()` (`packages/core/storage/supabase.js:6720`) — the identity spine everything routes off.
- `STRATEGY.md:104–122/309` — Club/Org SKU + "attendance is the wedge" + "season setup" = Partial.

---
*Trigger:* `/loop /dev-loop CLUB_MANAGER_APP_HANDOFF.md`
