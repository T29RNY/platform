# Modular Platform — Packaging, FA Fixtures, Public Web, Ref-as-Module

*Scoped 2026-06-22 (session 174). Strategy thread off the GNP Sports FC target + Pitchero/MyClubPro
competitor review. NOT YET BUILT — this is the plan of record. Read STRATEGY.md competitor section
alongside this.*

---

## WHY

Two Pitchero-incumbent targets (the pilot club + GNP Sports FC) keep surfacing the same picture:
the incumbents (Pitchero, MyClubPro £12–29/mo) own **club website + FA Full-Time fixture feed +
registration/payments** — the commodity layer. Neither does **match-day operations** (availability,
squad selection, POTM, reliability), casual, or proper tournaments. That gap is our moat.

Decision: **don't out-Pitchero Pitchero on the website.** Make the platform **modular** — a Basic
match-day core that's always on, plus features a club can switch on/off — and use the FA fixture
feed not as a noticeboard but as a **trigger into our match-day engine** (auto-create match →
auto-open availability), which no incumbent can do because they have no engine to feed.

---

## EPIC A — Modular feature system (`club_features`) — FOUNDATION, BUILD FIRST

**Goal:** per-club on/off features gated consistently at THREE layers (nav + route + RPC), with a
dependency graph and a package layer on top.

**Why three layers:** today (audited s174) hiding a nav item does NOT disable a feature — the
routes (`/sessions`, `/classes`, `/book`, `/tournament/<slug>`) and their RPCs stay reachable by
deep-link, gated only by data/RLS. A real toggle must gate nav (UI) + route (client) + RPC (server).
The "hidden-but-still-reachable" trap is the #1 risk this epic exists to fix.

**What exists today (don't rebuild):**
- `clubs.discipline` pick-list (football/gym/boxing/martial_arts/yoga/dance/fitness/other) →
  `getDisciplineLabels()` (apps/inorout/src/lib/disciplineLabels.js) cleanly gates Classes/PT/
  grading/fight-record. Coherent vertical gating — but it's a BUNDLE (can't have gym without PT).
- **Equipment hire = the gold-standard pattern.** Zero-footprint: no hireable spaces → nothing
  renders, no nav, no dead route. Copy this shape.
- **Feature-flag precedent already shipped:** `teams.multi_context_nav` boolean +
  `get_team_feature_flags()` RPC + `getTeamFeatureFlags()` wrapper (mig 351), read in App.jsx.
  Extend THIS pattern — don't invent a new one.

**Scope:**
- `club_features` fine-grained per-club flags (memberships, payments, tournaments, equipment_hire,
  public_web, coaching, league_fixtures, ref…). Flags are the source of truth.
- **Dependency graph** — enabling a feature auto-enables prerequisites and BLOCKS unsafe disables.
  Edges: Memberships→Payments; Coaching→Memberships(→Payments); paid Tournaments→Payments.
- **Package layer** = named presets (Basic + add-ons) that expand to a flag set. Packages are
  shortcuts; flags are truth. So tiers-vs-pick-and-mix is just a presentation layer — DEFER that
  commercial decision; it changes nothing in the data model. **Avoid the trap:** do NOT model
  tiers as a single `tier` enum column with hardcoded behaviour — that breaks the first time a club
  wants "Pro minus tournaments."
- **Two orthogonal axes:** discipline (what sport) × packages (what they bought). Keep separate.
  Discipline decides which features are *relevant*; packages decide which are *purchased*.
- Operator UI in the venue console to flip features/packages per club.
- **DEFAULT EVERY FLAG ON for existing clubs** → purely additive, zero regression on ship day.
  Turning off is opt-in per club.

**Recommendation:** pick-and-mix flags underneath, named tiers as presets on top. Don't lock a tier
structure before the pilot tells you what clubs actually bundle.

**Sizing:** ~3–4 build sessions (schema + flag plumbing through core, retrofit 3-layer gate onto
memberships + tournaments, operator UI).

---

## EPIC B — Public Web module + league fixtures (provider model)

**Goal:** lightweight public club page (the "front door to the engine") + FA fixtures/results/table.

**Key strategy distinction (from the thread):**
- Live FA results **as a website** = commodity, table stakes, two cheaper rivals already own it.
  LOW strategic value. Build only the cheap 80% (branded page + fixtures/results/table + teams);
  do NOT chase the expensive 20% (news CMS, media galleries, per-club theming) — that's *becoming*
  Pitchero. Build CMS slices only when a pilot club demands them.
- Live FA fixtures **as a trigger** into auto-create-match → auto-open-availability = HIGH value,
  unique to us. Same data, opposite strategic outcome. This is the real prize.

**FA Full-Time access — settled facts (don't relitigate):**
- There is **NO self-serve, priced FA API.** The official partner integration (what Pitchero has)
  has sat "Deferred" on the FA's own forum 4+ years — gated, no published price/process. Do NOT
  build a strategy on getting it.
- **Route we use = club-admin Full-Time Feeds/Code Snippets (FREE).** A club/league admin generates
  it (Full-Time → Media → Code Snippets). Two forms:
  - **Iframe/embed (display-only)** — their styled box, can't reshape, can't reuse the data.
  - **Season ID + Group ID feed (structured)** — pull raw fixtures/results ourselves, render in our
    own layout AND feed the match-day engine. THIS is option 2, the one we want.
- ⚠️ VERIFY before relying: confirm the target club's league exposes the Season/Group ID feed form
  (not just the locked iframe) — that's what makes "it's just layout" true vs reskinning their box.

**How we stack up on FA sync once option 2 ships:** parity on the *visible output* (all three read
from Full-Time); slightly behind on *plumbing* (theirs is official/zero-touch, ours is DIY with a
maintenance tail — we own the pipe if the FA changes format). But we LEAPFROG the moment the fixture
*does something* — auto-creates the match and opens availability. Pitch it as "your fixtures flow
into your match day," NOT "we have FA sync too."

**Scope:**
- Branded public club page: badge/colours, teams, sponsors, fixtures/results/table.
- **`league_fixtures` capability as a PLUGGABLE PROVIDER** — FA Full-Time = adapter #1; cricket
  (ECB Play-Cricket), hockey, rugby follow later without rework. Don't hardcode "FA"; use a
  `provider` field.
- Structured ingest (not iframe) → fixtures become rows in our DB (Epic C depends on this).
- Gated behind the `public_web` flag from Epic A.

**Depends on:** Epic A (the flag). Ingest can be prototyped in parallel.

**Risk:** the DIY feed maintenance tail (we own the pipe).

**Sizing:** ~3–5 sessions.

---

## EPIC C — FA-fixture → ref-assignment loop (+ RefSix-parity ref tools)

**Goal:** ingested FA fixtures can carry a referee, surfaced in the ref view + watch as the ref's
companion.

**Mechanism:** ingested fixtures (Epic B) attach to the existing **official arm**
(`match_officials`, `ref_link_self_to_official` self-claim + `venue_link_official_to_user`
operator-bind, mig 369). Ref opens app/watch → assigned games already there
(`get_my_next_assignment`). Companion tools on the working copy.

**HONEST BOUNDARY:** the FA feed is read-only; there is no documented write-back. FA league refs are
appointed by county FAs and official results go to Full-Time, NOT us. So we are the ref's **working
tool + the club's record**, exactly like RefSix — NOT the official result channel. Don't promise
write-back. (If the partner API ever lands, we could push results — future bonus only.)

**Ref is a STANDALONE module (audited s174):** a referee can use `apps/ref`
(platform-ref.vercel.app, fully independent deployment) with ZERO squad/club/membership. The
LEAGUE/OFFICIAL arm works standalone — `match_officials` references only a venue, no team/club FK;
ref enters by token (`get_fixture_state_by_ref_token`, no account) or self-claims an identity. The
CASUAL arm requires being a squad player (reuses `players.user_id`) — but a standalone external ref
wouldn't use that path. **Nuance:** standalone *usage* ≠ self-serve onboarding from zero — a
venue/league must still create the `match_officials` card (refs are appointed, not self-spawned;
this is correct, and mirrors RefSix importing appointments). → **"Ref" can be sold/enabled fully
independently of the club features.**

**RefSix-parity decisions (operator-locked 2026-06-22 — also in [[project_watchos_companion]]):**
- Competitor RefSix: freemium (free + PRO sub), watch-first, multi-watch, mature analytics. Pulls
  ref *appointments* in from association software; no confirmed result push-back to FA.
- **(1) GPS heatmap + distance + sprint %/speed → MATCH IT.** On-watch GPS+motion capture (same
  recipe as fitness apps; their "more accurate" = smoothing, no special hw). Bolts onto the Phase-4
  Outdoor-Football/HR workout already planned. ⚠️ test 90-min continuous-GPS battery drain on Apple
  Watch; store the track; heatmap UI.
- **(2) Video analysis → DO IT (build).** USER uploads own footage; we sync to our timestamped event
  log (jump-to-moment). We don't capture video. Cost = storage/bandwidth + sync/review UI.
- **(3) Multi-watch (Garmin Connect IQ / Samsung / WearOS) → DEFER (not killed).** Each = a separate
  native codebase. Stay ONE Apple-Watch-only target by design. Pitch INTEGRATION, not watch-breadth.
- Cheap wins to add to ref view: **sin-bins w/ return alerts + auto match reports** (cards→player+
  reason→report). RefSix has them; refs expect them.

**Depends on:** Epic B (fixtures must be rows before a ref attaches).

**Risk:** ref-arm detail is from mig-369 memory — short audit to confirm `match_officials` /
`get_my_next_assignment` shape against live code before build.

**Sizing:** ~2–4 sessions.

---

## SEQUENCING

A → B → C. Each shipped and merged before the next (cloud-session discipline — one session
start-to-finish). A is the prerequisite for everything; B feeds C. Run feature-plan skill against
live code on each epic before any edits — start by confirming the stale bits (ref arm shape, the
FA feed format for the target club's league).
