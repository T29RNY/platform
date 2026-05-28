# Pitch Booking — Cross-Session Handoff

*Purpose: one shared contract between the **booking session** (B2C casual pitch
booking, inside `apps/inorout`) and the **venue/league-module session**. Booking is
the second piece of casual↔venue connective tissue, so both sessions MUST build
against the same decisions. **No booking code is written until the five decisions
below are confirmed.***

Full booking plan: `~/.claude/plans/how-could-we-implement-streamed-pebble.md`
Phase 5 roadmap (for naming/scope alignment): `~/.claude/plans/continuing-phase-3-of-steady-falcon.md`

---

## What's being built

1. **B2C casual pitch booking** — casual teams book a real pitch at an opted-in
   venue. Two modes: **block** (recurring standing slot, set once, aligned to the
   team's existing weekly schedule) and **ad-hoc** (find a free slot for a one-off
   date). Discovery = typeahead over opted-in venues, rendered `"Venue Name — City"`,
   OSM free-text fallback so non-booking casual teams are unaffected.
2. **Unified occupancy guard** — one DB-level guarantee that a casual booking and a
   competitive fixture can never double-book the same pitch+time (maintenance blocks
   both). Competitive keeps operator-assigned pitches — **no competitive booking UI.**

Payment is **OFF but schema-wired** (`amount_pence` + `payment_status` default
`not_required`, no Stripe this round).

---

## Grounding facts (read live schema, not scope docs)

- Table is **`playing_areas`**, not `pitches` (multi-sport rename). Real columns:
  `id, venue_id, name, surface, capacity, active, sort_order, created_at`
  (`055_phase1_new_tables.sql:132`) **+ `is_available` boolean + `maintenance_windows`
  jsonb** (`083:134`).
- **Booking is net-new** — zero "booking" references exist. The only related thing is
  `venue_assign_pitch(p_venue_token, p_fixture_id, p_playing_area_id)` (mig 094 →
  current live mig 109): an admin assigning a pitch to an existing fixture. Not a
  reservation.
- `venue_admins(venue_id, user_id uuid → auth.users, role)` **already exists** (Phase
  1, currently unused). `resolve_venue_caller` **already accepts `auth.uid()`**.
- `league_config.match_duration_mins` exists (default 40) — fixture durations are
  derivable.
- `notify_venue_change` is a reason-whitelist that silently regressed once (mig 121
  shrank 26→3, fixed mig 127). Any new reason MUST be added explicitly + have a
  matching client subscriber (hard-rule #10).

---

## The five decisions to confirm

### 1. Conflict model — THE load-bearing decision. Pick ONE; both sessions build it.
- **(A) Recommended:** shared `pitch_occupancy` table + Postgres `EXCLUDE` (GiST)
  constraint. Fixtures, bookings, and maintenance all insert occupancy rows; any
  overlap on a pitch is rejected at the DB regardless of source. Handles variable
  durations + arbitrary windows; makes fixtures↔bookings mutually exclusive with no
  two-way checks. Cost: `btree_gist` extension + one-time backfill of existing
  allocated fixtures into occupancy.
- **(B) Lighter:** per-RPC unique/serialized check. Then `venue_assign_pitch` must
  ALSO check bookings, and the booking RPC must check fixtures — a two-way check both
  sessions keep in sync forever.

> If (B) wins, the booking plan drops `pitch_occupancy` and adds the two-way checks.

### 2. Availability primitive.
`maintenance_windows` + `is_available` express **un**availability only. Decide what
"bookable" means:
- **(A)** "any hour not occupied and not under maintenance" → booking adds **no**
  availability table (simpler).
- **(B)** explicit per-pitch bookable hours → booking adds a small `pitch_availability`
  table (day_of_week, open/close, slot_minutes).

> Either way booking MUST respect `maintenance_windows` + `is_available`.

### 3. Venue-side auth migration.
The operator decided to move the venue/league module from URL-token to **real
email-OTP accounts** (reuse inorout's `auth.uid()`). Because `venue_admins` exists and
`resolve_venue_caller` already accepts `auth.uid()`, this is a **one-function patch**:
add a `venue_admins` resolution stage, **keep the URL token as fallback** (live
dashboards depend on it; deprecate later). The venue session must confirm this doesn't
conflict with anything it's building.

> Separate concern: a casual booking authorizes via the **casual team-admin's**
> identity, deriving venue/team server-side — never trusting a client-passed id
> (RLS CHECKLIST). This is independent of who logs into `apps/venue`.

### 4. Migration numbering.
Phase 5 reserves migs **128–133**; repo head ≈ **132**. Both sessions take the next
free number **at commit time** — never hard-code. (Booking plan's 133–142 are
placeholders.)

### 5. Block-booking shape.
Materialise **N weekly `pitch_bookings` rows under a `booking_series` parent** (mirrors
`venue_generate_fixtures` bulk-insert + single audit row), **not** a virtual recurrence
rule — the DB guard needs concrete rows to reject overlaps, and operators must
see/cancel individual weeks.

---

## Shared principles (true under any decision above)

- **Occupancy is the single source of truth.**
- **No client-passed id is ever trusted** — resolve caller + derive venue/team
  server-side.
- Every booking write follows the **`venue_assign_pitch` pattern bone-for-bone**:
  SECURITY DEFINER, caller resolved server-side, target validated against the caller's
  venue, `audit_events` insert (Phase 2 shape: `team_id, actor_user_id, actor_type,
  actor_identifier, action, entity_type, entity_id, metadata`), `notify_venue_change`
  broadcast with an **explicitly-whitelisted** reason + matching client subscriber,
  returns jsonb.
- Forward consumers (e.g. a future venue calendar view) recorded in **RPCS.md Notes**
  per hard-rule #14.
- Gates: this is the same risk class as Phase 5 → `casual-regression.md`,
  `ephemeral-verify.md` (new write RPCs), `rpc-security-sweep.md` all mandatory.
- Unlike Phase 5 (render-gated behind `is_competitive`), booking **deliberately changes
  the casual flow** (`ScheduleScreen` venue field). It cannot hide behind a flag —
  `casual-regression.md` is the load-bearing test.

---

## Answers — LOCKED (confirmed by the venue session)

> **Venue session reviewed 2026-05-28** — all five choices + the data contract match
> the venue module. Three flags raised in Notes below (rows 1, 2, 3). None block; all
> are "tighten the contract before the trigger is written."

| # | Decision | Choice | Notes |
|---|---|---|---|
| 1 | Conflict model | **A — shared `pitch_occupancy` + DB `EXCLUDE`** | Existing fixtures fed in via a **trigger on the fixtures path** (accepted cost). Regression + ephemeral-verify mandatory. **⚠ VENUE FLAG (status):** mirror trigger must project only pitch-holding statuses (`scheduled`/`allocated`/`in_progress`/`completed`) and EXCLUDE `postponed`/`void`/`walkover`/`forfeit` — those release the pitch, so "every pitched fixture" (contract §2) would wrongly keep blocking a freed slot. Trigger must fire on UPDATE-of-status to delete the occupancy row when a fixture moves to a released status. |
| 2 | Availability primitive | **A — occupancy + maintenance only** | No opening-hours table in v1. `pitch_availability` dropped. **⚠ VENUE FLAG (window ≠ play time):** `league_config.match_duration_mins` default **40** is *play* time; `league_config` has **no slot/half-time/changeover/buffer field** (verified). A pitch is tied up longer than 40 min, so `kickoff + 40` would expose the real changeover gap between back-to-back fixtures as bookable. Decide fixture occupancy length before the trigger — a per-league slot/buffer column or kickoff-to-next-kickoff — not raw `match_duration_mins`. |
| 3 | Venue auth | **Descoped from booking** | Booking ownership rides the casual login (`auth.uid()` → `team_admins`); venue treated as data. ✅ Confirmed venue-session scope, decoupled from booking. **⚠ VENUE FLAG (size):** decision-3 body frames it as a "one-function patch (`venue_admins` resolution stage + token fallback)" — that's the resolver half only. Operator wants **username/password OR email-OTP, desktop + mobile**: account creation, password reset, OTP delivery, sessions, login UI = a full auth-UX cycle. Booking unaffected; flagging so the venue side isn't under-scoped. |
| 4 | Migration numbering | **Next free = 133** | 128–132 taken; not zero-padded; take-at-commit. |
| 5 | Block-booking | **Series parent + concrete weekly rows** | Mirrors `venue_generate_fixtures`. |

## Locked data contract (both sessions build to this)
- Tables: **`pitch_occupancy`** (the single source of truth; GiST `EXCLUDE` on
  `playing_area_id` + `time_range` overlap), **`pitch_bookings`**, **`booking_series`**.
  No `pitch_availability`.
- **Fixture-mirror trigger** on `fixtures` projects every pitched fixture into
  `pitch_occupancy`. Fixtures **store start-only**; end-time computed from
  `league_config.match_duration_mins`. Use half-open `[)` ranges.
- Booking auth: casual `auth.uid()` → `team_admins`; never trust a client-passed id.
- Every booking write follows the `venue_assign_pitch` pattern (SECURITY DEFINER,
  `audit_events` Phase-2 shape, `notify_venue_change` with an explicitly-whitelisted
  reason + matching subscriber, returns jsonb). Forward consumers in RPCS.md Notes.
- Gates: `casual-regression.md`, `ephemeral-verify.md`, `rpc-security-sweep.md`.

---

## Update — booking lifecycle, priority & notifications (2026-05-28, booking session)

**Lifecycle:** every booking is **requested → confirmed** by the venue (both block and
ad-hoc); slot **held on request** (occupancy `active`, status `requested`) so no
double-request. Other statuses: `declined`, `cancelled`, `superseded`, `expired`.

**Priority: league fixtures > block bookings > ad-hoc.** `pitch_occupancy` gains a
`priority smallint` (1/2/3). A higher-priority claim can **displace** a lower one.
Block series nearing its end is **held for that team to confirm an extension** (right
of first refusal) before the slot reopens.

**Notifications:** in-app status (`notify_team_change` new reasons) + **push**
(`apps/inorout/api/notify.js`) ship now; **email deferred to Phase 9** (no
transactional sender exists) — RPCs emit the event so email attaches later.

## NEW asks for the venue session (please action / confirm)

| Ask | What | Blocks |
|---|---|---|
| **(a)** | Add **`league_config.slot_minutes`** (default **60**) + an easy per-fixture / per-booking override by venue staff. Occupancy length uses this, **not** `match_duration_mins` (Flag 2). | **Cycle 1 trigger** |
| **(b)** | **Contract change:** the fixture-mirror trigger must **bump** lower-priority booking occupancy (set `active=false`, mark `pitch_bookings.status='superseded'`, notify) when a fixture claims a held slot — not merely be rejected by `EXCLUDE`. Revises "EXCLUDE rejects all overlaps". | **Cycle 1 trigger** |
| **(c)** | A venue **short code** for code-entry discovery — or confirm we reuse `venues.slug`. | Cycle 2 |
| **(d)** | **`cancellation_policy`** text on `venues`, shown on the booking confirm screen. | Cycle 3 (graceful fallback exists) |
| **(e)** | Confirm the **`bookings_enabled`** opt-in flag lives venue-side. | Cycle 2 |

Flags 1–3 from the venue review are folded into the booking plan (status-filtered
trigger, `slot_minutes`, auth-cycle sizing noted). Asks (a) and (b) are on Cycle 1's
critical path — booking can't start the occupancy trigger until both are settled.
