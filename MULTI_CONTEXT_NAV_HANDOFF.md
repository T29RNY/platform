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
