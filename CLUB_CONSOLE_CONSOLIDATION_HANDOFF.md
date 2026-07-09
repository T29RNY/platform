# Club Console Consolidation — Epic Manifest

*Scoped 2026-07-09. Design + audit only — no code yet.*
*Runs as an epic loop: `/loop /dev-loop CLUB_CONSOLE_CONSOLIDATION_HANDOFF.md`.*
*Each `### PR #n` = one dev-loop cycle → one PR.*

**Merge mode: auto** · **Plan gate: batched**

### ⚙️ UNMANNED RUN POLICY (operator standing authorization, 2026-07-09)
Operator granted **FULL AUTO (option a)**. Within this bounded epic, this block **IS** the "explicit
human sign-off" the dev-loop guardrails require. The loop may, without pausing:
- **Commit, open PRs, and AUTO-MERGE** every PR once its proof gates are green (`node --check`,
  check-lint, check-hygiene, casual-regression where `apps/inorout` is touched, rpc-security-sweep,
  ephemeral-verify + leak-check 0, QA + adversarial-security reviewers clean, CI green). **Proof gates
  stay ON** — "unmanned" means self-*checking*, not un-checked.
- **APPLY additive/dark migrations** (new tables / SECURITY-DEFINER RPCs, matching `_down.sql`,
  EV-proven rollback + leak-0, rpc-security clean) to the live DB; land `.sql` same commit (HR#11);
  re-derive the free number off `main` at apply time.
- **Provision the venueless-club home-venue shell incl. the `venue_admins` OWNER row** (PR #4).
- **Repoint the `platform-club-admin` Vercel project** → venue console (PR #5).
- Advance PR→PR on its own and write status back into this manifest.

**OPERATOR WAIVERS (2026-07-09, this epic only):**
- **HR#13 (real-iPhone native walk) is WAIVED** — the native `/hub` PRs (#6/#6b) proceed to merged PR
  **without** a device walk. Risk acknowledged: native "tap-does-nothing"-class bugs won't be
  device-verified pre-merge; covered instead by casual-regression + Playwright web smoke.
- **G4 Stripe live keys deferred to the END** (operator flips post-epic); loop builds in Stripe test
  mode and never waits on it.

**Still hard-DENIED regardless of this policy:** pushing `main` directly, force-push, reading `.env`,
touching the LetTrack project, and `vercel env add` / `gh secret` / `stripe` live-key writes (money).

### 🔒 NO-FUNCTIONALITY-STRIP GUARANTEE (operator-required 2026-07-09)
The club lens **REUSES the existing `apps/venue` view components wholesale** — it is a regroup + scope,
never a re-implementation. This is the explicit correction of the clubmanager failure mode (a separate
app that built thin screens and deferred the hard parts). **Hard rule for every lens PR:** import and
render the SAME component that venue mode uses (Members→`MembersView`, Memberships→`MembershipsView`,
Sessions→`SessionsView`, Teams→`TeamsView`/`ClubTeamsTab`, Staff→`StaffView`, Safeguarding→
`SafeguardingPanel`, Features→`FeaturesView`, Integrations→`IntegrationsView`, QR→`InvitesView`) — never
a reduced clone. **Parity gate (added to every lens PR's done-check):** each function reachable for a
club in venue mode today must be reachable in the club lens; a PR that would remove or thin a capability
FAILS the gate. Anything genuinely venue-facility-only (Bookings management, Trainers, Equipment/Rooms)
stays in venue mode — one switch away, not removed from the product.

> **This manifest SUPERSEDES `CLUB_MANAGER_APP_HANDOFF.md`.** That epic built a *second* console
> (`apps/clubmanager`, 11 PRs merged, live at `platform-club-admin.vercel.app`) that **duplicated
> the venue app**: all 31 of its `@platform/core` wrappers already exist and are **venue-token**
> (the exact auth `apps/venue` uses), and every one of its screens already has a venue equivalent.
> This rescope **consolidates club management onto the ONE existing operator console (`apps/venue`)
> and retires `apps/clubmanager`.** The already-built matchday/reliability backend (migs 515–517)
> and the coach `/hub` mobile screens are KEPT untouched — they are correct and orthogonal.

---

## WHAT IT IS (plain English)

Today a grassroots club is run across **two operator consoles that do the same job**:
- **`apps/venue`** (the real, shipped operator console) — already surfaces clubs pervasively:
  per-club feature flags, cohorts, club teams, club training sessions + attendance, club-league
  fixtures, coaches + DBS, club billing, club safeguarding incidents, club announcements. Clubs
  are woven through its five nav groups, gated by `club_features`.
- **`apps/clubmanager`** (the newer, redundant console) — a club-first reskin of the *same*
  venue-token RPCs, plus a handful of genuinely-nice club-first surfaces (a Monday-morning
  compliance dashboard, a welfare R/A/G board, a public club-page editor, a structure org-chart
  with season rollover, an announcements composer) and one genuinely reusable asset: **per-tenant
  white-label theming** (scoped `--cp-*` CSS vars, PA Sports navy/gold).

This epic makes `apps/venue` the **single operator console** with a proper **club lens** —
pick a club and the console reframes around it (club-first home + club-scoped People/Structure/
Schedule/Memberships/Comms/Page/Safeguarding), while the venue-operator default is byte-identical
to today. The four or five club-first surfaces that only `clubmanager` had are **ported** into that
lens (small — most already exist in venue). `apps/clubmanager` is then **retired**. Separately, the
**adult-player self-serve `/hub` track (#7c)** — the one real mobile gap — is filled: the write path
already works (`memberRsvpSession`/`guardianSetFixtureAvailability` accept a null `forProfileId` =
self) and the self readers already exist; what's missing is a mobile track + screens.

Roles served (each with the job it hires the console for):
- **Club admin / owner** (desktop) — "run my whole club from one screen." Wow = a club-first
  **Monday-morning ops/compliance home** (DBS gaps · fixture clashes · unpaid subs), each one-click.
- **Welfare / safeguarding officer** (desktop) — "see at a glance every adult around kids is
  cleared." Wow = a red/amber/green DBS board — a role with no dedicated venue surface today.
- **Venue operator** (desktop) — unchanged; the club lens is additive, off by default.
- **Adult club player** (phone, `/hub`) — "in/out for my own club training + matches, and my own
  reliability/POTM — without messaging the manager." Wow = the full In-or-Out differentiator, self-
  serve, that no club competitor offers.

---

## LOCKED DECISIONS (assumptions to confirm at the human review)

1. **DECISION (1) — ONE nav with a club LENS, not separate venue/club sections (RECOMMENDED).**
   `apps/venue` already interleaves club items into its five groups (RUN/PEOPLE/PROGRAMMES/
   COMPETITION/CLUB&ADMIN), gated by `club_features` — there is *no* separate club section today,
   and a parallel section tree is exactly the duplication we're removing. The "club lens" is a
   **topbar club switcher + a club-scoped context**: select a club → a club-first **Home**
   dashboard renders and the existing club-touching views (Members, Memberships/cohorts/teams,
   Sessions, Staff/DBS, Safeguarding, Comms, Club-page) scope to that club. Venue-operator mode
   (no club selected) stays the default and byte-identical. The nav stays the single hardcoded
   `TABS` rail; the lens is a filter over it, never a fork. *(Confirm: are you happy the club lens
   is a scoping filter + a club Home view, rather than a distinct nav mode?)*
   **State-ownership spec (the riskiest integration seam — pin at audit):** `clubContext` is a NEW
   piece of state that lives in `App.jsx` **next to** `selectedVenueId` (NOT inside Dashboard's
   `view` string), because it must survive view changes and feed the RPC credential decision.
   `selectedVenueId` stays the RPC credential (`App.jsx:38`) — `clubContext` is a **narrowing filter
   passed as a prop** into the club-touching views, never a second credential. Selecting a club that
   spans multiple `club_venues` keeps the current `selectedVenueId` unless the club isn't at it (then
   prompt the target-venue picker, reusing the Decision-2 pattern). Switching clubs or clearing the
   lens resets the club-scoped views to their unscoped default (no cross-club state bleed). Because
   venue routing is URL-less (`Dashboard.jsx` reads query params only at mount), lens state is
   **not deep-linkable and is lost on refresh** — add **minimal query-param sync for the selected
   club** in PR #1 (survives refresh, makes club home / club-page bookmarkable) but do not convert the
   router. **Refinement (SWEEP future-proof lever — same cost, bigger payoff): build the switcher as a
   GENERIC entity-typed tenant/hat lens off `resolveHats(get_my_world())`**, promoting
   `apps/clubmanager/src/lib/roles.js` (which already turns the `get_my_world` payload into a ranked
   multi-hat set) rather than a club-only switcher off `venueWhoami`. Iterating `world.admin_roles[]`
   by entity type means future gym/league consoles + the welfare-officer-only hat light up with zero
   new plumbing — PR #1 already wires `getMyWorld()`, so this is a generalization, not extra scope.
2. **DECISION (2) — per-tenant white-label theming = scoped `--cp-*` vars over VENUE's base tokens,
   zero `:root` mutation (RECOMMENDED).** Port `clubmanager`'s `themeVars(branding)` → scoped
   `--cp-*` on the console container + `color-mix()`-derived tints + WCAG-legible `onColour()` ink
   (it is already a verbatim copy of the inorout public-page pattern). **Seed it from `apps/venue`'s
   OWN token set** (Manrope, amber `--accent #FFC83A`) — do NOT reskin Venue OS to the inorout
   Bebas/gold system. White-label flows only through **accent + derived tints when a club lens is
   active**, sourced from `club_pages` branding (PA Sports navy/gold = reference tenant); type,
   density and the venue chrome stay fixed. Venue has NO white-label today (dark-only single
   `:root`) so this is net-new but mechanically cheap and low-risk (container-scoped, no `:root`
   change → venue-operator view unaffected).
3. **DECISION (3) — club-with-no-venue: pin every club to a HOME-VENUE SHELL; do NOT fork auth
   (RECOMMENDED).** The console is **venue-keyed by construction**: `venueWhoami` returns venues
   only, every club RPC takes `venueToken`/`venue_id`, and club-admin auth (mig 286) *requires* a
   `venue_admins` row for a venue. A club with zero `club_venues` is **unreachable** — there is no
   club-only credential, whoami, or entry point. Two ways to close it: **(a)** provision a
   lightweight "home venue" shell (a `venues` row + `venue_admins` owner row) at club creation —
   exactly what `self_serve_create_venue` (mig 484) already does — so a club that runs no physical
   facility is still addressable and the console opens on its shell venue with the club lens active;
   **(b)** build a parallel club-token / club-whoami / `club_admin_*` auth family. **(a) is
   recommended** — it reuses the entire venue spine, needs at most one small `self_serve_create_club`
   writer, and unblocks `SELF_SERVE_MULTI_VERTICAL` PR5 (club self-serve). **(b) reopens the exact
   auth fork this rescope closes** and is rejected. *(Confirm: OK that "venueless club" = "club whose
   home venue is an admin shell," not a new auth system?)*
4. **DECISION (4) — adult-player `/hub` track (#7c) reuses the existing self-path; it is additive
   front-end + at most one self reader RPC.** The availability WRITES already work self-side
   (`memberRsvpSession`/`guardianSetFixtureAvailability` with null `forProfileId`); the self READERS
   already exist (`member_list_club_fixtures`, `member_list_upcoming_sessions`, `member_get_self`,
   `member_list_club_announcements`). Missing: (i) a `member` track in `nav.js:resolveRoles`/`tabsFor`
   (derive off `world.club_memberships` — `clubmanager/roles.js` already derives a `player` hat from
   it — deduped against anyone already covered as guardian/coach), (ii) a `MobileShell` branch, (iii)
   member screens (reuse the Guardian screens with a self `forProfileId`), (iv) a self reliability/POTM
   reader (new reader OR a self-scoped variant of the coach `club_manager_get_team_ratings_table`).
5. **KEEP migs 515–517 + the coach `/hub` screens as-is.** Matchday line-ups/stats (516), club team
   ratings (517), venue club-page writes (515), and the coach screens `TeamManagerTonight/League/
   People/Squad/Matchday` are correct and orthogonal to this consolidation. Do NOT touch them; the
   club lens *reuses* their readers (e.g. the ClubPage editor uses the mig-515 `venue_set_club_page`
   twins already wired for the retired console).
6. **Retire `apps/clubmanager` LAST, only once venue has parity.** Removing the app + retiring/
   repointing its `platform-club-admin` Vercel project is the final PR, gated on the club lens +
   ported surfaces being live, so no club-admin capability is lost in the gap.
7. **U18 / DBS / DPIA safety is already solved server-side — reuse, never re-implement.** The
   consolidation exposes no *new* child data: the club lens surfaces the SAME venue-token readers
   (`venue_list_members`, `venue_list_club_staff`, `get_club_public`'s server-side U18 transform,
   the Lead-only audited safeguarding reads). No new DPIA gate is opened by moving these screens
   between consoles. The one place to re-check: the adult-player `/hub` self reader must be
   self-scoped only (no cross-member leakage) — rpc-security + EV cover it.
8. **DECISION (8) — modularity is already built; the club lens MUST honour it, never bypass it.**
   Per-venue AND per-club feature toggling is shipped and mature: `FeaturesView.jsx` flips
   `venue_features` (bookings/spaces/room_hire/equipment) + `club_features` (memberships/competition/
   club_leagues/coaching/tournaments/public_web) via per-flag + bulk-preset RPCs (mig 399/400/402),
   with a server-enforced dependency graph, a discipline-relevance declutter axis, default-all-on, and
   a **3-layer gate (nav → route → RPC)**. The club lens is a *fourth* consumer of this gate, not an
   exception to it: every item the lens shows gates on that club's `club_features` exactly as the venue
   rail does, and **`FeaturesView` is surfaced per-club inside the lens** (it already renders a section
   per club — `settings.clubs[]`) so an operator turns a club's modules on/off from the same place.
   White-label theming (Decision 2) and the lens grouping (Decision 9) never override a flag-off
   section. *(No new work beyond wiring the lens nav through the existing gate — but it's load-bearing,
   so it's a locked decision, not an assumption.)*
9. **DECISION (9) — add a CLUB-AWARE rail grouping when the lens is active (the menu-logic fix).**
   Today's five groups (Run/People/Programmes/Competition/Club&admin) are a **venue-operator IA** with
   club items *scattered across all five* (Members/Memberships in People, Club teams as a Teams sub,
   Team Training in Programmes, Club Leagues/Tournaments in Competition, Features/QR in Club&admin). For
   someone focused on a club that is not logical. When a club lens is active, re-group the rail around
   the club — e.g. **Club Home · People & Structure · Schedule & Calendar · Membership & Money · Comms
   & Public page · Compliance · Settings (Features)** — each item still gated on `club_features`
   (Decision 8), reusing the SAME view components (a regroup/reorder, not new screens, exactly like the
   session-178 venue regroup that kept ids stable for deep links). With no lens, the venue rail is
   byte-identical to today. *(Confirm the club group set; it's a rename/reorder over existing ids.)*
   **⚠️ EXPLICIT SCOPE BOUNDARY (operator-confirmed 2026-07-09):** this does NOT touch or replace the
   existing venue rail — that rail is well-built and stays exactly as-is. The club grouping is a
   SEPARATE, ADDITIVE rail definition shown ONLY when a club lens is active; venue-operator mode keeps
   the current five groups (Run/People/Programmes/Competition/Club&admin) unchanged. Two pre-existing
   cosmetic nits in the venue rail — "Programmes" spans 4 flags (mixes coaching *activities* with
   equipment/rooms *facility resources*) and "Club & admin" is really *Settings* (QR/Features/Access/
   Integrations are console settings, not club items) — are **out of this epic's scope** and captured
   separately as IA polish (a rename + small regroup, ids stable for deep-links); do not fold them in.
10. **DECISION (10) — desktop owns SETUP + depth; mobile `/hub` carries the CRITICAL day-to-day for
    EVERY operator/admin/coach role (operator-confirmed 2026-07-09).** The division of labour: the
    desktop console (`apps/venue`) is the system-of-record — create cohorts/tiers, toggle modules,
    connect Stripe, season setup, branded public page, bulk billing (big-screen, dense). The native
    mobile `/hub` (`apps/inorout`) is where the **time-critical actions** happen on the move — approve
    a join, nudge an expired DBS, resolve a fixture clash, send an announcement, pick the XI, log the
    result, mark in/out. **Most of this already exists:** `/hub` ships an operator track
    (`OperationsTonight`/`OperatorBookings`/`OperatorPayments`/`OperatorPeople`/`OperatorSetup`/
    `OperatorTournaments`) and a coach track (`TeamManager*`, migs 516/517). **The gap is a club-admin
    track** — a club admin signs in as a venue-admin and today lands on the *venue-flavoured* operator
    track, with no club-admin critical-actions surface (the phone twin of the desktop club lens). That
    gap is closed by PR #6b. All `/hub` work is **native → App-Store-gated** — it ships within the
    binary-freeze discipline (real-iPhone walk HR#13, casual-regression mandatory), unlike the
    free-to-ship desktop console.

---

## RAIL-ITEM DISPOSITION UNDER THE CLUB LENS (every current item accounted for)

Nothing is dropped. Each existing `apps/venue` rail item is either **club-scoped** (shown in the lens,
filtered to the club), **venue-only** (a facility/operator concern — stays in venue mode, hidden or
read-only in club focus), or **shared-admin** (shown in both). All gated on `club_features`/
`venue_features` per Decision 8.

| Rail item (group) | Under the club lens | Notes |
|---|---|---|
| Set up venue (Run) | **shared** → "Club setup" | Club setup = page/branding/features/committee; venue-facility setup (hours/pitches) stays venue-only. A shell-venue club (PR #4) has minimal facility setup. |
| Operations (Run) | **club-scoped** → folded into Club **Home** | The venue "tonight" glance becomes the club Home (PR #1b); club safeguarding items surface in Compliance. |
| Bookings (Run) | **venue-only** (read via calendar) | Facility booking management is an operator job; the club sees its slots on the shared calendar, doesn't manage venue bookings. |
| Payments (Run) | **club-scoped** → Membership & Money | Already bills club cohorts; lens filters to the club's charges/subs. |
| Members · Memberships (People) | **club-scoped** | `memberships` flag; the core club money/roster surface. |
| Teams (People) | **club-scoped** (Club-teams tab) | League/Casual tabs stay venue-only; the lens shows the Club-teams tab. |
| Staff (People) | **club-scoped** (Coaches & DBS) | Venue staff/officials tab stays venue-only; lens shows club coaches + DBS. |
| Timetable: Classes · Team Training (Programmes) | **club-scoped** (Team Training) | `coaching` flag; club training on the shared calendar. Classes are venue/PT — venue-only. |
| Trainers (Programmes) | **venue-only** | PT/1-on-1 is a venue facility concept; clubs use coaches, not trainers. |
| Equipment · Rooms · Spaces · Room hire (Programmes) | **venue-only** | Facility resources. (Club room-hire = the deferred `resource_occupancy` club-lane decision.) |
| Club Leagues (Competition) | **club-scoped** | `club_leagues` flag; the club's external fixtures + matchday. |
| Internal League · Standings (Competition) | **club-scoped if the club runs one** | `competition` flag; a club's own internal league. Venue/league-mode use stays venue. |
| Cups · Tournaments (Competition) | **club-scoped** (club-owned) | `tournaments` flag; a tournament is club- OR venue-owned (DECISIONS.md:132) — lens shows the club's. |
| **QR codes / Invites (Club&admin)** | **shared-admin** | Add club-team join QR (`clubEnsureTeamInviteLink`) under the lens (PR #2e). Venue-landing QR stays venue. |
| **Features (Club&admin)** | **club-scoped** (per-club panel) | The modularity control panel — Decision 8; lens shows the selected club's flags. |
| **Access (Club&admin, `manage_logins`)** | **shared-admin, venue-keyed** | Console LOGIN management stays venue-admin (auth is `venue_admins`, Decision 3) — a club does NOT get a separate login system. BUT the lens surfaces **club committee + welfare-officer roles** (`club_committee`/`is_welfare`) in People/Compliance as club "who's who" (distinct from console logins). Confirm at audit. |
| **Integrations (Club&admin)** | **shared-admin** → the club's payment/other connects | Stripe/GoCardless connect lives here; a standalone club connects its OWN Stripe at its (shell-)venue's Integrations — this is the CLUB_MANAGER **G4 Stripe live-keys** gate. FA-ingest/other club integrations also belong here. |
| Reception display (footer) | **venue-only today** | Club-branded display = opt-in PR #7 (net-new). |
| Season setup (footer) | **club-scoped** | Complements PR #2's club Season Rollover (structure roll-forward vs billing season). |
| Switch venue (footer) | **generalized** → the tenant switcher | Becomes the venue+club tenant switcher (Decision 1 future-proof lever). |

## KEY AUDIT FACTS (load-bearing — don't re-derive)

- **Next free migration = 518** (source tree maxes at `517_*`). Re-confirm off `main` at build time
  (first-come-on-main, cloud-session drift — CLAUDE.md discipline).
- **`apps/venue` IS the consolidated console already.** Nav = hardcoded `TABS` in
  `apps/venue/src/views/Dashboard.jsx:43-102`, rendered by `Rail` (`:382-455`), five groups, gated
  by `featureOn(features, flag)` (mig 399, fails **open**) × `itemDisciplineRelevant` (fails open).
  Routing is **hand-rolled** (single `view` string, `Dashboard.jsx:169-173`; `VIEW_ALIAS` at `:129`),
  NOT a router. **No URL updates on nav.**
- **Auth is venue-keyed** (`apps/venue/src/App.jsx:26-47`): dual-mode — URL backdoor
  `venue_admin_token` (`?token=`/`/venue/:token`) OR Supabase Auth → `venueClaimMemberships()` →
  `venueWhoami()` returns `who.venues[]`. **The credential passed to every RPC is
  `urlToken || selectedVenueId` (`App.jsx:38`)** — every RPC venue-scoped by construction. **There is
  no club-only auth path and no way to open the console for a venueless club** (`club_not_in_venue`
  enforces linkage, `FeaturesView.jsx:70`; "Club features appear here once a club operates at this
  venue," `FeaturesView.jsx:234`).
- **Clubs already surfaced across venue views** (the club lens *filters* these, doesn't build them):
  FeaturesView (per-club `club_features`), MembershipsView (cohorts/club teams/grading/**club
  announcements via `clubSendAnnouncement`**), TeamsView→ClubTeamsTab (`venueListClubTeams`),
  SessionsView (fully club-scoped: `venueListClubs`→`clubListCohorts`→`clubListSessions`→
  `clubMarkAttendance`), StaffView→Coaches&DBS, SafeguardingPanel (Lead-only incidents),
  PaymentsView (club billing cohorts). Multi-venue clubs already handled
  (`venueListClubVenues(token, clubId)` — same-operator `company_id` seam).
- **Venue theming today: dark-only single `:root`, own token set** (`apps/venue/src/styles.css:7-69`
  — Manrope, `--accent #FFC83A`; does NOT import inorout `tokens.css`; `[data-theme]` variants
  explicitly stripped). NO white-label. (SetupHub collects `logo_url`/`primary_colour`/
  `secondary_colour` but those feed public surfaces, not console CSS — `SetupHub.jsx:47-49`.)
- **`apps/clubmanager` migration surface is SMALL — 31 `@platform/core` wrappers, all pre-existing,
  30/31 venue-token** (only `clubManagerTeamPayments` is coach `auth.uid`). So consolidation = porting
  VIEWS + the theming trio, **not** rebuilding any backend. Screen→venue-equivalent map:
  Dashboard→(new club Home, compose from existing reads) · People→MembersView+StaffView · Structure→
  MembershipsView cohorts/teams + **new org-chart+SeasonRollover** · Schedule→SessionsView+Bookings+
  FixtureActions · Memberships→MembershipsView · Comms→MembershipsView has `clubSendAnnouncement`,
  needs a **compose surface** · ClubPage→**new editor** over mig-515 `venue_set_club_page` twins ·
  Safeguarding→SafeguardingPanel is incident-only, needs the **DBS R/A/G welfare board**.
- **The reusable asset to salvage: the white-label theming trio** —
  `apps/clubmanager/src/lib/theme.js` (`themeVars`/`onColour`, verbatim copy of inorout's
  `clubPublicHelpers.js`) + `theme/console.css` (`--cp-*` + `color-mix()` tints, zero literals). Ports
  cleanly onto a scoped container; must be seeded from venue's tokens not inorout's.
- **#7c backend already ~90% there:** self writes done (`supabase.js:6413`/`6444`, null `forProfileId`
  = self); self readers `member_list_club_fixtures` (`:6327`), `member_list_upcoming_sessions`
  (`:6316`), `member_get_self` (`:5746`) exist. `nav.js:12-14` **excludes** the member/player track on
  purpose today; `MobileShell` has no member branch (fall-through placeholder `:368-377`). The only
  possibly-new backend is a **self reliability/POTM reader**.
- **The calendar/occupancy IS the shared spine — the club schedule is a LENS on it, not a parallel
  store.** One hard-clash ledger `pitch_occupancy` (GiST EXCLUDE, mig 133) + a sibling
  `resource_occupancy` (rooms/trainers, mig 424). **Club training + club-league fixtures already
  reserve slots in the SAME `pitch_occupancy`** (`source_kind IN ('club_session','club_fixture')`, mig
  414 triggers) with the full reserved-window/bump-priority layer (mig 417) and cross-venue reads
  (`get_operator_pitch_occupancy`/`get_venue_resource_occupancy`, already wired in `BookingsView.jsx`).
  The club schedule view **filters that reader** — never a second calendar. **Gap (decide only if in
  scope): `resource_occupancy` has no club `source_kind`** — a club booking indoor rooms/courts
  (gym/boxing) would need a club lane; out of scope unless club room-hire is wanted.
- **QR: the club-team join primitive already exists — just not surfaced in venue.**
  `clubEnsureTeamInviteLink` → `club_ensure_team_invite_link` (mig 390, get-or-create `/q/<code>`
  `join_club_team`) is in `@platform/core` but `InvitesView.jsx` only renders `venueEnsureInviteLink`
  team codes. Wiring club-team QR cards into InvitesView under the lens = a small UI add, **no new
  backend**. (The `/c/<slug>` public page + get-involved links already cover public club QR.)
- **Public pages: `/c/<slug>` is first-class; `club_pages` branding is the SINGLE tenant brand record**
  driving the public page (`get_club_public`, U18 transforms, mig 445) AND — per Decision 2 — the
  console white-label. Known limitation (not a build): external club-league fixtures are free-text, so
  there is no public league *table* beyond the club page's fixture list.
- **Reception display (`apps/display`) is NOT club-aware (net-new if wanted).** `get_display_state`
  reads `public.fixtures` + venue bookings only; `club_fixtures`/`club_sessions` never reach it, and
  display theming uses its own `display_config`, not `club_pages`. A club-branded reception view =
  net-new backend (extend `get_display_state` + brand from `club_pages`). **Explicit in/out decision.**
- **Ref app (`apps/ref`) — club fixtures can ASSIGN an official but can't be OFFICIATED.**
  `club_fixtures.official_id`/`ref_name` are settable (`venue_upsert_club_fixture`), but every ref-token
  state path (`get_fixture_state_by_ref_token`, `get_my_next_assignment`) reads `public.fixtures` only —
  zero `club_fixtures` references. Live-officiating a club-league fixture = net-new backend (a
  `club_fixtures` ref-token state RPC + include club assignments in the assignment reader). **Explicit
  in/out decision.**
- **The three write-auth classes (mixing them breaks the RLS wall):** (A) **venue-token**
  `resolve_venue_caller` + `_venue_has_cap(...)` (all club-admin console writes — the default here);
  (B) **club-manager `auth.uid`** `club_team_managers(is_active)` (coach `/hub` writes — untouched);
  (C) **member/guardian `auth.uid`** + `member_guardians('accepted')` (the #7c self path). Every new
  write: SECURITY DEFINER, `search_path` pinned, single overload, **REVOKE from named roles not just
  PUBLIC**, `audit_events` insert (HR#9, flags-not-PII).

---

## ROADMAP — PRs in dependency order

> Reuse-first + additive ⇒ most PRs are **CLEAR**. Tier-3 gates: the home-venue-shell writer (PR #4),
> the #7c self reader if one is needed (PR #6), and the Vercel-project teardown intent (PR #5). Each
> PR = one `/dev-loop` cycle. Gates cite the repo's deterministic scripts + human 🚦 stops.

### PR #1 — Club lens switcher + scoping context (no new views)   TIER-1 · CLEAR   *(keystone)*
The plumbing only, kept small (the judge flagged the combined shell+Home+scoping as 2 cycles). Add a
**topbar club switcher** (renders only when the venue has ≥1 club, mirroring the existing venue
switcher) that sets `clubContext` state in `App.jsx` per Decision 1; wire `getMyWorld()` into boot
alongside `venueWhoami()` (role/hat awareness). Thread `clubContext` as a narrowing prop into the
existing club-touching views (Members/Memberships/Sessions/Staff/Safeguarding) so they scope to the
selected club; with no club selected, behaviour is **byte-identical to today**. Do NOT convert the
router — additive state over the hand-rolled `view` model, + minimal query-param sync for the selected
club (Decision 1). **Auto-activate the lens when the caller's only/owned venue is a club shell**
(derivable from `get_my_world` — the PR #4 venueless-club case), so a club-only admin never lands on an
empty venue home and hunts for the switcher.
- Gates: `node --check`, check-hygiene (see 🚦 hygiene-scope note), check-build, Playwright (club
  switcher appears on a demo venue with clubs, selecting one scopes the existing views, clearing it
  restores the unscoped default, venue-operator view unchanged with no club selected, 0 new errors).
- Done: an operator can focus the console on one club; the venue-operator default is unchanged.

### PR #1b — Club-first Home dashboard   TIER-1 · CLEAR
Add the club-first **Home** view (port `clubmanager` Dashboard: compliance / this-week / money tiles)
**composed client-side from existing venue-token + `clubManagerTeamPayments` reads** — no roll-up RPC
(keeps it CLEAR). Empty/loading/error triad on every tile (copy `GuardianMatches.jsx`; a zero-DBS-
issues board renders "all clear", not blank). **Before build, field-by-field diff the retired
`clubmanager/src/views/Dashboard.jsx` + its tiles** against the readers listed in KEY AUDIT FACTS —
confirm no tile relied on a query shape not covered (the one place PR #5 retirement could silently drop
a capability — judge flag).
- Gates: `node --check`, check-hygiene, check-build, Playwright (Home renders seed data for a selected
  club + empty-state on a clean club, 0 new console errors).
- Done: selecting a club shows a club-first Home with real compliance/this-week/money glances.

### PR #2 — Port the club-first surfaces into the lens   TIER-1 · CLEAR
Port the four surfaces only `clubmanager` had, into the club lens (all use existing RPCs): **(a)
Structure org-chart + SeasonRollover** (`clubmanager` `Structure.jsx`/`SeasonRolloverModal.jsx` —
`clubCreateCohort`/`clubUpdateCohort`/`clubCreateTeam`/`clubArchiveTeam`/`clubEnsureTeamInviteLink`);
**(b) Comms composer** (`Comms.jsx` → `clubSendAnnouncement`, club/cohort/team audience); **(c) ClubPage
editor** (`ClubPage.jsx` → the mig-515 `venueGetClubPage`/`venueSetClubPage`/`venuePublishClubPage`
twins); **(d) welfare/safeguarding R/A/G DBS board** (`Safeguarding.jsx` — `venueListClubStaff` DBS
status + `venueListSafeguardingIncidents` Lead-only, sitting beside the existing incident-only
SafeguardingPanel) **+ a one-click "nudge the amber/expired coaches" bulk action** reusing
`clubSendAnnouncement`/the existing reminder spine (SWEEP wow — turns a read-only board into an
actionable one at near-zero cost, no new backend). Optimistic-UI + `saving`-guard + toast triad on
every write. **(e) Also wire the club-team join QR** into the consolidated `InvitesView` under the lens
(`clubEnsureTeamInviteLink` — exists in core, no new backend). The club **Schedule** view here is a
**filtered lens on the existing unified calendar** (`get_operator_pitch_occupancy`/BookingsView
occupancy), NOT a new calendar — it surfaces the club's `club_session`/`club_fixture` rows + the
existing clash/bump flow.
- Gates: `node --check`, check-hygiene, check-build, Playwright (season rollover on demo; send a
  club announcement; edit the club page → published; welfare board renders R/A/G + bulk-nudge; club
  schedule shows on the shared calendar; club-team QR renders a `/q/` code). Slot-clash / send
  side-effects proven zero-residue on demo.
- Done: every capability the retired console had is live in the venue club lens, on the shared calendar.

### PR #3 — Per-tenant white-label theming for the club lens   TIER-1/2 · CLEAR
Port the theming trio: `themeVars(branding)` → scoped `--cp-*` on the console container +
`color-mix()`-derived tints + `onColour()` WCAG ink. **Seed defaults from `apps/venue/styles.css`
tokens** (Manrope/amber), override only accent + derived tints from the selected club's `club_pages`
branding, **only when the club lens is active** (venue-operator view = venue's own palette, unchanged).
Zero `:root` mutation. PA Sports navy/gold = the proof tenant.
- Gates: `node --check`, check-hygiene, check-build, Playwright (select PA Sports → console tints
  navy/gold; deselect → venue amber restored; WCAG ink legible on both; 0 `:root` regressions).
- Done: the console white-labels to the selected club, proven on the reference tenant, venue chrome
  intact.

### PR #4 — Club-with-no-venue: home-venue shell provisioning   TIER-3 · PROTECTED  🚦
Close the venueless-club edge via Decision 3(a): a small `self_serve_create_club` writer (or an
extension of club creation) that provisions a `clubs` row + a shell `venues` row + a `venue_admins`
owner row + the `club_venues` link — reusing the `self_serve_create_venue` (mig 484) posture. **Owner-row is the single most
privilege-sensitive write in the epic — spec it explicitly, don't just cite mig 484:** `auth.uid()`-
gated (authenticated only, REVOKE anon), the abuse cap counts the caller's `status='pending'`
self-created entities (mig-484's exact cap), the master/dev token NEVER enters the bundle, and the
minted `venue_admins` row is `role='owner', status='active'` for the caller only (never a passed
user_id). The console then opens on the shell venue with the club lens auto-activated (Decision 1 /
PR #1). Unblocks `SELF_SERVE_MULTI_VERTICAL` PR5. Confirm at audit whether a new writer is truly needed
or the flow composes from existing create RPCs. **Sequencing:** PRs #4 and #6 both re-derive the free
migration number off `main` — build them in series (or re-derive at each build), never assume 518
twice.
- Gates: **rpc-security-sweep** (SECDEF, search_path, single overload, REVOKE named roles, audit),
  **ephemeral-verify** (`_e2e_` throwaway fixture, rollback, leak-check 0), check-build, Playwright
  (create a venueless club → console opens on its shell venue, club lens active). 🚦 **migration apply
  = human sign-off** (re-derive the free number off `main` first).
- Done: a club created with no physical facility is fully addressable in the one console.

### PR #5 — Retire `apps/clubmanager`   TIER-3 · PROTECTED  🚦
Sequenced LAST, gated on PRs #1–#3 being live. Remove `apps/clubmanager` from the monorepo, update
`turbo.json` + npm workspaces. **REPOINT (not teardown) `platform-club-admin.vercel.app` → the venue
console with the club preselected** — the SWEEP flagged this as the only safe option: live SSO sessions
(`*.in-or-out.com` cookie), bookmarks and club-admin muscle memory all point at that URL, so a redirect
preserves them where a teardown strands them. Update `FEATURES.md`/`DECISIONS.md`/MEMORY to record the
consolidation and mark `CLUB_MANAGER_APP_HANDOFF.md` superseded. **Carry forward that epic's
un-cleared human gates:** its G3 DPIA and G5 real-club go-live were never signed — the club-lens
surfaces inherit the SAME real-child safeguarding data, so they stay **demo-only until G3/G5 clear**;
state that in the PR. The now-moot manual-clubmanager-redeploy liability is retired (good); the owed
real-iPhone `/hub` coach walk (HR#13) it logged rolls into PR #6's owed device walk.
- Gates: `node --check`, check-hygiene, check-build (monorepo — confirm no app imports
  `apps/clubmanager`), check-workspace-deps. 🚦 **Vercel project teardown/redirect = operator intent.**
- Done: one console; the redundant app and its deploy are gone (or safely redirected); docs updated.

### PR #6 — Adult-player self-serve `/hub` track (#7c)   TIER-2/3 · PROTECTED (native)  🚦
**Independent of PRs #1–#5** (touches only `apps/inorout`, not the venue console) — sequence it
whenever the Apple review window allows; do NOT let the #5 Vercel teardown block this native-freeze-
sensitive work. Fill the mobile gap. Add a `member` track to `apps/inorout/src/mobile/nav.js`
(`resolveRoles` + `tabsFor`) derived off `world.club_memberships` (dedup vs anyone already covered as
guardian/coach — **note the DPIA-sensitive overlap: an adult who is BOTH a player AND a guardian of a
U18 must get their OWN self-view without it colliding with the child-proxy view; the self track shows
self data only, never a child's**);
add a `MobileShell` branch; build member tabs (schedule/matches/membership/more, mirroring Guardian
minus the child-proxy) that **reuse the Guardian screens with a self `forProfileId`** and the existing
self readers (`member_list_club_fixtures`, `member_list_upcoming_sessions`). Add a **self-scoped
reliability/POTM reader** if none fits (a self variant of `club_manager_get_team_ratings_table`) — this
is the only possibly-new backend. This is the adult-player wow (own reliability/POTM/in-out in-club).
- Gates: `node --check`, check-hygiene, **casual-regression** (touches `apps/inorout/src` — MANDATORY,
  additive-diff only), check-build; **rpc-security-sweep + ephemeral-verify** *only if* a self reader
  migration lands (else CLEAR). Playwright (adult member sets own availability, sees own reliability).
  🚦 migration apply only if a new reader is introduced. ⛔ **real-iPhone `/hub` walk owed (HR#13)** +
  App-Store binary-freeze awareness (MobileShell/native touch).
- Done: an adult club member self-serves in/out for training + matches and sees their own
  reliability/POTM in `/hub`, casual flow unchanged.

### PR #6b — Club-admin mobile critical-actions track (`/hub`)   TIER-2/3 · PROTECTED (native)  🚦
Per Decision 10 — the phone twin of the desktop club lens. **Independent of PRs #1–#5** (touches only
`apps/inorout`); sequence with the other native `/hub` work inside the Apple window. A club admin
(`admin` hat off `get_my_world.admin_roles`/`club_memberships`, resolved in `nav.js:resolveRoles` — the
retired `clubmanager/roles.js` already derives it) gets a **club-admin track** whose tabs surface the
time-critical actions, NOT deep setup (that stays desktop): **Today** (needs-you-now: DBS
expired/expiring, join requests to approve, fixture clashes) · **People** · **Money** glance ·
**Comms** (send announcement) · **More**. Reuse existing wrappers — `venueListClubStaff` (DBS),
`clubSendAnnouncement`, the join-approval + clash/bump readers, `venueMembershipSummary` — all already
in `@platform/core`; the only possibly-new backend is a compact "club-admin needs-you-now" reader if
composing client-side is too chatty (confirm at audit). Every action = optimistic + saving-guard +
toast; cold-thumb / one-bar tolerant.
- Gates: `node --check`, check-hygiene, **casual-regression** (touches `apps/inorout/src` — MANDATORY,
  additive-diff only), check-build; rpc-security-sweep + ephemeral-verify **only if** a needs-you-now
  reader migration lands (else CLEAR). Playwright (club admin approves a join, nudges a DBS, sends an
  announcement on demo). 🚦 migration apply only if a new reader is introduced. ⛔ **real-iPhone `/hub`
  walk owed (HR#13)** + App-Store binary-freeze awareness.
- Done: a club admin does the critical day-to-day (approve join · nudge DBS · resolve clash · announce ·
  money glance) from the phone; deep setup stays on the desktop console.

---

### PR #7 — (DEFERRED FOLLOW-ON — operator decided out of MVP 2026-07-09) Club-branded reception display   TIER-3 · PROTECTED  🚦
`apps/display` is venue-only today (`get_display_state` reads `public.fixtures` + bookings; club
activity never appears). If a club-branded reception view is wanted (club's next fixtures, latest
results, tonight's training, on a `club_pages`-branded screen), extend `get_display_state` (or a
`get_club_display_state`) to include `club_fixtures`/`club_sessions` + drive theming from `club_pages`.
**Net-new backend → default OUT of the consolidation MVP; needs an explicit in/out decision.**
- Gates: rpc-security-sweep + ephemeral-verify (new/changed reader), check-build, Playwright (demo
  club fixtures render on the display). 🚦 migration apply + **in/out decision**.
- Done: a reception screen shows a branded club's fixtures/results/training. *(Only if opted in.)*

### PR #8 — ❌ DROPPED (operator decided 2026-07-09 — coach `/hub` Matchday is sufficient; no neutral-referee flow wanted for grassroots)
*Left here for the record; not built.* Club fixtures can already be ASSIGNED an official (`club_fixtures.official_id`/`ref_name`) but cannot be
OFFICIATED — the ref app's token-state + assignment readers touch `public.fixtures` only. If club-league
matches should be live-scored in `apps/ref`, add a `club_fixtures` ref-token state RPC + include club
assignments in `get_my_next_assignment`. **Net-new backend → default OUT of the consolidation MVP;
needs an explicit in/out decision** (the coach `/hub` Matchday screen, mig 516, already covers
coach-side result entry — decide whether a *neutral referee* flow is even wanted for grassroots).
- Gates: rpc-security-sweep + ephemeral-verify (new RPCs), check-build, Playwright (ref token opens a
  demo club fixture). 🚦 migration apply + **in/out decision**.
- Done: a referee live-scores a club-league fixture in the ref app. *(Only if opted in.)*

## 🚦 GATES THE LOOP MUST STOP AT (human / migration / deploy / Apple)

- **Hygiene-scope note (do first):** the hygiene hook covers `apps/inorout/src` + `packages/core`
  only — **not `apps/venue/src`**. PRs #1–#3 edit `apps/venue/src`. Extend
  `post-edit-hygiene.sh`/`check-hygiene.sh` scope to `apps/venue/src` **before PR #1 build** (cheap
  insurance; own commit, touches the hook). *(If `apps/clubmanager/src` was added to scope by the
  prior epic, remove it in PR #5.)*
- **G1 — Migration 518+ apply (PR #4, and PR #6 only if a self reader lands):** re-derive the free
  number off `main` at build time; EV-prove with rollback + leak-check 0 before apply; land `.sql` +
  `_down.sql` in the same commit (HR#11). Human sign-off.
- **G2 — Vercel `platform-club-admin` teardown/redirect (PR #5):** a live public URL — operator
  confirms intent to remove or repoint. (Do NOT touch `platform-clubmanager`, which deploys the LIVE
  inorout app — the naming trap.)
- **G3 — App-Store review (companion, PRs #6 + #6b):** any `/hub`/`MobileShell`/native change is under
  the binary freeze during Apple review; real-iPhone walk owed (HR#13). Both native `/hub` PRs (adult
  player #6, club-admin critical-actions #6b) sit here.

## DONE =
`apps/venue` is the single white-label operator console with a club lens (club switcher + club-first
Home + club-scoped People/Structure/Schedule/Memberships/Comms/Page/Safeguarding), every capability
the retired `apps/clubmanager` had is live in that lens, a venueless club is addressable via a
home-venue shell, `apps/clubmanager` is retired, the adult-player `/hub` self-serve track is live, and a club admin can
do the critical day-to-day (approve join · nudge DBS · resolve clash · announce · money) from the
native `/hub` (PR #6b) while deep setup stays on the desktop console — all off the existing Club OS
backend + migs 515–517, with the coach `/hub` screens untouched. Fonts unchanged (desktop Manrope,
mobile DM Sans). Every tier-3 gate cleared by a human.

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

- **MISSED (the gap between two lenses):** The dangerous seam is between Decision 1 (venue-operator
  is the default, club lens is opt-in) and Decision 3 (a club-only org lives on a *shell* venue): a
  club admin who runs no facility signs in and lands on an empty shell-venue home with the lens *off*,
  and must hunt for the switcher — whereas today `platform-club-admin.vercel.app` boots straight into
  their club. Fixed by two additions folded above: **auto-activate the lens when the owned venue is a
  club shell** (PR #1) and **repoint that URL rather than tear it down** (PR #5). Two more items sit in
  this seam: **deep-linkability** — the venue router is a URL-less `view` string, so club context is
  ephemeral and lost on refresh (fixed: minimal query-param sync in PR #1); and the **retired epic's
  un-cleared debt** — consolidation carries *no data-migration risk* (`clubmanager` is a pure reskin
  over 31 pre-existing venue-token wrappers, nothing to migrate off, shared SSO cookie so no orphaned
  sessions), but `CLUB_MANAGER_APP_HANDOFF.md` left **G3 DPIA + G5 real-club go-live uncleared** and an
  owed **real-iPhone `/hub` coach walk (HR#13)**; the club lens inherits the same real-child surfaces,
  so PR #5 carries "demo-only until G3/G5" forward and PR #6 absorbs the coach-walk debt (both folded
  in above). **Adjacent-surface sweep (operator-prompted):** modularity is already built and now a
  first-class thread (Decision 8); the venue menu was venue-first with club items scattered → Decision
  9 adds a club-aware rail; the unified calendar is the shared spine (club schedule = a lens on it, not
  parallel); public `/c/<slug>` + club QR are reuse (folded into PR #2). The two genuinely-missed
  surfaces that need net-new backend are the **reception display** (venue-only today) and the **ref app
  officiating club fixtures** (assign works, officiate doesn't) — both carved out as opt-in PRs #7/#8,
  default OUT of MVP, each needing an explicit in/out decision.
- **OPPORTUNITY:** This is not a cleanup epic — it is the **substrate for the multi-vertical operator
  console.** The repo already ships `apps/league`, `apps/hq`, a `GYM_VERTICAL_HANDOFF.md`, and
  `SELF_SERVE_MULTI_VERTICAL` locks Option C (capture a vertical natively, then deep-link to
  `apps/venue` under SSO as the one web console per vertical). A club "lens" over the venue console is
  the **first instance of a generic tenant lens** — pick a tenant, the console reframes and
  white-labels around it — exactly the shape gym/league consoles need next at near-zero marginal cost.
  PR #4's home-venue-shell writer *is* `SELF_SERVE_MULTI_VERTICAL` PR5, so this unblocks that epic's
  club track directly. Commercially: STRATEGY's paid SKUs are Venue and Club/Org ("Club = Venue +
  modules"), pilots prize the network effect ("get every club in our league on it"), and the scoped
  `--cp-*` white-labeling turns a **county FA / reseller / franchise** into one operator running N
  bespoke-looking clubs from one console — the multi-tenant SaaS wedge two separate apps could never
  sell. And the demo win is immediate: one console that reskins live from PA Sports navy/gold to the
  next tenant beats logging into two products.
- **FUTURE-PROOF (the one named lever):** **Build the switcher as a generic entity-typed tenant/hat
  lens off `resolveHats(get_my_world())`, keyed on `admin_roles[].entity_id` by entity type — not a
  club-only switcher off `venueWhoami`.** It buys the most flexibility for the least cost *because the
  code already exists*: `apps/clubmanager/src/lib/roles.js:resolveHats` already turns the `get_my_world`
  payload (mig 372) into a ranked multi-hat set, and PR #1 already wires `getMyWorld()` into venue boot
  — so iterating `world.admin_roles` generically (venue OR club OR, tomorrow, gym/league) costs *the
  same lines* and lights up every future vertical console + the welfare-officer-only hat with zero new
  plumbing. Folded into Decision 1 as a refinement (a generalization of what PR #1 builds anyway, not
  extra scope).
- **WOW (per audience):** **Club admin/owner** — the Monday one-click ops/compliance Home (PR #1b); the
  cheap amplifier is *emotional* — sequence PR #3 so first club-selection **repaints the chrome in their
  badge/navy-gold** ("this is *my club's* system"), not a settings afterthought. **Welfare officer** —
  the R/A/G DBS board is net-new (no venue surface today); the cheapest thing that makes it *audible* is
  the **one-click "nudge the amber coaches" bulk action** folded into PR #2 — a board they *act* on, not
  just read. **Venue operator** — "unchanged" is a correct non-regression but under-sells the dual
  operator who runs a venue *and* clubs: their real payoff is the topbar switcher now listing venue +
  every club in one pane, one login, each white-labeled — sell "your clubs live here now," delivered
  free by the generic-tenant-switcher lever. **Adult club player** — self-serve in/out **plus own
  reliability/POTM with no manager message** is the standout no club competitor offers (PR #6); the
  near-zero amplifier is to frame that number as a **personal shareable stat/streak** ("92% reliable
  this season"), not a raw table row.

## Related
- `CLUB_MANAGER_APP_HANDOFF.md` — **superseded by this manifest** (the duplicated-console epic).
- `SELF_SERVE_MULTI_VERTICAL_HANDOFF.md` — PR5 club self-serve, unblocked by PR #4 here.
- `DECISIONS.md:585-598` — `CLUB_PACKAGES`/`VENUE_PACKAGES` presets = the "Club = Venue + modules" SKU.
- `STRATEGY.md:104-122` — the Club/Org SKU (Venue + club modules) + "attendance is the wedge."
- migs 515–517 + `apps/inorout/src/mobile` coach screens — the KEPT backend + coach companion.
- `get_my_world()` (`packages/core/storage/supabase.js:6720`) — the identity spine the lens routes off.

---
*Trigger:* `/loop /dev-loop CLUB_CONSOLE_CONSOLIDATION_HANDOFF.md`
