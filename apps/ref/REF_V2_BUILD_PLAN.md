# Ref V2 — Build Plan (the "RefSix-killer" cycle)

**Status:** AUDIT COMPLETE — awaiting go on migration 1. Nothing applied to live DB yet.
**Companion docs:** `REDESIGN_SPEC.md` (what the app does today), the new design
(self-contained artifact `IoO Ref (standalone).html` at repo root — the visual contract).
**Methodology:** standard `AUDIT → EXECUTE → VERIFY → COMMIT`. Every migration gets
schema-sync + ephemeral-verify; every RPC gets the rpc-security-sweep; PWA changes get a
real-iPhone test before commit.

---

## 1. Vision

Turn the referee's phone into the **nervous system of the venue**, not an isolated
stopwatch. RefSix is a closed loop on one wrist. Ours: the ref's thumb drives the
reception big screen, the venue dashboard, the league table and top scorers, and the
public live page — every tap visible everywhere in **under a second**. That ecosystem
fan-out is the moat; the beautiful broadcast-dark design is the face.

Two non-negotiables from the operator: **data flows must be unambiguous**, and the
**UX must be phenomenal** (pitch-side, gloves, rain, sunlight, flaky signal).

---

## 2. Locked decisions (the contract)

1. **Build for real** (not cosmetic): sin bin, incident notes, clock pause, added/stoppage time.
2. **Sin bin ships for the pilot** (football, June 18).
3. **Live fan-out: all the way** — reception + venue + league + public live page.
4. **Do NOT redesign the reception display** — it is already a finished live board. The
   only display-side change is consuming the new live pings + a paused indicator + "+3".
5. **App stays in `apps/ref`** — keeps the deploy, the `/ref/<TOKEN>` link, the offline
   queue. We rebuild only its *view layer* from the new design and strip the demo
   scaffolding (iOS device frame + demo switcher).
6. **Pause is per-match, offline-safe**, and the clock **counts toward the period length**
   (from config) and prompts half/full time.
7. **Added time is persisted + advertised** on reception/venue screens ("45 +3").
8. **Config is layered**: league default → competition override → fixture/ref override
   (override is **flagged** to venue/league for fairness). Modernise the stale Phase-0
   `league_config` and wire it (writes + reads) for the first time.
9. **Multi-writer rule:** the ref **owns the match while `in_progress`**; the venue may only
   correct the record **after full time** (or via an explicit take-over). No concurrent writers.
10. **Football-first, sport-extensible** event vocabulary and period model — futureproofed,
    not multi-sport on day one.

---

## 3. What already exists (reuse map — do not rebuild)

- **9 ref RPCs** already shipped and idempotent: `getFixtureStateByRefToken`, `refStartMatch`,
  `refRecordGoal`, `refRecordCard`, `refRecordSubstitution`, `refSetPeriod`, `refUndoEvent`,
  `refConfirmFullTime`, `refRecordKnockoutDecider`. The new design's stubs match these 1:1.
- **IndexedDB offline queue** + drain-on-reconnect (`apps/ref/src/lib/offlineQueue.js`),
  idempotent on `client_event_id` (UNIQUE on `match_events`).
- **Reception display** (`apps/display`) already renders live scores **derived from
  `match_events`**, live minute, momentum, event strip, goal-celebration overlay, Golden Boot
  top scorers, live standings, goals ticker. It refetches on any `venue_live:<key>` broadcast.
- **`league_config`** already has `match_duration_mins`, `has_halves`, `half_duration_mins`,
  `has_sin_bin`, `sin_bin_mins` — but read-only, unwired, and only models "halves".

**Live broadcast — already wired (verified against live DB).** mig 121 added
`notify_venue_change` (→ `venue_live:<key>`, key from `venues.live_channel_key`, venue
resolved via `_ref_venue_id_for_fixture`) to all seven ref RPCs, and mig 187 preserved it on
full-time + the decider. So the reception display + venue dashboard **already light up on
every existing ref event** — no retrofit. Remaining live work is only: (a) the NEW RPCs call
the same `notify_venue_change` (+ two new reasons in its whitelist), and (b) `get_display_state`
carries pause + added_time so the screen can render the freeze and "+3".

**Out of scope (optional later):** the standalone league *web app* (apps/league) subscribes to
no realtime channel — it's refresh-only. The live league table + Golden Boot that matter for the
pilot already render on the reception display via `venue_live`, so the public live surface is
covered; making apps/league itself live is a separate add.

---

## 4. Data model changes (migrations)

> Numbers assigned at apply time; one logical unit per migration; `_down.sql` for each.

**M1 — fixtures clock + stoppage + override**
- `clock_paused_at timestamptz` — when the current pause began (NULL = running).
- `clock_paused_ms bigint NOT NULL DEFAULT 0` — accumulated paused time.
- `added_time jsonb NOT NULL DEFAULT '{}'` — stoppage minutes per period, e.g. `{"1H":2,"2H":4}`.
- `format_override jsonb` — per-fixture timing override (NULL = inherit). Presence = "ref/venue
  changed this match," surfaced as a flag to venue/league.

**M2 — match_events extensions**
- `note_text text` — for `note` events.
- `duration integer` — sin-bin minutes for `sin_bin` events.
- (No new constraints; `event_type`/`period` stay open text for sport-extensibility.)

**M3 — league_config modernisation (period model)**
- `num_periods integer` (1 = single, 2 = halves, 4 = quarters, …).
- `period_length_mins integer` (length of each period).
- `period_names text[]` (e.g. `{1H,2H}` or `{Q1,Q2,Q3,Q4}`).
- Keep `match_duration_mins` (derived/headline) + `sin_bin_mins`. Back-fill `num_periods`
  from `has_halves` for existing rows; leave `has_halves` in place for back-compat.

---

## 5. RPC surface

### New (each: SECURITY DEFINER, search_path locked, audit_events row, broadcasts `venue_live`)
- `ref_set_clock(token, action, client_event_id, local_timestamp)` — `action ∈ {pause,resume}`.
  Idempotent on `client_event_id`. Pause sets `clock_paused_at = local_timestamp` if running;
  resume adds `local_timestamp − clock_paused_at` to `clock_paused_ms` and clears it.
  **Offline-safe:** uses the client's pause/resume timestamp, so a queued pause reconstructs
  the exact frozen duration on drain.
- `ref_record_note(token, {text, playerId?, minute, period, clientEventId, localTimestamp})`.
- `ref_record_sin_bin(token, {playerId, minute, period, durationMin, clientEventId, localTimestamp})`.
- `ref_set_added_time(token, {period, minutes, clientEventId, localTimestamp})` — sets the
  absolute per-period stoppage value; broadcasts so screens show "+N".
- `update_league_config(token, leagueId, config)` — UPSERT. Granted to **venue ops + super
  admin**. Validates the caller owns the league.

### Already live (no retrofit — confirmed in mig 121 + 187)
- All seven existing ref RPCs already call `notify_venue_change` → `venue_live`. The new RPCs
  reuse the same helper; add two new reasons (`match_clock_changed`, `match_added_time_changed`)
  to its whitelist. (`note`/`sin_bin` are match_events → reuse the existing `match_event_recorded`.)

### Extended (existing functions, additive)
- **`superadmin_create_venue`** — first-league block also seeds a `league_config` row with the
  match-format fields.
- **`get_fixture_state_by_ref_token`** — return resolved match-format config (league →
  competition → fixture override), pause state (`clock_paused_at`, `clock_paused_ms`),
  `added_time`, and the override flag.
- **`get_display_state`** — add `clock_paused_at`, `clock_paused_ms`, `added_time` to
  `live_fixtures` so the board freezes and shows "+3".

---

## 6. Data flows (the heart of this build)

### 6.1 Live event — ref tap to every screen
```
Ref taps Goal
  → optimistic event added to local UI (instant)        [feels native, no spinner]
  → written to IndexedDB BEFORE network                 [survives crash/lock]
  → undo toast (30s)                                    [tap to retract]
  → ref RPC fires (refRecordGoal)
      → INSERT match_events (idempotent on client_event_id)
      → audit_events row
      → broadcast venue_live:<venueKey> {reason:'goal'}  ← NEW
  → display/venue subscribers receive ping → refetch get_display_state
      → running score (derived from match_events) ticks, celebration fires, ticker updates
  → ref RPC returns → local queue row deleted → reconcile with server truth
```
Latency target: on-screen everywhere **< 1s**.

### 6.2 Undo retracts everywhere
```
Ref taps Undo (within 30s)
  → if still queued (offline): delete IndexedDB row, drop from UI
  → else: refUndoEvent → DELETE match_events → broadcast venue_live
  → display refetches → score/event removed from the big screen
```

### 6.3 Offline queue + drain
```
Offline: writes succeed locally (IndexedDB) + UI updates; reads serve last-known.
Banner shows "Offline · N queued". beforeunload guard while pending.
Back online (or Retry): drain queue in order → each idempotent RPC → delete on success
  → final reconcile via getFixtureStateByRefToken.
```

### 6.4 Pause — per-match, offline-safe
```
Ref taps Pause
  → THIS fixture's clock freezes locally (optimistic)
  → ref_set_clock('pause', cid, localTs) [queues if offline]
      → fixtures.clock_paused_at = localTs ; broadcast venue_live
  → display computes elapsed with the SHARED formula:
      elapsed = now − kickoff − clock_paused_ms − (paused? now − clock_paused_at : 0)
  → only THIS match's tile freezes + shows "⏸ PAUSED"; other matches keep ticking
Resume reverses it; paused duration accumulates into clock_paused_ms.
```
Shared elapsed helper lives in `packages/core` so ref and display can never disagree.

### 6.5 Added / stoppage time
```
Ref nudges +1 on the current period
  → fixtures.added_time[period] updated via ref_set_added_time → broadcast
  → ref clock shows target + added; display shows "45 +3"
Distinct from pause: added time is displayed stoppage; pause freezes the clock entirely.
```

### 6.6 Config resolution (league → competition → fixture)
```
league_config (default for the league)
  └─ competition.config.match_format (optional override, e.g. cup ET/pens)
       └─ fixtures.format_override (optional per-match, ref/venue — FLAGGED)
get_fixture_state_by_ref_token returns the RESOLVED config + an `is_overridden` flag.
Ref clock counts toward period_length, prompts "Half time?" / "Full time?" at the mark.
Venue/league see the flag wherever the fixture is shown.
```

---

## 7. UX spec (phenomenal, pitch-side)

- **Broadcast-dark scoreboard**, teal primary, Archivo/Hanken, score-flip + glow on goals.
- **Daylight mode** (one tap) for sunlight legibility; **wake lock** keeps the screen on.
- **Big tap targets** (58px player rows), **haptics** on every action, **undo within reach**.
- **One sheet per player**: tap player → action sheet (Goal / Yellow / Red / Sub off) +
  secondary row (Own goal / Sin bin / Note). Red locks further cards; second yellow → confirm → red.
- **Sin bin**: 10-min countdown badge on the player; "may return" alert + haptic on expiry.
- **Notes**: free-text incident composer, optionally attached to a player; lands in the report.
- **Pause**: control on the scoreboard; clock freezes; spectator-facing "⏸ PAUSED".
- **Period control dock**: 1H → "Half time" → "Start second half" → "Full time" (knockout level →
  decider sheet: ET steppers + ABAB penalty tracker with sudden death).
- **Match log sheet**: newest-first event list, per-event sync dot (synced/pending), undo latest,
  added-time stepper, add note.
- **Config-aware clock**: counts toward the configured period length; prompts at the mark; shows
  a subtle flag if this match's timing was overridden.
- Strip the **iOS device frame** and **demo switcher** (dev-only scaffolding).

---

## 8. Build order & verification gates

1. **M1–M3 migrations** — schema-sync each; drafts reviewed **before** live apply.
2. **New + retrofitted RPCs** — rpc-security-sweep; **ephemeral-verify every write RPC**
   (own throwaway `_e2e_` fixture, auto-rollback, leak-check).
3. **Wire `venue_live` broadcast** onto all ref RPCs — prove end-to-end the board lights up.
4. **Ref app re-skin** — port design into `apps/ref` multi-file React; real wrappers; new
   features; config-driven clock; sport-extensible vocab. Build clean.
5. **Venue + superadmin** — league-config edit screens (`update_league_config`).
6. **Display** — consume new pings + paused indicator + "+3". No redesign.
7. **VERIFY** — ephemeral-verify, real-iPhone PWA test, end-to-end live proof, then COMMIT.
   Update `FEATURES.md`, `RPCS.md`, `SCHEMA.md`, `DECISIONS.md` as features land.

---

## 9. Futureproofing notes

- `event_type` / `period` stay open text → other sports (futsal, hockey, rugby) extend the
  vocabulary without schema change.
- Config layering leaves room for competition-level overrides without reshaping.
- Shared clock helper in `packages/core` is the single source of truth for elapsed/minute.
- Top scorers: `get_display_state` already computes them; the **league app's** standings RPC
  still stubs `top_scorers` to `[]` — unify onto the same derivation in a later pass so the
  public league page matches the big screen.
