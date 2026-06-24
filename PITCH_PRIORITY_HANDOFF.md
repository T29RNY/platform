# PITCH PRIORITY — Handoff (pilot backlog #5 + #6)

Canonical plan for the linked pair: **#5 internal-vs-external pitch booking + reserved/priority
time windows** and **#6 make `club_teams.priority_rank` (the ⭐ badge) actually DRIVE pitch
contention**. Scoped + locked in session 195 (audit only, no code). Build runs next session.

Next free migration = **416**. Venue/club domain (not casual, except the one external-gate touch
noted below). Operator-requested at the 2026-06-22 pilot meeting (STRATEGY.md backlog #5/#6).

---

## 1. AUDIT FINDINGS (verified s195 — repo + live DB)

### The clash model today
`pitch_occupancy` (mig 133) is the single occupancy ledger. Contention is enforced by **one
partial GiST constraint**:

```
CONSTRAINT pitch_occupancy_no_overlap
  EXCLUDE USING gist (playing_area_id WITH =, time_range WITH &&) WHERE (active)
```

- It is an **absolute, source-blind, first-come-first-served HARD BLOCK** — any two `active`
  rows on the same pitch with overlapping `[)` ranges are mutually exclusive, full stop.
- Every writer wraps its `INSERT … pitch_occupancy` in
  `EXCEPTION WHEN exclusion_violation THEN RAISE 'slot_unavailable' (P0001)`.
- There **is** a `priority smallint CHECK BETWEEN 0 AND 3` column (0=maint,1=fixture,2=block,
  3=ad-hoc) and mig-133's header describes a "displacement model" (in one txn: set loser
  `active=false`, then insert winner so the partial EXCLUDE can't fire). **That displacement
  model is NOT implemented anywhere.** `priority` is currently write-only metadata; nothing
  reads it to resolve contention. **So today: 100% first-come hard block, rank ignored.**

### Who writes occupancy (every path + gate)
| source_kind | write path | gate | priority |
|---|---|---|---|
| `club_session` | TRIGGER `tg_sync_club_session_occupancy` (mig 414) | follows session write RPCs (venue token `manage_memberships`, or inorout manager `auth.uid`) | 1 |
| `club_fixture` | TRIGGER `tg_sync_club_fixture_occupancy` (mig 414) | follows fixture write RPCs | 1 |
| `fixture` (league) | TRIGGER `tg_sync_fixture_occupancy` (mig 137/379) | league write RPCs | 1 |
| `maintenance` | TRIGGER `sync_maintenance_occupancy` on `playing_areas` (mig 136) | `venue_update_pitch` (`manage_facility`) | 0 |
| `booking` (casual request) | RPC `book_pitch_adhoc` / `book_pitch_series` (mig 144) | `auth.uid()`→`team_admins` on a **casual `teams`** id | 3 / 2 |
| `booking` (walk-in/operator) | RPC `venue_create_booking` (mig 145) | `resolve_venue_caller` (venue token; NOT in the mig-239 cap map → any valid venue role) | 3 |
| confirm/decline/cancel/renew | `venue_confirm_booking`/`_decline_booking` (145), `_series` (236), cancellations (146), renewals (151–152) | venue token | — |

### Internal vs external is already cleanly derivable (no flag needed)
- **Internal** = `club_session` + `club_fixture` → `team_id`/`club_team_id` → **`club_teams`**
  (the ranked teams; `priority_rank`).
- **External** = `booking` → `pitch_bookings.team_id` → **`teams`** (casual/league table) or a
  walk-in name.
- They never cross: a `club_teams` uuid can't appear on `pitch_bookings.team_id` (FK→`teams`).
  So "internal vs external" follows directly from `source_kind`. What's missing is the
  **priority/reservation layer** that acts on it.

### priority_rank — set & read today
- **Set:** `club_create_team`/`club_update_team` (mig 389) ← `clubCreateTeam`/`clubUpdateTeam`
  (supabase.js:4990/4999) ← `TeamModal` in `MembershipsView.jsx`.
- **Read (display only):** `TeamsView.jsx:250` (sortable col), `MembershipsView.jsx:2379`
  (⭐/`#n` badge), and `ORDER BY … priority_rank` in the `list_club_teams`-family readers
  (migs 389/409/411). **Zero occupancy/contention code reads it.** `int NULL`, lower = higher
  (1 = top).

### Reserved windows — what exists
**Nothing for reservations.** `playing_areas` carries 3 JSONB window cols: `booking_windows`
(open hours), `prime_time_windows` (peak/pricing), `maintenance_windows` (→ occupancy pri 0).
**No per-team and no internal/external reserved-window concept** exists. There is no
`booking_windows` *table* — it's a column. Reserved windows are **net-new schema**.

### Verified live schema
- `playing_areas`: id, venue_id, name, surface, capacity, active, sort_order, is_available,
  maintenance_windows, booking_windows, prime_time_windows, default_fee_pence, sport, sport_types.
- `pitch_occupancy`: id, playing_area_id, venue_id, time_range tstzrange, source_kind (5 kinds),
  source_id text, priority smallint 0–3, active, created_at; `_no_overlap` EXCLUDE;
  `_source_uniq` UNIQUE(source_kind, source_id).
- `club_teams`: id uuid, club_id text, cohort_id, name, gender, **priority_rank int NULL**,
  archived_at, created_at.
- `club_fixtures`: club_team_id uuid, club_team_name, playing_area_id, scheduled_date,
  kickoff_time, status, league_id, …
- `club_sessions`: + venue_id text, playing_area_id uuid, team_id uuid→club_teams, scheduled_at,
  status (scheduled|cancelled), …

### Risk flags carried into the build
1. **Bump is destructive** — auto-moving/cancelling an existing booking means notifications and
   (once Stripe live) refunds. Confined to **club-team-vs-club-team** only (decision below).
2. **Retroactivity** — a reserved window added *after* a booking already sits in it can't safely
   auto-evict it; windows act **prospectively** (block new non-qualifying bookings); pre-existing
   conflicts surface as an operator warning to resolve by hand.
3. **`venue_create_booking` is the operator's own hand** — operator booking a walk-in should be
   able to override their own reserved window (warning, not hard block). The external gate belongs
   primarily on the **casual** path (`book_pitch_adhoc`/`_series`).
4. **inorout/core touch** — `book_pitch_adhoc`/`_series` live in the casual flow; gating them
   pulls in `packages/core`/`apps/inorout` → **casual-regression gate mandatory** for that phase.
   The reserved-window *config* (venue side) does NOT touch casual. The bump mechanism (#6) is
   trigger-/venue-driven and the inorout manager path assigns no pitch (mig 414) → inorout largely
   clean for #6, EXCEPT the manager accept/decline action (Phase 2) is exposed in the player app.
5. **Cross-venue scope** — a reserved window is per `playing_area_id`; rank comparison only makes
   sense among teams of the **same club**. Reallocation search spans the operator's same-company
   venues (reuse the multi-venue `venues.company_id` seam).
6. **Overload/cache** — DROP old signatures on any param change; `pg_notify('pgrst','reload schema')`
   after RPC changes.

---

## 2. LOCKED PRODUCT DECISIONS (operator, s195)

1. **Rank bumping is club-team-vs-club-team ONLY.** A higher-ranked club team auto-bumps a
   lower-ranked club team off a contested slot. A club team **never** auto-bumps a paying outside
   hire — outside hire is protected *up front* by reserved windows (#5), never retroactively
   evicted. (Operator did not object to internal-only; treated as settled.)
2. **Rank decides, not arrival order.** Whoever has the *worse* `priority_rank` yields the slot.
   Equal rank or NULL rank on either side → today's behaviour (first-come, polite `slot_unavailable`,
   no bump).
3. **Suggest-and-confirm, not silent auto-move.** On a bump:
   - The bumped event is set **tentative** immediately and **releases its pitch** (so it can't
     clash while in limbo).
   - The system computes the **closest available alternative** = nearest-in-time free slot,
     preferring the same venue, then the operator's other venues; it must NOT suggest a slot
     reserved for someone else.
   - The bumped team's **manager/admin is notified with the suggestion** ("Closest available:
     Pitch X at Venue Y, 7:30pm") and an **Accept / Decline**:
     - **Accept** → event moves to that pitch/venue/time and re-confirms (re-reserves occupancy;
       if taken in the meantime, re-suggest / stay tentative).
     - **Decline** → stays **tentative** + manager prompted to sort it ASAP.
   - **No alternative available at all** → straight to tentative + "sort ASAP".
4. **Tentative events hold no pitch** until a manager confirms a new slot.
5. **Both the venue operator (token) AND the club manager (auth.uid, player app)** can see and
   act on bump suggestions (accept / decline / re-book).
6. **Reuse the existing team-messaging spine** for notifications (club_announcements + broadcast
   cron / `notify_team_change`) — no parallel notification system. Audit every fire-and-forget
   write (Hard Rule #9).
7. **Reserved windows (#5)** are one flexible table supporting BOTH per-team and per-use-type:
   each window row carries an `audience` = `internal` | `team` | `min_rank` (+ optional
   `club_team_id` / `min_rank`). One table, no second system.

---

## 3. PHASED PLAN (each = own AUDIT→EXECUTE→VERIFY→COMMIT, merge before next)

### Phase 1 (mig 416) — Reserved-window schema + config RPCs + venue UI  *(no casual/core touch)*  🏁 SHIPPED s195
**Built exactly as scoped.** Read path = a dedicated company-scoped `venue_list_pitch_reserved_windows`
(NOT folded into `venue_get_state`/`get_operator_pitch_occupancy` — keeps the two big readers untouched);
BookingsView loads it once into a `reservedByPitch` Map passed to both grids + BookingSettings. Editor
lives in **BookingSettings** only (per-pitch, alongside bookable/prime hours; PitchForm left as-is).
Shading helper = `bookingUtil.reservedBands(windows, iso)`; band CSS `.sg-reserved` (token
`--reserved-soft`, `pointer-events:none` so tap-to-book still works through it). Gates all PASS
(rpc-security 2 fns, EV 9/9 + leak 0, build venue + hygiene 7/7 + venue hex-clean, Playwright config
smoke 0 errors). ⛔ owed venue deploy + device eyeball.

Original scope:
- **New table** `pitch_reserved_windows`: `id uuid pk`, `playing_area_id uuid →playing_areas
  (CASCADE)`, `venue_id text →venues`, `day_of_week smallint 0–6`, `start_time time`,
  `end_time time`, `audience text CHECK ('internal','team','min_rank')`, `club_team_id uuid NULL
  →club_teams`, `min_rank int NULL`, `note text NULL`, `created_at`. RLS-on, REVOKE anon/auth
  (RPC-only).
- **Config RPCs** (venue token, `manage_facility` cap, SECDEF + `SET search_path` + audit insert):
  `venue_set_pitch_reserved_windows(token, playing_area_id, windows jsonb)` (replace-set per pitch)
  + read via either `venue_list_pitch_reserved_windows` or fold into the `venue_get_state` pitches
  projection. JS wrappers + barrel.
- **Venue UI:** "Reserved times" editor in `PitchForm.jsx` / `BookingSettings.jsx` (reuse the
  existing `booking_windows` window-editor pattern), with a team/rank picker sourced from
  `club_list_teams`. Render reserved bands as a calm background tint on `ScheduleGrid` /
  `AllGroundsGrid` (NO new occupancy rows — purely advisory shading at this phase).
- **Gates:** rpc-security; ephemeral-verify (own `_e2e_` venue+club+teams → set windows → read
  back → leak 0); build venue + hygiene 7/7 + hex; Playwright config smoke. casual-regression N/A.

### Phase 2 (mig 417) — Enforcement + rank bumping (the big one)  *(touches core/inorout → casual-regression)*
- **External gate (#5):** shared definer helper `_pitch_window_blocks(playing_area_id, time_range,
  requester_kind, requester_rank)` → returns the blocking window or null. Gate
  `book_pitch_adhoc`/`book_pitch_series` (external) against `internal`/`team`/`min_rank` windows →
  new error `slot_reserved`. `venue_create_booking` (operator) → **warning-only** (returns
  `warning:'reserved'`, still books — operator override).
- **Internal bump (#6):** change the club-session/club-fixture occupancy resolution from blind
  hard-block to **rank-aware**:
  - On insert/move, if the slot is held by another club activity, compare `priority_rank`.
  - Incoming **better** rank → bump the existing: set its event **tentative**, release its
    occupancy, compute closest-available suggestion (across same-company venues, skipping reserved
    windows), store the suggestion, notify the bumped team's managers (accept/decline).
  - Incoming **worse/equal/NULL** rank → existing keeps the slot; incoming behaves as today
    (`slot_unavailable`) OR (nice-to-have) is itself offered the closest-available suggestion.
  - Mechanism: likely a SECDEF resolver function the triggers call (keep the trigger-per-table
    shape from mig 414 so no release path is missed), plus a small `pitch_bump_proposals` store
    (or columns on the event) for the suggested slot + tentative state.
- **New "tentative" state** on `club_sessions` / `club_fixtures` (status value or flag); tentative
  events write **no** occupancy.
- **Accept/decline RPCs:** venue-token + auth.uid (manager) variants → move event to suggested slot
  (re-reserve; re-suggest on race) or keep tentative. Audit + notify.
- **Gates:** rpc-security; **ephemeral-verify MANDATORY** (qualifying passes / non-qualifying
  `slot_reserved` / operator override / rank bump → tentative + suggestion / accept moves & reserves
  / decline stays tentative / no-alt path / leak 0); **casual-regression MANDATORY** (touches
  `book_pitch_*`); build venue+inorout + hygiene + hex; Playwright.

### Phase 3 (likely no mig) — surface rank + tentative on the calendar
- Rank badge (⭐/`#n`) on club occupancy blocks; clear "Tentative — needs attention" state; the
  suggested-slot accept/decline prompt surfaced for managers (player app + venue console). UI-only.

---

## 4. NEXT-SESSION KICKOFF PROMPT (paste-ready)

> **Pilot backlog #5 + #6 — Phase 1 (reserved-window foundation).** Read `PITCH_PRIORITY_HANDOFF.md`
> in full first — the audit + locked product decisions are done; do NOT re-litigate them. Run a full
> AUDIT → EXECUTE → VERIFY → COMMIT cycle (skills/audit.md first, plan mode, no edits during audit;
> present the plan in chat, not ExitPlanMode).
>
> Build Phase 1 ONLY: new `pitch_reserved_windows` table (mig **416**) + venue-token config RPCs
> (`manage_facility` cap, SECDEF/search_path/audit) `venue_set_pitch_reserved_windows` +
> read path, JS wrappers + barrel, and the venue-app "Reserved times" editor in PitchForm /
> BookingSettings (reuse the `booking_windows` editor pattern; team/rank picker from
> `club_list_teams`) with calm background shading of reserved bands on ScheduleGrid + AllGroundsGrid.
> NO enforcement and NO bumping yet (that's Phase 2). Internal-vs-external follows `source_kind`
> (already clean) — Phase 1 is config + display only.
>
> Gates: rpc-security sweep + ephemeral-verify (own `_e2e_` venue+club+teams, set→read→leak 0),
> build venue + hygiene 7/7 + hex, Playwright config smoke, schema-sync if any existing column
> changes (none expected — additive table). casual-regression N/A (no core/inorout touch in P1).
> Same-commit docs (SCHEMA.md new table, RPCS.md new RPCs + Notes/consumers per Hard Rule #14,
> STRATEGY.md/FEATURES.md #5/#6, BUGS/DECISIONS/CONTEXT as needed) + memory update. Confirm off
> `main` that next free mig is still 416 before writing SQL. Give me the next-session prompt in chat
> at the end.

---

## 5. STATUS
- s195 (design): audit + design LOCKED.
- s195 (build): **🏁 PHASE 1 SHIPPED (mig 416).** `pitch_reserved_windows` table + 2 venue config RPCs +
  JS wrappers/barrel + BookingSettings "Reserved times" editor + advisory shading on ScheduleGrid +
  AllGroundsGrid. Config + display only (no enforcement, no bumping). All gates PASS. **Next free mig = 417.**
- **NEXT = Phase 2 (mig 417)** — external gate (`_pitch_window_blocks` → `book_pitch_*` → `slot_reserved`;
  `venue_create_booking` warn-only) + rank-driven club-team bump (tentative + suggest-and-confirm) +
  accept/decline RPCs. **Touches `book_pitch_*` → casual-regression MANDATORY** + ephemeral-verify MANDATORY.
</content>
</invoke>
