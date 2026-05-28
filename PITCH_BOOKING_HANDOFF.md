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

## Answers (fill in from the venue session)

| # | Decision | Choice | Notes |
|---|---|---|---|
| 1 | Conflict model | _A / B_ | |
| 2 | Availability primitive | _A / B_ | |
| 3 | Venue auth migration acknowledged | _yes / no_ | |
| 4 | Migration numbering convention agreed | _yes / no_ | |
| 5 | Block-booking = materialised series | _yes / no_ | |
