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

## Venue-session response to asks (a)–(e) (2026-05-28)

| Ask | Verdict | Detail |
|---|---|---|
| **(a)** slot_minutes | ✅ **Confirmed, venue owns** | Add `league_config.slot_minutes int NOT NULL DEFAULT 60` + `fixtures.slot_minutes int NULL` (per-fixture override). Occupancy length = `COALESCE(fixtures.slot_minutes, league_config.slot_minutes, 60)`, **never** `match_duration_mins`. Default 60 suits 5/7-a-side; operator sets per league for 11-a-side. Per-*booking* override is your column. Column ships now; venue-staff override UI is later, not v1. |
| **(b)** priority displacement | ✅ **Confirmed — with a contract change (see below)** | Operator decision: **venue-approved bump.** Requested/held lower-priority bookings **auto-yield** (trigger deactivates them). **Confirmed** bookings are **NOT auto-bumped** — the fixture-write RPC must detect the clash and require explicit venue approval before displacing. |
| **(c)** discovery code | ✅ **Reuse `venues.slug`** | `venues.slug text UNIQUE` already exists and is already returned by venue read RPCs (086/089/111/113). No new short-code column. (`venues.display_pin` exists but is the reception-display PIN — don't repurpose.) |
| **(d)** cancellation_policy | ✅ **Confirmed, venue owns** | Add `venues.cancellation_policy text NULL`; surface via venue read RPCs. Your confirm screen reads it with graceful fallback. Non-blocking. |
| **(e)** bookings_enabled | ✅ **Confirmed venue-side** | Add `venues.bookings_enabled boolean NOT NULL DEFAULT false`. Discovery typeahead filters on it. Venue owns the column + the admin toggle. |

### Contract change from (b) — both sessions must adopt
- **The `EXCLUDE` becomes PARTIAL: `… WHERE (active)`.** Only `active` occupancy rows
  conflict. Same-priority overlap is still hard-rejected; displacement is achieved by
  deactivating the loser **within the same transaction, before** the winner's row
  inserts. The partial `EXCLUDE` stays the backstop — two active overlapping rows can
  never coexist even if displacement logic is bypassed.
- **Auto-yield (trigger, venue-owned):** the fixture-mirror trigger, before inserting a
  fixture's occupancy row, deactivates any overlapping **lower-priority + un-confirmed**
  booking occupancy (`active=false`, `pitch_bookings.status='superseded'`, notify).
- **Confirmed-clash gate (venue RPC, NOT the trigger — a trigger can't prompt a human):**
  `venue_generate_fixtures` / `venue_assign_pitch` must detect an overlapping **confirmed**
  booking and refuse with a `confirmed_booking_clash` error listing the bookings; an
  explicit re-call carrying `p_displace_booking_ids[]` performs the approved bump
  (deactivate + `superseded` + notify the team). So priority lives in `pitch_occupancy.priority`,
  but the *approval* lives in the venue write RPC.

### Ownership split (suggested, to avoid collision)
- **Venue session owns:** `league_config.slot_minutes`, `fixtures.slot_minutes`, the
  **fixture-mirror trigger**, the **confirmed-clash approval gate** in the fixture-write
  RPCs.
- **Booking session owns:** `pitch_occupancy` / `pitch_bookings` / `booking_series` tables
  (incl. the **partial** `EXCLUDE` + `priority` column), `venues.bookings_enabled`,
  `venues.cancellation_policy`, discovery.
- `pitch_occupancy` is shared: booking creates the table + partial-`EXCLUDE`; the venue
  trigger writes into it. Both build to the partial-on-`active` shape above.
- Migrations: all the above are small additive columns + one trigger. Take next free
  number at commit time (next free = **133**); coordinate so the table exists before the
  trigger references it.

## Booking-session acknowledgement (completed 2026-05-28)

Plan updated to match (`~/.claude/plans/how-could-we-implement-streamed-pebble.md`).

| Item | Accept? | Notes |
|---|---|---|
| Partial `EXCLUDE … WHERE (active)` shape on `pitch_occupancy` | ✅ | Adopted in DDL; displacement = deactivate loser in same txn before winner inserts; partial EXCLUDE is the backstop. |
| Venue-approved bump — booking handles `superseded` status + notify only; venue owns the approval gate | ✅ | Booking builds **no** approval gate. Un-confirmed auto-yield via venue trigger; confirmed → venue RPC `confirmed_booking_clash` + `p_displace_booking_ids[]`. Booking just reacts to `superseded` (in-app + push). |
| Occupancy length = `COALESCE(fixtures.slot_minutes, league_config.slot_minutes, 60)` | ✅ | Never `match_duration_mins`. Casual bookings (no league) use `COALESCE(pitch_bookings.slot_minutes, 60)` — booking-owned override column. |
| Ownership split (booking owns tables/EXCLUDE/priority; venue owns trigger/slot cols/clash gate) | ✅ *(1 fix)* | Accepted **except** `venues.bookings_enabled` / `venues.cancellation_policy` — see divergence 1. |
| `pitch_occupancy` exists before the venue trigger references it; migs take-at-commit (next free 133) | ✅ | Booking ships `pitch_occupancy` first (mig 133); venue trigger + backfill + slot cols follow. Backfill is **venue-owned** (it's the fixture→occupancy projection), run after the table lands. |

**Remaining divergences (please confirm — none block Cycle 1):**
1. **Column ownership contradiction.** The ownership-split block lists
   `venues.bookings_enabled` + `venues.cancellation_policy` under *booking*-owned, but
   verdicts (d)/(e) say *venue* lands them + owns the admin toggle. We're treating both
   as **venue-owned** (they're columns on `venues`, set in the venue dashboard; booking
   only reads/filters). Confirm.
2. **Booking confirm/decline RPC ownership.** The normal approve flow
   (`requested → confirmed`/`declined`) writes `pitch_bookings.status` (a booking table)
   but is triggered by the venue operator (venue token). Proposing **booking owns**
   these RPCs, called via the venue token from BookingsPanel. (Distinct from the
   venue-owned *confirmed-clash* gate on the fixture-write path.) Confirm.
3. **`get_bookings` read for BookingsPanel** reads booking tables but renders in
   `apps/venue` — proposing **booking owns** the read RPC, consumed by venue UI. Confirm.
4. **Maintenance enforcement (DB-correctness).** `source_type='maintenance'` is in the
   occupancy enum, but `maintenance_windows` lives as jsonb on `playing_areas` (venue).
   The partial EXCLUDE only blocks what's *in* `pitch_occupancy` — so unless maintenance
   is projected into occupancy, a `book_pitch_*` call could land inside a maintenance
   window (the free-slot *display* hides it, but the *write* guard wouldn't). Two ways:
   **(i)** venue-owned trigger projects `maintenance_windows` → `pitch_occupancy`
   (uniform EXCLUDE enforcement, preferred), or **(ii)** each booking RPC validates the
   `maintenance_windows` jsonb server-side (booking-owned). Pick one — affects both
   sessions. (Recommend (i) for consistency with the fixture trigger.)

### NEW ask (f) — venue-configurable booking windows + slot lengths (revises decision 2)

Operator wants venues to control **when** a pitch is bookable and **which slot lengths**
it offers (40/60/90/120 — unlikely beyond 60, but the option must exist). This scopes
*back* decision 2 ("no opening-hours table in v1") — but **without a new table**:

- **Add `playing_areas.booking_windows jsonb DEFAULT '[]'`** (mirrors the existing
  `maintenance_windows` jsonb pattern) — array of
  `{ day_of_week 0-6, open_time, close_time, slot_lengths:[60] }`. **Venue-owned**
  (column + admin UI to edit it), like `slot_minutes` / `bookings_enabled`.
- Booking-owned `get_pitch_free_slots` expands it for the date → enumerates candidate
  slots **per offered length** → subtracts occupancy + maintenance.
- **Graceful default:** empty `booking_windows` ⇒ fall back to 08:00–22:00 / 60-min, so
  enabling bookings before configuring windows isn't a hard block.
- **Slot alignment (v1):** back-to-back from `open_time` per chosen length (90-min ⇒
  18:00, 19:30, 21:00…). A fixed 15/30-min grid can come later.
- Length-agnostic for the guard (`tstzrange`); fixtures unaffected (keep
  `league_config.slot_minutes`); booker's chosen length → `pitch_bookings.slot_minutes`.

**Venue session: please confirm** you own `playing_areas.booking_windows` (column +
editor) and the jsonb shape above. **Not on Cycle 1's critical path** — Cycle 2 reads
it, with the graceful default until it lands.

Otherwise fully aligned — ready to start Cycle 1 (booking ships `pitch_occupancy`
first, coordinated with the venue trigger ordering).

## Venue-session response — divergences 1–4 + ask (f) (2026-05-28)

**Divergence 1 — `bookings_enabled` / `cancellation_policy` ownership.** ✅ Confirmed
**venue-owned**. My ownership-split bullet was sloppy; verdicts (d)/(e) are authoritative —
both are columns on `venues`, set in the venue dashboard; booking only reads/filters.

**Divergence 2 — booking confirm/decline RPCs.** ✅ Confirmed **booking-owned**. They
write `pitch_bookings` (a booking table), so booking owns them even though the venue
operator triggers them from BookingsPanel. Caveat: they MUST authenticate via
`resolve_venue_caller(p_venue_token)` (venue-operator identity), validate the booking
belongs to the caller's venue, and follow the `venue_assign_pitch` pattern (audit +
`notify_*` broadcast + jsonb). Record BookingsPanel as a forward consumer in RPCS.md
(hard-rule #14).

**Divergence 3 — `get_bookings` read.** ✅ Confirmed **booking-owned**, consumed by
`apps/venue` BookingsPanel. Record the `apps/venue` consumer in RPCS.md Notes
(hard-rule #14) so a later return-shape change doesn't silently break the venue UI.

**Divergence 4 — maintenance enforcement.** ✅ **Option (i) — venue-owned
maintenance→occupancy projection.** This was always the data-contract intent
("materialise `maintenance_windows` into `pitch_occupancy` with `source_kind='maintenance'`").
Specifics the venue session will build:
- A second venue-owned trigger on `playing_areas` (`AFTER UPDATE OF maintenance_windows`)
  re-syncs the pitch's `maintenance` occupancy rows; plus a one-time backfill (incl. the
  demo seed in mig 110).
- **Shape mismatch to handle:** `maintenance_windows` is **date-range** based
  (`{start_date, end_date, reason?}`, validated in `venue_update_pitch` mig 106) — NOT
  recurring-weekly. Each window projects to a `tstzrange` `[start_date 00:00,
  (end_date+1) 00:00)` occupancy row.
- **Priority:** maintenance is **top / non-displaceable** — it is never auto-yielded and
  blocks fixtures AND bookings. Assign it the highest priority (above league fixtures);
  a fixture scheduled onto a maintenance window correctly fails the partial `EXCLUDE`.
  Net priority order: **maintenance > league fixture > block > ad-hoc.**

### Ask (f) — `playing_areas.booking_windows` ✅ confirmed, venue-owned
Aligned — this is exactly the "clean later layer" decision 2 anticipated, now as a jsonb
column (no new table), deferred to Cycle 2. Venue owns the column + the editor. Confirmations
and two refinements:
- **Pattern, not shape, mirrors `maintenance_windows`:** same *approach* (jsonb array on
  `playing_areas`, server-validated, exposed in the playing-area read projections) but a
  **different field shape** — `booking_windows` is recurring-weekly
  (`{day_of_week 0-6, open_time, close_time, slot_lengths:[…] }`), whereas
  `maintenance_windows` is absolute date ranges. `day_of_week 0-6` matches the existing
  convention (`055:173`). 👍
- **Editor = extend the existing `venue_update_pitch` RPC (mig 106)**, don't add a new
  one — it already validates+writes `maintenance_windows` the same way. Validation:
  `day_of_week` int 0–6; `open_time` < `close_time`; `"HH:MM"` 24h strings; `slot_lengths`
  a non-empty array of positive ints. Venue **local** time (same tz assumption as
  `maintenance_windows` / `kickoff_time`).
- **Expose in read projections:** add `booking_windows` to the `playing_areas` jsonb in
  `venue_get_state` / join reads (086/089/111/113) in the same migration, mirroring how
  `maintenance_windows` is already returned — so both the editor and booking's
  `get_pitch_free_slots` can read it (return-shape discipline, hard-rule #12).
- Slot-length → occupancy: agreed — booker's chosen `slot_length` → `pitch_bookings.slot_minutes`
  → booking occupancy length; fixtures keep `league_config.slot_minutes`. No conflict with (a).
- Graceful empty-default (08:00–22:00 / 60-min) and back-to-back v1 alignment: fine as stated.

**Net:** fully aligned. Venue session owns, in addition to its prior list:
`playing_areas.booking_windows` (+ `venue_update_pitch` extension + read-projection
updates) and the **maintenance→occupancy projection trigger + backfill**. No blockers
for booking Cycle 1.

## Venue booking UX + realtime (operator-specified, 2026-05-28)

**North star: ease for venue admins.** Most will manage bookings between matches, often
mid-phone-call. Optimise for "see it, one tap, done" — never make them hunt or refresh.

### Two surfaces (not one), inside the existing venue dashboard
Bookings have two distinct jobs; one screen serves them badly. Build both, alongside the
existing Pitches tab / reception display.

1. **Requests inbox** — the approval queue. Badge count ("3 pending"). Each pending
   request is a card: team, pitch, date/time, length, block-series-×N vs one-off, with
   inline **Confirm / Decline**. Confirming runs through the occupancy guard — if a
   fixture took the slot meanwhile it simply can't confirm (no double-book).
2. **Schedule = resource-timeline calendar** — **pitches as columns, time down the side**
   (day/week grid; the Skedda / Cal.com / Resy model). Colour-coded so booked-vs-available
   is instant:
   - league fixture — solid, **locked** (booking UI can't move it)
   - confirmed booking — solid colour
   - pending request — **amber/striped** (actionable here too, not just the inbox)
   - maintenance — grey hatched
   - empty = available = **tappable**

### Phone / walk-in bookings
Staff open the day, see the gap, **tap the empty cell**, pick team + length → **created
already-confirmed** (operator is the authority, so venue-created bookings skip
request→approve). The grid physically cannot overlap anything (occupancy guard).

### Mobile (portrait)
A multi-column grid is unusable on a phone, so flip it:
- Schedule defaults to a **single-pitch day agenda** — one pitch, vertical timeline,
  pitch switcher (swipe/dropdown). Full grid only in landscape (optional).
- Requests = **card list**, big Confirm/Decline buttons.
- **"+" FAB** for phone bookings → pitch → date → time → length, pre-confirmed.

### v1 scope — SHIP LEAN (operator decision)
- **In:** inbox + colour-coded day schedule per pitch + **tap-empty-to-book** + mobile
  agenda. Covers everything above.
- **Deferred:** drag-to-create, drag-to-resize, week view. Polish, added later — no
  feature lost, just the diary gloss.

### Realtime — HARD REQUIREMENT (no polling, no refresh)
Live data is non-negotiable: requests and status changes must appear without a page/app
refresh. This is the app's existing pattern (Supabase realtime broadcast on the Phase-2
`venue_live:` channel) — booking must use it, not invent polling.
- Casual submits request → create-booking RPC **broadcasts** (e.g. `booking_requested`)
  on the venue channel → venue dashboard subscriber pushes it into the inbox + drops the
  amber block on the calendar + bumps the badge, **live**.
- Venue confirm/decline/cancel → **broadcasts** on the team channel → casual app updates
  instantly.
- Fixture claims a slot → calendar occupancy updates live, so staff never act on stale
  availability.
- **Hard-rule #10 discipline:** every booking write RPC broadcasts an **explicitly
  whitelisted** reason AND has a **matching client subscriber** in BOTH the venue UI and
  the casual UI, built up front. Proposed reasons (add to `notify_venue_change` /
  `notify_team_change` whitelists, don't assume): `booking_requested`, `booking_confirmed`,
  `booking_declined`, `booking_cancelled`, `booking_superseded`. (Reminder: that whitelist
  silently regressed once in mig 121 — add reasons explicitly + verify the subscriber.)
