# Multi-Context Navigation & First-Run Guides — Cross-Session Handoff

*Purpose: a single shared contract for the work that makes the consumer app's
**navigation, stats/IO surfaces, and first-run guided tours** relevant to whichever
**context** the multi-switcher is showing. This session (140) produced the DESIGN and
this handoff only — **no feature code was written.** The build is large and is planned
to run in its own next session. Read this top-to-bottom before writing any code.*

Related/superseded planning:
- Casual-app first-run guide plan (approved, narrower): `~/.claude/plans/the-app-has-a-cozy-eagle.md`
  — that plan covers the **casual football** player hints + admin welcome only. It is now a
  **subset** of this larger context-aware effort and should be folded into Phase 2 below.
- Membership model: `MEMBERSHIP_V2_HANDOFF.md`. Switcher/routing: `App.jsx` ~1314–1380.

---

## The problem

The consumer app (`apps/inorout`) lets one person belong to several **contexts** — a casual
squad, a competitive/league team, a club/gym membership, a parent/guardian view — and switch
between them in the **multi-switcher** (`App.jsx` ~1314–1380). Two things are currently wrong:

1. **Navigation is static.** `NavBar` (`apps/inorout/src/components/ui/NavBar.jsx:37–58`)
   hardcodes `My View / Stats / Results / My IO (+Admin)` for **every** context. A gym member
   has no use for a football league table or IO Intelligence; a casual kickabout with no league
   shouldn't surface league standings. Stats/IO must be **scoped to the selected context**.
2. **There is no context-aware first-run guidance.** Guides must teach the *relevant* screen for
   the *current* context, and re-fire (once) when the user switches into a new context they
   haven't seen.

The insight: **nav-relevance and the guided tour are the same problem** — both must read one
**context descriptor**.

---

## What is already built (don't rebuild)

- **Switcher** in `App.jsx` ~1314–1380: "YOUR GAMES" (casual squads via
  `getPlayerTeamsByToken`) + "YOUR CLUBS" (`memberProfile.active_clubs`).
- **Top-level context routing already exists** via a derived `homeScreenType`
  (`squad_only` / `club_member` / `multi` / `parent`, App.jsx ~326–335). A **club** membership
  already routes to `/sessions` (SessionsScreen), NOT the football PlayerView — so club members
  don't get football tabs today. This is half the solution already.
- **Consumer membership surfaces (built, auth-walled, gated on `active_clubs`):**
  - `SessionsScreen.jsx` (`/sessions`) — club training/fixture RSVPs, attendance, announcements
  - `MemberPass.jsx` (`/m/<token>`) — membership card, tier/status/renewal, perks, check-in QR
  - `ClassesTimetable.jsx` (`/classes`) — class booking, waitlist, packages/passes
  - `MemberProfile.jsx` (`/profile`) — account, children, consents
  - `ParentHomeScreen.jsx` (`/parent-home`) — guardian view of children
  - `UnifiedFeedScreen.jsx` (`/feed`) — multi-context feed
- **League surfaces** for competitive squads: `CompetitionStandingsCard` / `CompetitionFixturesCard`
  (rendered inside PlayerView my-view), plus league table + H2H in `StatsView.jsx`.
- **Profile button**: `PageHeader.jsx:86–109` (`onAvatarTap` → opens PlayerProfile), my-view only.
- **First-run hint component** (currently a no-op, to be revived): `components/FirstTimeHint.jsx`.
  Original implementation recovered from git `0a1e759` — gold tooltip card, `storageKey`/`placement`/
  `title`/`body`, localStorage "show once". No button highlight in the original — we are ADDING
  glow-ring + spotlight (see Phase 2). Existing wired call sites already pass the prop shape
  (e.g. `AdminView/index.jsx:897` "MAKE YOUR GAME LIVE").

### Context signals that already exist in data (the descriptor's inputs)
- `teams.team_type` — `'casual'` | `'competitive'`
- `is_competitive` — flag from `getPlayerTeamsByToken` (mig 153): squad has active league registration
- `teams.club_id` — NULL = no club context; present = club membership features
- match count (`matches` where `team_id=X AND cancelled=false`) — `>0` = stats/IO relevant
- `active_clubs` (from `memberGetSelf`, mig 289) — club memberships
- `fixtures` / `competition_teams` presence — league fixtures relevant

---

## The model: one context descriptor drives nav + surfaces + tour

Derive once when a context is selected:

```
deriveContext(selected) → {
  type:       'casual_squad' | 'competitive_squad' | 'club_membership' | 'guardian',
  hasMatches: boolean,   // match count > 0
  isLeague:   boolean,   // is_competitive / fixtures present
  isClub:     boolean,   // club_id / active_clubs
}
```

From that descriptor compute three currently-hardcoded things: **(a) NavBar tab set**,
**(b) which stats surface renders**, **(c) which first-run tour runs** (keyed `type × screen`,
namespaced storage keys so switching context re-fires the right tour once).

---

## Relevant context screens — nav items, contents, and guide (DRAFT — confirm next session)

> Casual squad is intentionally omitted here (already covered by the `cozy-eagle` plan). This
> table is the spec to confirm/correct at the start of the next session.

### Context A — Club / Gym Member  (`type: club_membership`, `active_clubs > 0`)
Routes to a member home, NOT football PlayerView. **Never** show league table / POTM / IO / In-Out board.

| Nav item | Screen | Contents | First-run guide (per item) |
|----------|--------|----------|----------------------------|
| **Sessions** (home) | `SessionsScreen` | Upcoming training/fixtures, RSVP, who's going, announcements | "RSVP to training here · tap a session to see who's going" |
| **Classes** | `ClassesTimetable` | Timetable, book a class, join waitlist, my packages/passes | "Book a class · join the waitlist if full · your passes live here" |
| **Pass** | `MemberPass` | Membership card, QR check-in, tier/status/renewal, perks | "Show this QR at the door to check in · your membership & perks" |
| **Profile** | `MemberProfile` | Account, children, consents | "Manage your account, children and consents" |

### Context B — Competitive / League Squad  (`type: competitive_squad`, `is_competitive`)
Casual PlayerView **plus** league surfaces. Stats league table + H2H are relevant here.

| Nav item | Screen | Contents | First-run guide additions (over casual) |
|----------|--------|----------|-----------------------------------------|
| **My View** | PlayerView my-view + `CompetitionStandingsCard` + `CompetitionFixturesCard` | In/Out board + your league standing + upcoming fixtures | "Your league position · your next fixtures vs other teams" |
| **Stats** | `StatsView` (league table + H2H ON) | League table, top scorers, head-to-head | "The league table · tap a player for head-to-head" |
| **Results** | `HistoryView` | Match archive | (as casual) |
| **My IO** | `MyIOView` | IO Intelligence (unlocks by games) | (as casual) |

### Context C — Parent / Guardian  (`type: guardian`, `hasGuardian`)
| Nav item | Screen | Contents | First-run guide |
|----------|--------|----------|-----------------|
| **Home** | `ParentHomeScreen` | Children overview, per-child availability/sessions | "Manage your children's availability · switch between children" |

### Cross-context — the multi-switcher itself
A dedicated guide on the switcher control, regardless of context:
> "Tap here to switch between your squads, clubs and memberships."

---

## Phased build plan

**Phase 1 — Context foundation (prerequisite, the actual answer to the nav question):**
1. Add `deriveContext()` as the single source of truth (pure function over existing signals).
2. Make `NavBar` accept a **tabs array** prop instead of hardcoding; App feeds it the descriptor's
   tab set per context.
3. Gate football-specific content (league table inside `StatsView`, the My IO tab, standings/fixtures)
   on `isLeague` / `hasMatches`, and the membership tabs on `isClub` — so no context surfaces
   irrelevant data.

**Phase 2 — Context-aware guided tour (on top of Phase 1):**
- Revive `FirstTimeHint` and UPGRADE it to **per-screen guided tour**: spotlight (dim screen),
  **glow-ring** around the live target (computed from `getBoundingClientRect`, recalculated on
  scroll/resize/tab-change for pixel-perfect alignment), card copy, **auto-advance when the user
  taps the highlighted control**.
- Tours registered per `(type, screen)` with namespaced storage keys (e.g. `io_tour_club_sessions`,
  `io_tour_comp_myview`). Fires once the first time that context+screen is seen; re-fires (once) for
  a newly-entered context.
- Include the **Profile button** and the **multi-switcher** guide.
- Fold in the approved casual plan (`cozy-eagle`): the six casual player hints + the 4-line admin
  welcome (Match Settings → Make Teams → Input Result → Payments; live-toggle deliberately excluded).

---

## Open questions to resolve at the START of next session (before code)
1. **Confirm the context type set** — are A/B/C above complete, or is there a multi-venue member,
   a non-playing supporter, or another context?
2. **Confirm the per-context tab sets + contents** in the tables above (this becomes the spec).
3. **Spotlight intensity** — full screen-dim spotlight vs glow-ring-only; auto-advance-on-tap only,
   or also a "Skip tour" affordance.
4. **Switcher guide trigger** — show on first app open, or first time the user has >1 context.
5. Does Phase 1 nav-gating need any new RPC/return-shape field, or are all signals already on the
   data the app loads? (Audit `getPlayerTeamsByToken` + `memberGetSelf` return shapes first.)

---

## NEXT-SESSION PROMPT (paste this to start the build session)

> Read `MULTI_CONTEXT_NAV_HANDOFF.md` in full, then `~/.claude/plans/the-app-has-a-cozy-eagle.md`
> (the casual-app subset). We're building **context-aware navigation + first-run guided tours**
> for `apps/inorout`.
>
> Start in **AUDIT / plan mode**. Do NOT write code yet. First resolve the five "Open questions"
> at the bottom of the handoff with me. Then audit, against live code + DB:
> (a) `deriveContext` inputs — confirm every signal (`team_type`, `is_competitive`, `club_id`,
> match count, `active_clubs`, fixtures) is present on the data App.jsx already loads, or name the
> RPC/return-shape gap; (b) `NavBar.jsx` + `App.jsx` `homeScreenType` routing — exactly where the
> tab set and per-context routing are decided; (c) `StatsView`/`MyIOView` — what to gate on
> `isLeague`/`hasMatches`; (d) the membership surfaces (`SessionsScreen`, `MemberPass`,
> `ClassesTimetable`, `MemberProfile`) — confirm their nav entry points.
>
> Then produce a phased plan: **Phase 1 context foundation** (deriveContext + config-driven NavBar +
> surface gating) THEN **Phase 2 context-aware guided tour** (revive+upgrade `FirstTimeHint` to
> spotlight + glow-ring + auto-advance-on-tap, tours keyed per `(context type, screen)` with
> namespaced storage keys, including the Profile button + multi-switcher guide, folding in the six
> casual player hints + 4-line admin welcome).
>
> Methodology: AUDIT → EXECUTE → VERIFY → COMMIT per `CLAUDE.md`. Casual-regression skill is
> mandatory (touches `apps/inorout/src`). PWA Hard Rule #13 — real-iPhone walk owed before commit
> for any PlayerView/NavBar/App.jsx routing change.

---

## LOCKED PLAN (session 141 — audit complete, decisions resolved)

*The five handoff questions + three follow-ups are now resolved with the operator. This section is
the authoritative spec; the DRAFT tables above remain as background. No code written this session —
audit + plan only. Build runs next session from this section.*

### Audit findings that reshaped the plan (verified against live code + DB)
1. **Casual nav barely changes.** Casual squads already have My View / Stats / Results / My IO and
   the Stats/IO screens already handle 0 games (`UnlockBar`, `JourneyStartsHere`). The only nav that
   is static-and-wrong is the **club member's** (they have *no* bottom bar at all). This de-risks the
   casual-regression gate: we add menus + content, we don't rebuild the footballer's.
2. **Anonymous players can't drive the descriptor from `get_player_teams_by_token`** — it throws on
   any token not linked to an auth user and only returns teams for a linked user
   (`rls_migrations/153_*.sql:34-65`). Most casual players are anon. ⇒ the active-team descriptor
   **must** come from the team-state RPC (the migration below). Confirmed essential.
3. **Two switchers exist.** Working: the `MY SQUADS` accordion in PlayerView (`MySquads.jsx`,
   → `/p/<token>`). Half-built + off-theme: the `App.jsx:1313-1380` "YOUR GAMES / YOUR CLUBS"
   landing block (its games list never populates — wrong field names + auth-only — and it uses the
   old Inter/Bebas/hardcoded-`C.amber` theme, not tokens.css).
4. **Club + parent users are stranded** — `SessionsScreen` has no nav bar; `ParentHomeScreen` has a
   hardcoded Home/Sessions/Profile bar with no route back to football or the switcher
   (`ParentHomeScreen.jsx:98-123`). No way from `/sessions` back to `/p/<token>` except editing the URL.
5. **Guardian is thinner than drafted** — tapping a child → `/follow-live/<id>` (live-match
   spectator), not child-availability management (`ParentHomeScreen.jsx:72`). Copy must match reality.
6. Confirmed available: **framer-motion ^12.40** in the bundle; the recovered `FirstTimeHint`
   (git `0a1e759`) already has a **`prerequisite` chaining** mechanism + a cross-component dismiss
   event — a ready spine for sequenced tours.

### Resolved decisions (locked)
- **Q1 — context types:** four confirmed — `casual_squad` / `competitive_squad` / `club_membership`
  / `guardian`. Design rule: **`deriveContext` takes the *selected context entry*, never the person.**
  The switcher's two lists (YOUR GAMES = squads, YOUR CLUBS = clubs) disambiguate squad-vs-club before
  any flag is read. A club-affiliated competitive squad still resolves to `competitive_squad`; its
  club membership, if any, is always a *separate* `active_clubs` entry. Person-level `homeScreenType`
  stays as the landing-router + switcher-populator.
- **Q2 / isLeague rule:** **tab presence keyed on `team_type==='competitive'`** (stable — no
  off-season flicker); **content keyed on `is_competitive`** (active registration → real standings/
  fixtures vs a calm "no active competition" state).
- **Q3 / spotlight:** **full screen-dim spotlight + glow-ring on every tour**, auto-advance when the
  user taps the highlighted control, plus a small **Skip** link. (Operator chose full spotlight
  uniformly — heavier than the original "gentle hints" intent for the casual six; accepted.)
- **Q4 / switcher trigger:** fires the first time the user has **>1 context**.
- **Q5 / data gap:** **return-shape addition, not a new RPC** — see migration below. Full system,
  future-proofed (operator: "everything required for a full system").
- **Q-competition gating:** gate only the **competition** surfaces on `isLeague`; the in-squad
  `PlayerLeagueTable` (within-squad ranking) **stays for everyone**.
- **Q-switcher:** **scrap** the dead off-theme `App.jsx:1313-1380` block; **unify** to one themed
  switcher, reached from the header avatar, with `/feed` as the cross-context home hub.
- **Q-way-back:** the **header avatar** (top corner) opens the unified switcher, on every context.
- **Q-old hints:** accept the **one-time** re-show of the ~12 already-wired coachmarks to current users.
- **Q-scope:** **fix both pre-existing bugs** in this work — multi-club selection + stranded users.

### Phase 1 — context foundation
1. **Migration (next free number)** — add `team_type`, `is_competitive`, `club_id`, `club_name` to
   the return shapes of `get_team_state_by_player_token` **and** `get_team_state_by_admin_token`.
   Same-commit mapper updates in `packages/core/storage/supabase.js` (Hard Rule #12); record
   multi-consumer note in `RPCS.md` (Hard Rule #14). Write `.sql` + `_down.sql` source same commit
   (Hard Rule #11). Ephemeral-verify runs (RPC modified) — read-shape change, seed-own-fixture.
2. **`deriveContext(activeEntity)`** — pure function in a small shared module →
   `{ type, hasMatches, isLeague, isClub, clubId, clubName }`. Fed per route: `/p|/admin/<token>`
   from team-state fields; `/sessions|/classes|/m|/profile` from the selected `active_clubs` entry;
   `/parent-home` → guardian. Stable "resolving" state so the bar never flashes the wrong tabs;
   anon fallback uses team-state alone.
3. **Config-driven `NavBar`** — dumb renderer of `tabs:[{ id, label, Icon, active, onSelect }]`.
   Squad tabs wire `onSelect→setActiveTab` (unchanged behaviour); club tabs wire `onSelect→route nav`.
   Preserve AdminView's active-Admin-tab state + the MY-IO custom label. Touches PlayerView **and**
   AdminView render → both in casual-regression scope.
4. **Shared NavBar onto membership routes** (Sessions/Classes/Pass/Profile); replace
   ParentHomeScreen's bespoke bar with the unified one.
5. **Header-avatar switcher** on every context (closes the stranding); retire the dead App.jsx block;
   route to the unified themed switcher / `/feed`.
6. **Surface gating** — competition standings/fixtures cards + league-table-in-Stats on `isLeague`;
   membership tabs on `isClub`. In-squad `PlayerLeagueTable` ungated.
7. **Bug fixes:** (a) **multi-club selection** — pass/remember the tapped `club_id` (URL param or
   stored) so `/sessions` shows the chosen club, not always the first (`SessionsScreen.jsx:218-236`);
   (b) **stranding** — resolved by #5.

**Per-context tab sets (locked spec):**
| Context | Tabs |
|---|---|
| `casual_squad` | My View · Stats · Results · My IO  (+ Admin if admin) |
| `competitive_squad` | My View (+ standings/fixtures cards) · Stats (league table + H2H on) · Results · My IO  (+ Admin) |
| `club_membership` | Sessions · Classes · Pass · Profile |
| `guardian` | Home · Sessions · Profile |
All contexts: header avatar → unified switcher.

### Phase 2 — context-aware guided tour
- **Engine** (revive + upgrade `FirstTimeHint`): full dim + spotlight + glow-ring from
  `getBoundingClientRect`; **poll-until-mounted** target resolution (async lists); recompute on
  scroll/resize/orientation/tab-change, rAF-throttled; **scroll target into view** before highlight;
  **no-op gracefully** when target absent (e.g. competition card between seasons); respect
  `prefers-reduced-motion`; auto-advance on tap of the highlighted control; **Skip** link; reuse the
  original **`prerequisite` chaining** to sequence steps. iOS safe-area: overlay covers notch + nav.
- **Registry — one tour per `(type, screen)`, namespaced storage keys, fire once / re-fire once on
  entering a new context type:**
  | Key | Fires on | Steps |
  |---|---|---|
  | `io_tour_casual_myview` | casual My View, first run | In/Out → +1 guest → mark injured → change teams (MySquads) → tap avatar for H2H (sequenced) |
  | `io_tour_casual_stats` | casual Stats, first open | what Stats shows |
  | `io_tour_admin_dash` | admin dashboard, first load | Match Settings → Make Teams → Input Result → Payments (spotlight over the live tiles; live-toggle excluded — its in-context coachmark at `AdminView/index.jsx:897` covers that one-off) |
  | `io_tour_comp_myview` | competitive My View | league position + next fixtures (no-op between seasons) |
  | `io_tour_comp_stats` | competitive Stats | league table → tap a player for H2H |
  | `io_tour_club_sessions` | club Sessions | RSVP · tap a session to see who's going |
  | `io_tour_club_classes` | club Classes | book · join waitlist · your passes |
  | `io_tour_club_pass` | club Pass | show QR at the door · membership & perks |
  | `io_tour_club_profile` | club Profile | account · children · consents |
  | `io_tour_guardian_home` | guardian Home | follow your children's live games |
  | `io_tour_switcher` | first time user has >1 context | header avatar → switch squads/clubs/memberships |
- The six casual hints + admin orientation fold in here (the cozy-eagle subset); the ~12 wired call
  sites get real copy; four missing spots (guest, injured, MySquads link, avatar) get wrappers.

### Build sequence + gates
- Ship **Phase 1** and **Phase 2** as separate, independently-shippable commits.
- Every step AUDIT → EXECUTE → VERIFY → COMMIT. **Casual-regression skill mandatory** (touches
  `apps/inorout/src`). **Ephemeral-verify** on the Phase 1 migration. **PWA Hard Rule #13** — real-
  iPhone walk owed before commit on both phases (NavBar / PlayerView / App.jsx routing in scope).
- Update `BUGS.md` (two pre-existing bugs resolved), `RPCS.md` (return-shape additions + consumers),
  `GO_LIVE_ISSUES.md` (device checks), `CONTEXT.md` session entry.

### Guardian context — CORRECTED spec (session 141, after operator review)
A child is *on a team*; that team has both training and matches, and the guardian must set
availability for each. Verified facts:
- A **match is just a `club_sessions` row** with `session_type IN ('training','match','friendly','other')`
  carrying `opponent_name` / `home_away` / `meet_time` (mig 300:78-79). So "in for training" and
  "in for the match" are the **same action** on two sessions.
- The **write is already solved and guardian-aware**: `member_rsvp_session(sessionId, status,
  {forProfileId: child})` checks `member_guardians` (you're the guardian) + the **child's** active
  membership — NOT the guardian's (mig 299:100-122). So a parent can RSVP any child in any club the
  *child* belongs to, even one the parent isn't a member of. Many kids, multi-club, same-team-two-kids:
  all handled, one RSVP per (session, child).
- **The gap is reading/discovery.** `SessionsScreen` is single-club and requires the *guardian's own*
  membership → a kid in a club the parent isn't in is **invisible**. Guardian Home shows only the one
  *next* session per child (mig 314:264-324). **No RPC returns all children's sessions across all clubs.**

**Locked guardian build (adds one migration):**
- **New read RPC `guardian_list_children_sessions`** (SECURITY DEFINER) — for every child of the caller
  (via `member_guardians`), all upcoming **training + matches** across **all** the child's clubs/cohorts/
  teams (matches carry opponent + meet time), with that child's current RSVP status. Gated guardian→child
  + child→membership (mirrors mig 299; no guardian-own-membership requirement). Grants both anon +
  authenticated per [[vc_parity_sweep_grants]] discipline.
- **Child-first guardian Home** — each child listed with their upcoming fixtures; **In / Out** control
  per item wired to the existing `member_rsvp_session(forProfileId=child)`; child filter chips when there
  are several; two kids on one match = two rows. Follow-live stays for games in progress.
- **Guardian stays a single context**; children are content/filter *within* it, never separate switcher
  entries. The parent's own squads/clubs remain separate entries.
- **Injured: out of scope for now** — sessions have in/maybe/out only; "out (+ optional note)" covers an
  injury report. A distinct child "injured" state is a deferred follow-on.

### Cross-cutting decisions (Tier 1–2, locked session 141)
1. **Landing + last-context memory** — multi-context users land on `/feed` (the hub); store a
   "last active context" so the app reopens where the user left off, not on a dormant squad.
2. **PWA install for non-squad users** — make `/feed` the canonical installable home (today the
   `api/manifest` + index.html inline-script install story is squad-token-only; guardians/club-only
   members have no install target). **Verify the manifest path for `/feed` + club/guardian routes during
   build — Hard Rule #13 real-device walk applies.**
3. **Tour vs existing overlays** — the spotlight tour is **suppressed while any modal/overlay is open**
   (SquadReady, InstallBanner, AuthGateModal, both POTM modals per [[reference_two_potm_modals]]).
   First-run order: SquadReady → install prompt → tour.
4. **Tour abandonment** — mark a tour **"seen" on first SHOW, not on completion**, so it never nags even
   if abandoned mid-way.
5. **Terminology** — keep the **In / Out** brand language across every context; surface "maybe" only where
   the data supports it (club sessions), quietly.
6. **Empty states** — spec one per new surface: guardian with no upcoming sessions (off-season), club
   member with no classes, competitive team between seasons.
7. **Feature flag / kill-switch** — gate the new context-aware nav behind a simple per-team flag so it can
   ship dark, enable per team, and roll back instantly. (This reshapes the most-used app during an active
   pilot — see [[project_pilot_venue]].)

### Deferred follow-ons (named, NOT in this epic)
- **Guardian/child notifications** — "remind me to RSVP [child] for Saturday." The single biggest value
  add for the guardian case; push is per-device/token today with no guardian/child path. Next epic.
- **Distinct child "injured" status** on match availability (needs a new session status).
- **Coach/manager context** — `memberGetSelf` already returns `managed_teams`; a latent consumer context
  not modelled here.
- **Teen self-graduation** from a managed child profile to their own login.
- **Tour analytics** — tours are localStorage-only, so adoption is unmeasured; a small server trace would
  be additive.

### Migration count for this epic (sequence per CLOUD SESSION DISCIPLINE)
Two new migrations: **(A)** team-state fields onto `get_team_state_by_player_token` + `_admin_token`
(+ mappers); **(B)** `guardian_list_children_sessions` read RPC. Grab the next free numbers at build
time; one session start-to-finish to avoid the parallel-number collision.

### Ordering vs the domain migration (`DOMAIN_MIGRATION.md`)
**This nav epic ships FIRST.** It is domain-independent except for one constant (`BASE_URL` in
`api/manifest.js`), and the domain migration hasn't started + carries operational risk (7 crons,
webhooks, OAuth). No hard conflict between the two — different layers (in-app UX vs hosting). The
single touch-point is `api/manifest.js`: the nav epic adds `start_url: /feed` there; the domain
migration changes `BASE_URL` there.
- **Build the `/feed` install BASE_URL-relative** (reference the existing constant, do NOT hardcode a
  domain) — so it works on today's `www.in-or-out.com` AND auto-inherits `app.in-or-out.com` later.
  The "deferred" part is then only a re-test, not unfinished work.
- **Never run a manifest-touching nav session and a manifest-touching domain session in parallel**
  (shared-file collision per Cloud Session Discipline). Nav merges first, then domain.
- Follow-on handoffs (manifest repoint, `/feed` CTA deep-link, `/feed` install re-test on `app.`) are
  recorded in `DOMAIN_MIGRATION.md` → "Follow-on tasks from the multi-context nav epic".

---

## PHASE 1 BUILD PROMPT (paste this to start the build session)

> Read `MULTI_CONTEXT_NAV_HANDOFF.md` §LOCKED PLAN in full (and the s140 design above for context).
> The plan is LOCKED — do not re-litigate decisions; build it. We're building **Phase 1 — context
> foundation + the two pre-existing bug fixes** for `apps/inorout`. Phase 2 (the guided tours) is a
> separate later session.
>
> Work the methodology per `CLAUDE.md`: **AUDIT → EXECUTE → VERIFY → COMMIT**, one logical unit per
> execute step. Start by re-AUDITING against live code/DB (signatures may have moved since s141):
> `get_team_state_by_player_token` + `_admin_token` return shapes & mappers; `NavBar.jsx` props;
> `App.jsx` routing + `homeScreenType`; `SessionsScreen.jsx` multi-club selection; the dead
> `App.jsx:1313-1380` switcher block; `member_rsvp_session` (mig 299) + `member_guardians` for the
> guardian feed.
>
> Then build, in order:
> 1. **Migration A** (next free # — check `list_migrations`, currently 349): add `team_type`,
>    `is_competitive`, `club_id`, `club_name` to `get_team_state_by_player_token` AND
>    `get_team_state_by_admin_token` return shapes; update the mappers in
>    `packages/core/storage/supabase.js` SAME commit (Hard Rule #12); write `.sql` + `_down.sql` (HR
>    #11); record consumers in `RPCS.md` (HR #14). Run **ephemeral-verify** (seed-own-fixture).
> 2. **Migration B**: `guardian_list_children_sessions` (SECURITY DEFINER) — for every child of the
>    caller via `member_guardians`, all upcoming training + matches across all the child's clubs/
>    cohorts/teams (matches carry opponent + meet time) + that child's RSVP status. Gate guardian→child
>    + child→membership (mirror mig 299, NO guardian-own-membership requirement). **Grant anon +
>    authenticated** (parity-sweep discipline). Wrapper + barrel + `RPCS.md`. Ephemeral-verify.
> 3. **`deriveContext()`** pure module → `{ type, hasMatches, isLeague, isClub, clubId, clubName }`,
>    fed from the active route's loaded entity; stable "resolving" state; anon fallback = team-state.
> 4. **Config-driven `NavBar`** (`tabs:[{id,label,Icon,active,onSelect}]`); preserve AdminView's
>    active-Admin-tab + MY-IO label + casual behaviour exactly.
> 5. **Shared NavBar on the membership routes** + the **header-avatar switcher** (retire the dead
>    `App.jsx:1313-1380` block; route to one themed switcher / `/feed`); **last-context memory**;
>    multi-context users land on `/feed`.
> 6. **Surface gating** (competition surfaces on `isLeague`; membership tabs on `isClub`; in-squad
>    league table ungated) + **per-team feature flag** (ship dark).
> 7. **Child-first guardian Home** wired to `guardian_list_children_sessions` + In/Out per fixture via
>    the existing `member_rsvp_session(forProfileId=child)`; child filter chips.
> 8. **Bug fix:** multi-club selection — carry the tapped `club_id` into `/sessions` (URL param or
>    stored) so it shows the chosen club, not always the first.
> 9. **`/feed` install BASE_URL-relative** (do NOT hardcode a domain) — see the domain-coordination
>    note above.
> 10. **Empty states** per new surface.
>
> VERIFY before commit: build clean; `check-hygiene.sh` on every changed file; grep all NavBar call
> sites; **casual-regression skill (MANDATORY** — touches `apps/inorout/src`); ephemeral-verify on
> both migrations + leak-check = 0. **PWA Hard Rule #13: a real-iPhone walk is OWED before commit** for
> the NavBar/PlayerView/App.jsx routing changes (Vercel preview → Add to Home Screen → force-quit →
> reopen). Update `BUGS.md` (bugs resolved), `RPCS.md`, `GO_LIVE_ISSUES.md`, `CONTEXT.md`. Commit
> Phase 1 as its own unit; Phase 2 (tours) is next session.
