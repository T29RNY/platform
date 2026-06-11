# EQUIPMENT HIRE — FEATURE PLAN

Status: **CYCLE 1 SHIPPED (session 85, migs 255–256).** Cycles 2–4 pending.
Produced via `skills/feature-plan.md`.
Date: 2026-06-11 (session 85).

> **Cycle 1 done (migs 255–256):** schema (3 tables + `venue_charges` CHECK
> extension + indexes, data foundations locked in) + catalogue RPCs
> `venue_list_equipment`/`venue_upsert_equipment` + venue **Equipment** tab
> (`EquipmentView.jsx`). Build ✓, ephemeral-verify 10/10 + leak 0 ✓,
> rpc-security-sweep ✓, hygiene ✓. Real-device PWA pass on the venue dashboard
> still owed (Hard Rule #13). One plan correction found during audit:
> `fixtures.id` is **uuid** (not text as risk-flag #6 assumed) — session-link FKs
> are both uuid.
>
> **Next: Cycle 2** — quantity-aware availability + the hire flow.

---

## ONE-LINE

A sport-agnostic, inventory-aware equipment-hire system for the venue:
venues stock named kit (with quantity), customers hire it for a time window,
the existing charge/payment ledger bills it, and **every hire — and every
turned-away request — is captured as clean, categorised data** so the HQ
Intelligence + Gaffer layers can later turn it into ROI, utilisation, and
procurement insight.

Decision settled with developer (session 85):
- **Version B** — full booking + inventory (not just a chargeable line item).
- **Sport-agnostic by posture** — per DECISIONS.md "MULTI-SPORT POSTURE"
  (mig 050) + "SPORTS LOOKUP TABLE — REJECTED" (session 84). No `sports`
  lookup table. Neutral naming. The venue's own catalogue is the sport adapter.
- **Data foundations are non-negotiable in Cycle 1** — category taxonomy,
  session link, demand-miss capture, asset condition/value. Cheap now,
  impossible to backfill later.

---

## WHY THIS IS LOW-RISK

The expensive infrastructure already exists and is production-proven:
- **Charge + payment ledger** — `venue_charges` / `venue_payments` (mig 180/181).
  Equipment billing reuses it wholesale; the only schema change is extending one
  CHECK constraint.
- **Bookable-resource pattern** — the pitch-booking system (migs 133–150) is a
  complete template: time-range occupancy, overlap guards, auto-charge-on-confirm,
  walk-in vs registered-team bookers, a calendar UI.
- **Customers concept** — `venue_list_customers` (mig 223) already aggregates
  bookers + payment status; equipment hires fold straight in.
- **Venue dashboard shell** — tabbed nav, credential threading, realtime
  subscriber pattern all reusable.

The **only genuinely new logic** is *inventory quantity* — a pitch is 1-of-1,
but a venue may own 4 sets of goals, so availability must sum quantities rather
than block on any overlap.

---

## DATA FOUNDATIONS (Cycle 1 — the whole point)

These four are locked into the first schema cycle because they are free to add
now and expensive-to-impossible to retrofit. Skipping any one quietly kills a
section-3 data play below.

1. **Controlled category taxonomy.** `equipment.category` is a fixed enum
   (`apparel`, `balls`, `goals_targets`, `nets`, `training_aids`, `tech_av`,
   `safety`), NOT free-text. The venue's free-text `name` rides alongside as the
   label. Category is the clean spine that lets HQ aggregate/benchmark across
   venues and sports. Sport-agnostic by construction (padel rackets → `tech_av`
   or a future `rackets` value; cricket nets → `nets`).
2. **Session linkage.** `equipment_bookings.booking_id` / `.fixture_id`
   (nullable FKs) record the pitch booking or fixture a hire rode in on. This one
   link is the entire cross-sell story ("bookings with kit spend more / rebook
   more").
3. **Demand-miss capture.** `equipment_demand_misses` logs every availability
   check that came back empty (category, requested window, venue, qty wanted).
   This is the procurement-recommendation signal — the highest-value data we'll
   own, and unrecoverable if not captured at the moment of the miss.
4. **Asset condition + value.** `purchase_price_pence`, `acquired_on`,
   `condition`, `returned_at`. Yields depreciation, ROI-per-asset, replace-alerts,
   and a free exportable insurance asset register.

---

## SCHEMA CHANGES

### New tables

**`equipment`** — the catalogue (one row per kit type the venue owns)
```
id                 uuid PK default gen_random_uuid()
venue_id           text NOT NULL references venues(id)
name               text NOT NULL                         -- free-text label
category           text NOT NULL CHECK (category IN
                     ('apparel','balls','goals_targets','nets',
                      'training_aids','tech_av','safety'))
quantity           int  NOT NULL CHECK (quantity >= 0)    -- units owned
default_fee_pence  int  NOT NULL DEFAULT 0 CHECK (>= 0)
deposit_pence      int  NOT NULL DEFAULT 0 CHECK (>= 0)
hire_unit          text NOT NULL DEFAULT 'per_session'
                     CHECK (hire_unit IN ('per_hour','per_session','per_day'))
purchase_price_pence int                                  -- asset register / ROI
acquired_on        date
condition          text DEFAULT 'good'
                     CHECK (condition IN ('new','good','worn','damaged','retired'))
active             boolean NOT NULL DEFAULT true
created_at         timestamptz NOT NULL DEFAULT now()
```

**`equipment_bookings`** — concrete hires (mirrors `pitch_bookings`)
```
id              uuid PK default gen_random_uuid()
equipment_id    uuid NOT NULL references equipment(id)
venue_id        text NOT NULL references venues(id)
team_id         text     NULL references teams(id)        -- registered booker
booked_by_name  text     NULL                             -- walk-in booker
qty             int  NOT NULL DEFAULT 1 CHECK (qty >= 1)
start_at        timestamptz NOT NULL
end_at          timestamptz NOT NULL CHECK (end_at > start_at)
due_back_at     timestamptz                               -- optional return SLA
returned_at     timestamptz                               -- NULL = still out
booking_id      uuid NULL references pitch_bookings(id)   -- session linkage
fixture_id      text NULL                                 -- session linkage (fixtures.id is text)
status          text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','confirmed','declined',
                                    'cancelled','out','returned','overdue'))
amount_pence    int                                       -- agreed hire fee
contact_email   text                                      -- reuse mig-232 pattern
contact_phone   text
created_at      timestamptz NOT NULL DEFAULT now()
CHECK ( (team_id IS NOT NULL) OR (booked_by_name IS NOT NULL) )  -- a booker exists
```

**`equipment_demand_misses`** — turned-away demand (procurement signal)
```
id            uuid PK default gen_random_uuid()
venue_id      text NOT NULL references venues(id)
category      text NOT NULL          -- what they wanted
equipment_id  uuid NULL references equipment(id)  -- if a specific item, else NULL
window_start  timestamptz NOT NULL
window_end    timestamptz NOT NULL
qty_wanted    int NOT NULL DEFAULT 1
source        text NOT NULL DEFAULT 'venue'   -- 'venue' | 'self_qr' (future)
created_at    timestamptz NOT NULL DEFAULT now()
```

### Altered tables

**`venue_charges`** — extend the CHECK constraint (mig 180 currently
`source_type IN ('booking','fixture')`):
```
ALTER TABLE venue_charges DROP CONSTRAINT venue_charges_source_type_check;
ALTER TABLE venue_charges ADD  CONSTRAINT venue_charges_source_type_check
  CHECK (source_type IN ('booking','fixture','equipment'));
```
The existing UNIQUE `(source_type, source_id, COALESCE(team_id,''))` already
gives us "one charge per equipment hire" with no change. `venue_payments` needs
**no schema change** — the ledger bills equipment exactly as it bills bookings.

### Indexes
- `equipment (venue_id, active)`
- `equipment_bookings (equipment_id, start_at, end_at)` — availability scans
- `equipment_bookings (venue_id, status)` — "what's out / overdue" board
- `equipment_bookings (booking_id)` / `(fixture_id)` — cross-sell joins
- `equipment_demand_misses (venue_id, category, window_start)`

---

## NEW RPCs

All `SECURITY DEFINER`, `SET search_path = public, pg_temp`, venue-token-gated
via the established `resolve_venue_caller` pattern, return `jsonb`, and INSERT
into `audit_events` per Hard Rule #9.

```
venue_list_equipment(p_venue_token) → jsonb
  Caller: venue token / login.  Reads: equipment.
  Returns: catalogue + per-item live availability summary + lifetime hires/revenue.

venue_upsert_equipment(p_venue_token, p_id?, p_name, p_category, p_quantity,
                       p_default_fee_pence, p_deposit_pence, p_hire_unit,
                       p_purchase_price_pence?, p_acquired_on?, p_condition?, p_active?) → jsonb
  Caller: venue.  Writes: equipment.  Create or edit a catalogue item.

get_equipment_availability(p_venue_token, p_category?, p_from, p_to) → jsonb
  Caller: venue (later: anon/QR).  Reads: equipment + equipment_bookings.
  Returns: per-item free-quantity across the window (THE quantity-aware query).
  *** On an empty result for a specific requested window, INSERT a
      equipment_demand_misses row. *** (demand capture lives here)

venue_create_equipment_hire(p_venue_token, p_equipment_id, p_qty, p_start_at,
                            p_end_at, p_due_back_at?, p_team_id?, p_booked_by_name?,
                            p_booking_id?, p_fixture_id?, p_contact_email?,
                            p_contact_phone?, p_amount_pence?) → jsonb
  Caller: venue.  Writes: equipment_bookings (+ auto venue_charges on confirm,
  from p_amount_pence else equipment.default_fee_pence; deposit charge if set).
  Quantity guard: rejects if requested qty exceeds free units in window
  (and logs the miss).

venue_confirm_equipment_hire(p_venue_token, p_booking_id) → jsonb
venue_decline_equipment_hire(p_venue_token, p_booking_id) → jsonb
venue_mark_equipment_out(p_venue_token, p_booking_id) → jsonb       -- handed over
venue_mark_equipment_returned(p_venue_token, p_booking_id, p_condition?) → jsonb
  -- releases deposit; if past due_back and unreturned, status→overdue (cron or
  --    on-read); optional condition write-back to asset.

venue_equipment_board(p_venue_token) → jsonb
  Caller: venue.  Returns: what's out now, overdue, due-back-today — the ops view.
```

Charge auto-hook reuses the mig-181 pattern: confirm → create `venue_charges`
row with `source_type='equipment'`, `source_id = equipment_booking.id`.

---

## EXISTING RPCs / INFRA REUSED

- `venue_record_payment`, `venue_void_payment`, `venue_set_charge_due`,
  `venue_get_charges` — **unchanged**; equipment charges flow through them once
  `source_type='equipment'` is allowed.
- `resolve_venue_caller` / `me.role` / `me.capsGrant` — auth + capability gating.
- `venue_list_customers` (mig 223) — equipment hires fold into booker totals
  (extend its aggregation in a later cycle, optional).
- `prime_time_windows` (migs 176/177) — reusable for peak-pricing equipment later.
- `_mailer` booking-confirmation template (mig 232) — reusable for hire confirmations.
- `audit_events` — every write RPC logs here (Hard Rule #9).

---

## RLS IMPLICATIONS

- `equipment`, `equipment_bookings`, `equipment_demand_misses` — RLS ENABLED,
  no client policies. All access via SECURITY DEFINER venue RPCs (house rule:
  no direct client table access). Same posture as `pitch_bookings` /
  `venue_charges`.
- Venue-domain only — does NOT cross the venue↔casual RLS wall (per
  `project_venue_phase_b`). Equipment is venue-owned; casual teams only ever
  appear as a `team_id` booker reference, never as data owners.

---

## UI SURFACES (apps/venue/src/)

- **New tab: `EquipmentView.jsx`** in the Workspace group (beside Bookings /
  Payments) in `Dashboard.jsx` TABS + `Topbar.jsx` switcher.
  - Catalogue list (add/edit kit, set qty + price + deposit + category).
  - Availability view for a chosen window (quantity-aware).
  - "Record a hire" flow (walk-in name or pick registered team; optional link to
    an existing pitch booking).
  - Returns board: what's out, overdue, mark-returned.
- Reuses existing view shell, `credential` threading, realtime subscriber pattern.
- **New supabase.js wrappers** (camelCase) + `packages/core/index.js` barrel
  exports for each RPC above. Raw RPC names appear in exactly ONE `supabase.rpc()`
  call each (Hard Rule / grep verify).
- **Realtime:** new broadcast reasons (`equipment_requested`,
  `equipment_confirmed`, `equipment_returned`) with MATCHING client subscribers
  in the venue channel (Hard Rule #10).

---

## RISK FLAGS

1. **Inventory-quantity availability is the one true unknown.** The
   `get_equipment_availability` query must sum overlapping confirmed/out hires per
   item and subtract from `quantity` — richer than the pitch system's binary
   free/busy. Needs careful half-open `[start, end)` range logic and an
   ephemeral-verify (it's a new write path).
2. **`venue_charges` CHECK-constraint change** must DROP + re-ADD the named
   constraint, not `CREATE OR REPLACE`. Migration source lands same commit as the
   live apply (Hard Rule #11).
3. **New write RPCs → mandatory `skills/ephemeral-verify.md`** before commit,
   against an `_e2e_`-prefixed throwaway venue, auto-rollback (Hard Rule #15).
   Never test against demo/prod rows.
4. **PWA/realtime real-device test** owed for the venue UI hire flow before
   commit (Hard Rules #10, #13).
5. **Overdue status** — `overdue` can be derived on-read or by a small cron;
   decide in audit. Don't write `overdue` eagerly.
6. **`fixtures.id` is text, `pitch_bookings.id` is uuid** — session-link FK types
   must match each (Hard Rule: type mismatches cause silent RPC failures).
7. **Venue deploy is manual** (`platform-venue.vercel.app`, prebuilt-static —
   `project_venue_deploy`); does NOT auto-deploy on push. Build + deploy step is
   explicit.

---

## PROPOSED CYCLE SEQUENCE

**Cycle 1 — Foundations + catalogue (the data spine).**
Schema: `equipment`, `equipment_bookings`, `equipment_demand_misses`,
`venue_charges` CHECK extension, indexes. RPCs: `venue_list_equipment`,
`venue_upsert_equipment`. UI: Equipment tab + catalogue management.
→ *Ships the clean data model even before hires exist.*

**Cycle 2 — Quantity-aware availability + the hire flow.**
RPCs: `get_equipment_availability` (with demand-miss capture),
`venue_create_equipment_hire`, `venue_confirm_/decline_`. Auto-charge hook.
UI: availability view + record-a-hire. EV test of the quantity guard.

**Cycle 3 — Returns, deposits, overdue board.**
RPCs: `venue_mark_equipment_out`, `venue_mark_equipment_returned` (deposit
release + condition write-back), `venue_equipment_board`. UI: returns board.

**Cycle 4 (optional, pilot-facing wow) — QR self-hire.**
Reuse QR onboarding v1 rail: sticker per kit set → scan-to-hire / scan-to-return.
Opens `get_equipment_availability` + a constrained anon hire RPC.

**Later / data-product cycles (clearly deferred — pick per pilot need):**
- Prime-time equipment pricing (reuse `prime_time_windows`).
- Attach-rate prompt in the booking flow ("add bibs +£5").
- HQ Intelligence feed: ROI-per-asset, utilisation, demand-miss → procurement
  recommendations.
- Gaffer surface: "what equipment should I buy next?" grounded in the above.
- Network benchmarking / inter-venue sharing (vision-tier; enabled by clean
  category data, not built now).
- Insurance asset-register export (falls out of the asset fields for ~free).

---

## TEST PLAN (per cycle)

- **Ephemeral-verify** (`skills/ephemeral-verify.md`): seed an `_e2e_` venue +
  equipment, run the hire → confirm → charge → pay → return flow end-to-end
  against the live DB, assert quantity guard + demand-miss logging + deposit
  release, `RAISE EXCEPTION 'ROLLBACK_TESTS_PASSED'`, then mandatory `_e2e_%`
  leak-check = 0.
- **Real venue** (NOT demo) for any auth/capability-gated path.
- **Real-device** pass on the venue PWA for the hire + returns UI.
- **Grep verify**: each new RPC name appears in exactly ONE `supabase.rpc()`.

---

## STOP

This is the plan. Per `skills/feature-plan.md`, audit.md does **not** begin until
you confirm. You may: approve → proceed to Cycle 1 audit; adjust scope (add/drop
cycles or fields); or defer.
