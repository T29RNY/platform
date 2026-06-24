# Unified Resource Calendar — Handoff / Build Plan

*Scoped 2026-06-24 (s194). Operator-requested follow-up to the "All grounds" pitch calendar.
Venue/club domain only (not casual inorout). Next free migration at scope time = **419**.*

> **🏁 PHASE 1 SHIPPED — s198 (mig 419, read-only).** One unified calendar across **all operator
> venues** showing pitches + rooms + classes + trainers (filterable) + an equipment availability
> strip. New SECDEF reader `get_venue_resource_occupancy` (+ definer-only `_room_occupancy_detail`/
> `_trainer_occupancy_detail`); shared `GroupedColumnGrid` engine with `AllGroundsGrid` refactored
> onto it (regression-safe); new `ResourceCalendar`/`ResourceBlockModal`/`EquipmentStrip`;
> `BookingsView` "Show: Pitches/Rooms/Trainers/All" switch. **Operator overrides at build:** all
> venues from the start (not single-venue v1); one shared engine (Option A); class name primary,
> room a subheading. All gates PASS (EV 3/3+leak0, Playwright 0 err, hygiene 7/7, rpc-security).
> ⛔ owed: venue MANUAL prebuilt-static deploy + signed-in device walk. **NEXT = Phase 2 below
> (book/create from the calendar, desktop + mobile).**

> **🏁 PHASE 2 / 2b SHIPPED + DEPLOYED — s202 (2026-06-24).** Book-from-calendar (P2, no mig, PR #97)
> plus the calendar-mobile Phase 2b operator create-from-calendar for **room hire + PT appointment**
> (mig 423, PR #102 → main). **2b is now LIVE on platform-venue.vercel.app** — manual prebuilt-static
> deploy done this session; live bundle `index-CZowjm7c.js` grep-confirmed to contain `New room hire`/
> `Create hire`/`Customer name`/`New appointment`/`Book appointment` (RoomHireModal + AppointmentModal).
> ⛔ still owed: signed-in operator **device walk** of the create flows (deploy half done).
> **NEXT = Phase 3 below — hard cross-resource clash protection (room + trainer occupancy). BUILD-READY
> scope locked below. Migration 424.**

---

## ⭐ PHASE 3 — 🏁 SHIPPED s203 (2026-06-24, mig 424) — hard room/trainer clash protection

> **🏁 BUILT + APPLIED LIVE (mig 424).** One shared `resource_occupancy` ledger (single-table
> shape, mirrors `pitch_occupancy`) with a btree_gist `EXCLUDE (resource_type, resource_id,
> time_range) WHERE active`, kept in sync by **3 SECDEF per-table triggers**
> (`tg_sync_room_hire_occupancy` on `venue_room_hires`, `tg_sync_class_session_occupancy` on
> `venue_class_sessions`, `tg_sync_appointment_occupancy` on `venue_appointments`) — covering ALL
> 13 audited write paths (rooms 5, classes 5, trainers 3 incl. the no-op deposit/checkin/reassign
> ones the `UPDATE OF` column lists skip). Room hire + class session share the `room` lane → the
> room-hire-vs-class **cross-table** gap is hard-closed too. Occupy = `status <> 'cancelled'`
> (byte-identical to `_space_is_available`), backfilled future-only (clash-only ledger). Friendly
> surfacing: exclusion_violation → `slot_unavailable` (rooms) / `slot_taken` (trainers); inline
> guards stay as fast-path belt-and-braces; `RoomHireModal` + `ClassesView` error maps gained a
> `slot_unavailable` key for the rare trigger-race. RLS on, 0 policies, anon/auth REVOKEd (matches
> pitch_occupancy). **Gates ALL PASS:** EV **9/9 + leak 0** (room overlap, cross-table class-vs-hire,
> trainer overlap, adjacent allowed, cancel + delete release), trigger-fn security (SECDEF +
> search_path + revoked), build venue clean, hygiene 7/7 ×2, Playwright boot 0 errors. casual-regression
> N/A (venue only). ⛔ owed: venue MANUAL prebuilt-static deploy + live-bundle grep + operator device walk.

*Audited 2026-06-24 (s202). This supersedes the looser "Phase 3 (optional)" note further down.*

**The gap (pitch-parity).** Pitches are protected by a **true Postgres `EXCLUDE` constraint**
(`pitch_occupancy_no_overlap`) on the `pitch_occupancy` ledger, kept in sync by **per-table triggers**
that fire on *every* create/update/cancel/void/delete path (mig 414). That makes pitch double-booking
**structurally impossible from any write path**. Rooms and trainers do **not** have this:

- **Rooms** — only an **inline** `_space_is_available()` overlap check (mig 338: vs class sessions ∪
  room hires) + a `FOR UPDATE` lock on `venue_spaces`, called *inside* the create RPCs
  (`venue_create_room_hire`, `venue_confirm_room_hire`). Any write path that does **not** call
  `_space_is_available` can still double-book a room.
- **Trainers** — only an **inline** overlap-count guard inside `venue_create_appointment` + an
  exact-start unique index. The unique index can't catch arbitrary-time overlaps; the inline guard
  only covers that one RPC.

**The build.** Mirror the mig-414 pitch mechanism for rooms and trainers so clash protection is
**path-independent**, not per-RPC:

1. **Ledger(s)** — either a shared `space_occupancy` table or two (`room_occupancy`, `trainer_occupancy`),
   each with a `tstzrange` and a btree_gist `EXCLUDE` constraint preventing overlap per resource id.
   Decide shared-vs-split in the audit (recommend matching pitch_occupancy's single-table shape).
2. **Per-table sync triggers** on `venue_room_hires`, `venue_class_sessions`, and `venue_appointments`
   (and any other table that occupies a room/trainer) — INSERT/UPDATE/DELETE → upsert/deactivate the
   ledger row, exactly like `tg_sync_club_session_occupancy` / `tg_sync_club_fixture_occupancy`.
3. **Friendly surfacing** — catch the EXCLUDE violation and return `slot_unavailable` (rooms) /
   `slot_taken` (trainers) to match the existing client copy; the inline guards in the create RPCs
   become a fast-path belt-and-braces, the trigger is the real guarantee.
4. **Backfill** the ledger from existing live room hires / class sessions / appointments in the
   migration so the constraint doesn't reject day-one writes against pre-existing bookings.

**Gates:** rpc-security sweep + **ephemeral-verify** (this ADDS write-path behaviour via triggers —
seed own `_e2e_` room/trainer + two overlapping bookings, prove the 2nd rejects, leak-check 0) +
build venue + hygiene 7/7 + hex + Playwright smoke; casual-regression N/A (venue/club only);
schema-sync if any column moves (this only ADDS tables/triggers). **Migration 424.**

**Open audit questions to lock first:** (a) one shared `space_occupancy` ledger vs split room/trainer
tables; (b) does any write path *other* than the three named tables occupy a room/trainer (grep
before trusting the trigger set); (c) backfill scope — all-time vs future-only rows.

---

## THE ASK

Today the venue **Bookings** calendar (incl. the new "All grounds" cross-venue view) shows
**pitches only** — it renders `pitch_occupancy` (bookings / league / match / training /
maintenance). The operator wants **one calendar that also shows Rooms, Classes and Equipment**
— a genuinely unified resource calendar — with the resource types filterable.

This is NOT "add more rows to the pitch feed." The resources sit in **three different time
models**, which is the whole reason this is its own epic.

---

## RELEVANT WORK ALREADY COMPLETED (reuse, don't rebuild)

- **Pitches are already a unified occupancy feed.** `pitch_occupancy` (tstzrange `time_range`,
  EXCLUDE clash constraint, per-table sync triggers) + readers `get_pitch_occupancy` and
  `get_operator_pitch_occupancy`, both built on the definer-only `_pitch_occupancy_detail(kind,
  source_id)` block-detail builder. **Mirror this builder pattern for the new sources.**
  (As of mig 418 the detail also carries `priority_rank` → `occRankBadge`.)
- **The grouped-grid component exists** — `apps/venue/src/views/AllGroundsGrid.jsx` (s194) already
  renders a grid whose columns are **grouped under header bands** (`.sg-venuehead` spanning a
  group's column count), with per-column bookability. **Resource-type grouping is the identical
  pattern** — generalise this rather than write a new grid.
- **`apps/venue/src/bookingUtil.js`** — reusable block helpers: `occClass` / `occLabel` /
  `occType` / `occTypeKey` / `occIcon` / `occInitials` / `occRankBadge` / `occBounds` /
  `freeGaps` / `dayWindow` / `minsOfDay` / `fmtTime`. Extend these for the new source kinds.
- **`apps/venue/src/views/CalendarFilters.jsx`** — the chip system (type chips + pitch-visibility
  chips). Add new type chips (Room hire, Class, Equipment, PT) here.
- **The existing per-resource surfaces** (Phase-2 "tap-to-book" routing targets, already built):
  `RoomHiresView.jsx` + `SpacesView.jsx` (room hire), `ClassesView.jsx` (+ `ClassCheckinScanner`),
  `EquipmentView.jsx`. Their create/booking flows already exist — the calendar reuses them.
- **Venue People & Spaces IA epic (migs 409–411)** already combined Rooms+Timetable in the rail —
  the resources are conceptually grouped for the operator already.

---

## THE DATA MODEL (audited s194 — confirm still current in the build session)

| Resource | "Thing" table | Booked-time table(s) | Time model |
|---|---|---|---|
| **Pitches** | `playing_areas` | `pitch_occupancy` (booking / fixture / club_fixture / club_session / maintenance) | ✅ unified occupancy lane, clash-protected |
| **Rooms / Spaces** | `venue_spaces` (`space_type`, `capacity`, `is_enquiry_only`) | `venue_room_hires` (`space_id`, `starts_at`, `ends_at`, status, booker) **AND** `venue_class_sessions` (`space_id`, `starts_at`, `ends_at`, `class_type_id`, capacity, status) | single-occupancy lane, but busy-time is in **two** tables; **no** unified occupancy table |
| **Classes** | `venue_class_types` (→ `venue_class_series`) | `venue_class_sessions` (occupy a `space_id`) | a class **is** a space booking → shows in the Room/Space lanes |
| **Equipment** | `equipment` (`quantity`, `default_fee_pence`) | `equipment_bookings` (`qty`, `start_at`, `end_at`, status; FKs to `booking_id`/`fixture_id`/`room_hire_id`) | **quantity-over-time** — "12 of 20 out", NOT one-thing-per-slot |
| *(PT / Trainers — not in the ask, free to fold in)* | `venue_trainers` | `venue_appointments` (`trainer_id`, `starts_at`, `ends_at`) | single-trainer lane, same shape as Rooms |

**Implications:**
1. **Pitches & Rooms/Trainers** are single-occupancy *lanes* → render as calendar columns.
2. **A room can be busy from EITHER a room-hire OR a class** → the room reader must UNION both.
3. **Equipment is a count, not a lane** → render as an availability strip/panel, not a column
   ("is this slot free?" is the wrong question for equipment — "do we have enough?" is right).
   There is already a quantity-aware `get_equipment_availability` RPC to lean on.
4. **No existing cross-table clash guard** between a room-hire and a class in the SAME space (and
   between equipment over-allocation) — that's a Phase-3 audit item, not a Phase-1 blocker.

---

## PROPOSED ARCHITECTURE — PHASED

Each phase is its own AUDIT → EXECUTE → VERIFY → COMMIT cycle; merge before the next.

### Phase 1 — Unified READ + read-only calendar  *(most of the value, lowest risk)*
- **New reader RPC** `get_venue_resource_occupancy(p_venue_token, p_from, p_to)` (SECURITY DEFINER,
  `SET search_path`, single overload, anon+authenticated grant per the venue-token shape) returning
  a normalised feed: `{ resource_type, resource_id, resource_name, source_kind, start, end, detail }`
  across **pitches** (reuse `pitch_occupancy`), **rooms** (`venue_room_hires` ∪ `venue_class_sessions`),
  and *(optional)* **trainers** (`venue_appointments`). Mirror `_pitch_occupancy_detail` with new
  `_room_occupancy_detail` / `_trainer_occupancy_detail` builders. Record forward consumers in
  RPCS.md (Hard Rule #14).
  - **Multi-venue:** decide whether v1 returns one venue or all same-`company_id` venues (the
    `get_operator_pitch_occupancy` pattern). Recommend **single-venue v1**, fold into All-grounds later.
- **Generalise the grid** off `AllGroundsGrid`: lanes **grouped by resource type** (Pitches / Rooms /
  Trainers), reusing `.sg-venuehead`-style group bands. New filter chips in `CalendarFilters`:
  Room hire, Class, (PT). Equipment chip toggles the strip (below).
- **Equipment = availability strip**, not grid columns (e.g. "Bibs 12/20 out · 18:00–20:00"), driven
  by `get_equipment_availability` over the visible window.
- **Read-only:** tap a block → its existing detail; tap an empty slot → **no-op in v1** (booking
  stays on each surface). Extend `bookingUtil` for the new `source_kind`s (label/icon/type/colour).
- **Surface:** a resource-type switcher on the existing Bookings calendar (extends the s194 ground
  switcher), OR a dedicated "Calendar" rail item — decide in-session.
- **Gates:** rpc-security sweep + **ephemeral-verify** the new reader (read-only, own `_e2e_`
  fixture), build venue + hygiene 7/7 + hex, Playwright smoke; casual-regression N/A (venue only);
  schema-sync only if a column is added.

### Phase 2 — Book from the calendar  *(per-lane wiring; Med–High)*
- Empty-tap in a **Pitch** lane → existing walk-in/`book_pitch_adhoc`; in a **Room** lane →
  room-hire / class-session create; **Trainer** lane → appointment create. Each routes to its own
  existing flow (`RoomHiresView` / `ClassesView` / trainer booking). Respect the pitch-priority
  reserved-window warnings already shipped (migs 416–417) on the pitch lanes.

### Phase 3 — Cross-resource clash + inline equipment  *(optional)*
- Guard a room-hire vs a class in the **same** `space_id` (today they may not check each other —
  audit `venue_room_hires` / `venue_class_sessions` write RPCs). Surface equipment shortfalls
  inline. Possibly a shared `space_occupancy` table mirroring `pitch_occupancy` + triggers if hard
  clash protection is wanted (matches the multi-venue Phase-3 mechanism).

**Effort:** P1 ≈ Med (one union reader + a generalised grid). P2 ≈ Med–High. P3 ≈ Med.
**Migration:** P1 reader takes **419** (re-check `MEMORY.md` "Next free migration" at build time —
it moves with every merged migration).

---

## DECISIONS TO LOCK AT THE START OF THE BUILD SESSION

Ask these as the audit's clarifying question(s) before executing (recommended defaults in **bold**):

1. **Which resources in v1?** **Pitches + Rooms (classes-in-rooms come free) + Trainers as lanes,
   Equipment as an availability strip.** (Or drop Trainers / drop Equipment from v1.)
2. **Read-only v1** (tap routes you to the right surface to book) — **recommended** — or
   book-from-calendar in v1?
3. **Equipment rendering:** **availability strip** / per-item lanes / side panel.
4. **Surface:** **resource-type switcher on the existing Bookings calendar** (extends s194) /
   a new dedicated "Calendar" rail item.
5. **Multi-venue:** **single-venue resource calendar v1**, fold into "All grounds" later /
   all-resources-all-venues from the start.

---

## OUT OF SCOPE / NON-GOALS
- Casual inorout app (this is venue/club domain only).
- Changing any existing per-resource booking flow's behaviour (the calendar *routes into* them).
- Cross-operator or cross-club resource sharing (settlement/safeguarding wall — see DECISIONS s180).
