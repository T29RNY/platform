# Design Brief — Mobile Operator League Surface (`/hub`, In or Out)

**For:** Claude Design · **From:** build/product · **Date:** 2026-07-18
**Autonomy:** Claude Design owns all design and creative decisions — IA, layout,
interaction, motion, visual identity. This brief supplies only the *functional* and
*technical* constraints the design must live inside. Where this brief is silent, decide.

---

## 1. The one-paragraph goal

In or Out is a sports-venue operating platform. A **venue operator** (e.g. Joe, who runs
"Pitchbox Arena") runs their facility from two surfaces: a **desktop console** (`apps/venue`,
at venue.in-or-out.com) and a **native iOS phone app** (`apps/inorout`, the `/hub`). The
desktop console has a full **internal-league toolkit** — create a season, generate fixtures,
a live table, per-fixture actions (enter/correct a score, postpone/void, assign pitch + ref),
and cups/brackets. **The phone app has none of this for the operator.** Design the **mobile
operator league surface** so an operator can run their own league from their phone.

This is net-new mobile UI. The data already exists and is shared — a score entered anywhere
appears everywhere instantly (see §6). The gap is purely that these operator functions have
no phone screens.

---

## 2. Who this is for (and who it is NOT)

- **IN SCOPE — the OPERATOR (venue) persona only.** The person who owns/runs the venue and
  organises its own competitions. On mobile they are the "operator" hat; their tabs today are
  **Tonight · Bookings · Payments · People · More**.
- **OUT OF SCOPE — do not redesign these; they already exist on mobile:** the *team manager*
  league + matchday view (`TeamManagerLeague` / `TeamManagerMatchday`), the *guardian* league
  view (`GuardianLeague`), the *referee* live-scoring flow (`RefFixtures` → `RefMatch`), and
  the *Event OS tournament* surface (`OperatorTournaments` / `TournamentView`). Reference them
  for pattern consistency, but this brief is the operator's own **internal league** only.

**Note — two different "leagues" exist; this is System A.** "System A" = the venue's own
internal league (`fixtures` table, operator-organised). "System B" = a club team's own
fixtures (`club_fixtures`, e.g. their FA grassroots league) — the operator already manages
those elsewhere. **Design for System A.**

---

## 3. What the operator must be able to do (functional requirements)

Translate the desktop toolkit to the phone. Priority order:

**Must-have (the core loop):**
1. **See their league(s) / current season** — pick a league/season/competition.
2. **Fixtures list** — grouped by round or date; each fixture shows both team names, kickoff
   date/time, pitch, referee, score (if played), and a **status** (scheduled / allocated /
   in-progress / completed / postponed / void / walkover / forfeit).
3. **Live league table / standings** — Position, Played, W, D, L, GF, GA, GD, Points.
4. **Enter a result** on a played fixture that has no live-scoring referee — *this is the new
   capability the whole surface hangs off*. The operator types the final score and it becomes
   "completed". (Available only when the fixture is `scheduled`/`allocated`.)
5. **Correct a result** on an already-completed fixture (final score was wrong).

**Should-have (rounds out "run my league from my phone"):**
6. **Set a fixture's status** — postpone, void, walkover, forfeit.
7. **Assign a pitch** and **assign a referee** to a fixture (+ copy/share the referee's
   live-scoring link).
8. **Cups / knockout** view for a season that has a cup — group tables + a knockout bracket
   (read; scheduling a tie is a nice-to-have).

**Your call (heavier / defer-able):**
9. **Create a season / generate fixtures.** On desktop this is a 5-step wizard (basics →
   competitions → teams → preview → confirm) with a fixture-preview step. Decide whether a
   phone version is worth it now, a trimmed "quick season" flow, or a clean "set this up on
   the desktop console" hand-off. No wrong answer — tell us which and why.

---

## 4. Where it lives (navigation)

The operator's mobile tabs are **Tonight · Bookings · Payments · People · More**. The existing
precedent is that competition surfaces (the Event OS "Cups"/tournaments) hang off **More**.
A **"League" (or "Competition") entry under More** is the low-friction placement — but if you
believe leagues deserve a first-class tab or a different structure, propose it and say why.
Deep-links / a "tonight's fixtures need a result" nudge on the **Tonight** tab are welcome.

---

## 5. Design system & platform constraints (hard)

The design must be buildable in the existing system — please honour these so the handoff is
build-ready without re-litigation:

- **Type:** Bebas Neue for headings and numbers (scores, table figures); DM Sans 400 for body.
- **Colour:** CSS variables from the token system only (`tokens.css` / `mobile-tokens.css`).
  The **only** two hard-coded hex values permitted are the team colours **#60A0FF (Team A / home)**
  and **#FF6060 (Team B / away)**. Everything else is a token. (There is a `--warn` red token for
  medical/critical; use tokens, not raw hex.)
- **Icons:** Phosphor, `weight="thin"` throughout. A *narrow* exception allows `weight="fill"`
  only for warning / star / active-tab / badge glyphs (must be tagged for the hygiene gate).
- **Copy:** "Results" (not "History"), "POTM" (not "MOTM"), if those appear.
- **Mobile shell:** the app uses a shared `MobileShell` + a **docked bottom nav**. Modals/forms
  use **`MobileSheet`**, which **portals to a root host (`#m-sheet-host`)** so it sits above the
  nav — never a hand-rolled fixed overlay inside a screen. Forms use a **scrollable body with a
  pinned footer** action button. List rows are **tappable → open a detail sheet**. Glance/stat
  tiles are **tappable** (jump/scroll/filter).
- **iOS stacking is a known trap** — sheets must portal and must clear the docked nav; bottom
  content must not bleed behind it. Design with a docked nav always present.
- **Native iOS only** (no PWA / web-install). Design for iPhone; a real-device walk is required
  before ship.

---

## 6. The data contract (reuse it 1:1 — do not invent new data)

Every field the design shows already exists behind a shared data layer used by the desktop
console. **Reuse the same records/fields/enums** — the design should not require net-new data
shapes. The build side will wire the exact calls; you design against these available fields:

- **Fixtures** (the `fixtures` record): home team name, away team name, `home_score`,
  `away_score`, `status` (`scheduled` / `allocated` / `in_progress` / `completed` /
  `postponed` / `void` / `walkover` / `forfeit`), round number / round name, scheduled date,
  kickoff time, pitch name, referee. Read today via the operator's venue state.
- **Standings** (live-computed, no stored table): team name, Played, W, D, L, GF, GA, GD, Points.
- **Result entry:** `venue_enter_fixture_result` (new — sets score + marks completed) and
  `venue_update_fixture_result` (correct a completed one).
- **Status / logistics:** `venue_update_fixture_status` (postpone/void/walkover/forfeit),
  assign pitch, assign referee.
- **Fixture generation:** `venue_generate_fixtures` (from the season wizard).
- **Cups:** group tables + a knockout bracket reader.

**Closest existing interaction to borrow from:** the team-manager phone matchday screen already
lets a *manager* type a final score on a fixture — the same core "score entry on a phone"
interaction, just for a different persona. Worth looking at for the score-entry ergonomics
(big tap targets, home/away colour cue), then making it the operator's own.

---

## 7. Sync note (so the design is grounded, not aspirational)

Desktop and phone read/write **the same database row**, and the league table is **computed live
from results** (no stored copy, no cascade). So a result the operator enters on the phone appears
instantly in: the public standings, players' apps, managers' views, and the desktop console — and
vice-versa. You are not designing a second copy of the data; you are designing the phone's
**window** onto the one shared league. This is why the surface can be as thin or as full as the
design argues for without any sync risk.

---

## 8. Deliverable (so it slots into the build pipeline)

Please deliver in the repo's established design-handoff shape: a
**`design_handoff_operator_league/`** directory containing:

- **`README.md`** — the design rationale, IA/navigation decision, screen inventory, and a
  **per-screen data-contract mapping** (which fields/§6 functions each screen uses), plus your
  §3.9 decision (season-create on mobile: build / trim / defer-to-desktop) with reasoning.
- **One `.dc.html` mock per screen/state** (index, fixtures list, fixture detail + actions,
  enter-result sheet, correct-result sheet, standings, cups/bracket, empty states) — using the
  token system, Bebas/DM Sans, Phosphor-thin, docked-nav-aware layout, and the two team hexes
  only where a team colour is meant.
- **Interaction + motion notes** and a **component list** (reuse `MobileSheet`, tappable rows,
  pinned-footer forms, stat tiles).

Full creative autonomy on everything visual and interactive within those constraints. If any
functional requirement in §3 fights the best design, say so and propose the better shape — this
is a genuine two-way brief.

---

## 9. One-line summary to design against

> *"Give a venue operator a beautiful, phone-native way to run their own league on the go —
> see the table, work through the fixtures, and record results — reusing the exact league data
> the desktop console already runs on."*

---

## 10. What `/hub` is + the operator's existing world (context you asked for)

**What `/hub` is.** In or Out ships as a **native iOS app** (a Capacitor WKWebView pointed at
`app.in-or-out.com` — so frontend changes reach users through the web bundle with no rebuild).
It is a **single multi-role app**: one account can hold several "hats" — casual player, league
player, **operator (venue)**, club-admin, team manager (coach), guardian (parent), referee — and
an **entity-first profile switcher** (one row per venue / club / team, with a role pill in the
header) moves between them. Hub-hat users land on `/hub`.

**The operator hat's nav today** is a **docked bottom bar**: **Tonight · Bookings · Payments ·
People · More** (a reception/staff variant drops Payments/Setup):
- **Tonight** — tonight's fixtures + day-ops; fixtures render read-only (scores shown, not edited).
- **Bookings** — pitch bookings (a calendar/list).
- **Payments** — charges: owed / collected / outstanding.
- **People** — members + staff directory; **rows are tappable → a detail sheet**.
- **More** — a launcher for secondary surfaces (e.g. Event OS **Cups/tournaments**, Setup).

**Shell idioms to reuse** (these are the house style — match them): `MobileShell` + the docked
nav; **`MobileSheet`** for every modal/form (it **portals to `#m-sheet-host`** so it sits above
the nav); **tappable list rows → detail sheet**; **tappable stat/glance tiles** (jump / scroll /
filter); forms are a **scrollable sheet body with a pinned-footer** action button.

**Where LEAGUE fits in the product.** In or Out's core primitive is **availability** ("in or
out"). Competitions come in **two modes**: **leagues** (recurring round-robin + cups — System A,
what you're designing for) and **tournaments** (Event OS brackets). The **desktop console runs the
full league toolkit**; the phone is meant to be its **on-the-go companion**. Today, on mobile,
league/competition appears **only for other hats** — the **referee** (live-scoring), the **team
manager** (their own team's fixtures + a matchday score entry), and the **guardian** (read-only) —
plus **Event OS tournaments already have an operator surface under More → Cups**. So the operator's
*own league* is the one competition surface missing on the phone, and the natural home is **under
More, alongside Cups**, using the same shell idioms.

---

## 11. What each fixture status DOES (drives your fixture-detail UI)

A league fixture moves through these statuses. What each does to the **score** and the **table**
(the table is computed live — `completed`/`walkover`/`forfeit` count, others don't):

| Status | Score | Table effect | What the UI collects |
|---|---|---|---|
| `scheduled` / `allocated` | none yet | not counted (pre-play) | — (this is the **"Enter result"** target) |
| `completed` | **literal** home–away scoreline | W/D/L derived from the scoreline | **the two scores** (the new "Enter result", and "Edit score" to correct) |
| `postponed` | none | **excluded** — still to be replayed | a **reason** (fixture is NOT terminal; it awaits a reschedule) |
| `void` | none | **excluded entirely**, as if it never happened | a **reason** (abandoned/cancelled — no result at all) |
| `walkover` | **none written** — table awards **3–0 to the winner** | winner: W, +3 GF, 3 pts · loser: L, 0–3 | **a winner** (a team, not a score — the 3–0 is synthesised) |
| `forfeit` | **none written** — table awards **3–0 to the winner** | same as walkover | **a winner + a reason** |

**UI implications (important):**
- **Walkover / forfeit collect a WINNER, not a scoreline** — the 3–0 is synthesised by the table.
  Never show a score-entry box for these; show a "who won by default" picker.
- **Postpone / void collect a REASON, no score** — and the fixture **leaves the table** (void
  permanently; postponed pending a replay).
- **Forfeit is the only status that can be applied to an already-`completed` fixture** — a
  post-result reversal (eligibility/misconduct), overturning a played result to a 3–0.
- All four of these transitions **already exist on desktop** (the `•••` menu on a fixture), with
  per-status validation (reason required for postpone/void/forfeit; winner required for
  walkover/forfeit). Mirror the same transitions + rules on mobile — same data contract, one
  record. Entering a normal **`completed`** result is the *net-new* capability (RPC
  `venue_enter_fixture_result`, shipping alongside this design).
