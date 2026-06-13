# Ref App — Functional Spec for Visual Redesign

**Purpose of this doc:** hand the redesigner everything the Ref app *does* — every
piece of data it receives, every action it can take, every state it can be in, and
every conditional that shows/hides/disables a control. NO visual or styling guidance.
The redesigner owns layout, colour, type, motion. This doc owns "what must be wireable."

The app is `apps/ref` — a Vite + React SPA. It is a single-purpose tool for one human:
the **match-day referee** standing pitch-side on a phone, with possibly flaky signal.
There is no login. Auth is a single opaque `ref_token` in the URL.

---

## 0. ENTRY, AUTH, ROUTING

- **URL shapes accepted** (`App.jsx` → `readTokenFromUrl`):
  - `?token=<TOKEN>` query param, OR
  - path segment `/ref/<TOKEN>`
- If **no token** → render a fallback "enter your token" card with a single text input
  + submit. On submit it writes `?token=…` into the URL (replaceState) and proceeds.
- With a token, the app calls one RPC — `get_fixture_state_by_ref_token(token)` — and
  routes purely on `state.fixture.status`:

  | `fixture.status`        | Screen rendered |
  |-------------------------|-----------------|
  | `in_progress`           | **LiveMatch**   |
  | `completed`             | **PostMatch**   |
  | anything else¹          | **PreMatch**    |

  ¹ `scheduled`, `allocated`, plus the terminal-but-not-completed states
  `void`, `postponed`, `walkover`, `forfeit` — PreMatch renders these as banners itself.

- **App-level UI states** (before any screen):
  - **Loading** — "Loading match…" while the RPC is in flight (only when no state yet).
  - **Error** — card with a message + a "Use a different link" button that clears the token.
    Special-cased: an `invalid_ref_token` error gets a friendly "link not recognised, ask
    the venue admin to resend" message; any other error shows raw.
- There is **no realtime subscription** in the ref app. Refresh is manual (a Refresh button)
  or implicit (after every successful write the app re-fetches the whole state).

---

## 1. THE DATA CONTRACT — what every screen receives

Every screen is handed the single `state` object returned by
`get_fixture_state_by_ref_token`. Full shape:

```
state = {
  fixture: {
    id, competition_id, home_team_id, away_team_id,
    week_number, round_name,
    scheduled_date,            // ISO date 'YYYY-MM-DD'
    kickoff_time,              // 'HH:MM[:SS]' or null
    playing_area_id, official_id,
    status,                    // drives routing (see above)
    home_score, away_score,    // final scores; only set once completed
    actual_kickoff_at,         // ISO timestamp — set when ref starts the match; drives the live clock
    walkover_winner_id, forfeit_winner_id,
    postpone_reason, void_reason, forfeit_reason
  },
  competition: { id, name, type, format, season_id },
  league:      { id, name, sport, venue_id, format },
  venue:       { id, name, sport },
  pitch:       { id, name, surface } | null,          // playing area
  official:    { id, name, preferred_channel } | null, // the assigned referee
  home_team:   { id, name, primary_colour, secondary_colour },
  away_team:   { id, name, primary_colour, secondary_colour } | null,  // null = bye
  home_squad:  [ squadPlayer… ],
  away_squad:  [ squadPlayer… ],   // [] when away_team is a bye
  events:      [ matchEvent… ],    // server-confirmed events, ordered by minute then created_at
  caller:      { actor_type:'ref_token', fixture_id }
}

squadPlayer = {
  id, name,
  shirt_number,              // int or null
  registration_status,       // e.g. 'active'
  suspension_until,          // ISO timestamp or null — player is suspended if this is in the future
  lineup_role                // 'starting' | 'bench' | null
}
```

**`lineup_role` is the key squad nuance:** if the team submitted a teamsheet, every
player is tagged `starting` or `bench` and the squad is ordered starting-first. If no
teamsheet was submitted, every player has `lineup_role: null` and it's a flat registered
list. The UI must handle BOTH: a Starting/Bench split when any player has a role, else a
flat list. (Detected by `squad.some(p => p.lineup_role)`.)

```
matchEvent = {
  id,                        // server id; absent on optimistic local events
  event_type,                // 'goal' | 'own_goal' | 'yellow_card' | 'red_card'
                             //   | 'substitution' | 'period_change'
  minute, period,
  team_id, player_id,
  player_name_override,      // for guest/unregistered players
  sub_player_on_id, sub_player_off_id,   // substitution only
  client_event_id,           // UUID generated client-side; the idempotency + undo key
  recorded_by_type, synced_at, local_timestamp, created_at
}
```

**Score and period are DERIVED from `events`, never read from a field:**
- **Period** = the `period` of the most recent `period_change` event; default `'1H'`.
- **Score** = count `goal` events to the scorer's team; count `own_goal` events to the
  *opposite* team. (The RPC stores an own_goal under the scorer's own `team_id`; the client
  flips it for display.)

---

## 2. PRE-MATCH SCREEN

Shown for non-started fixtures. Two modes: **normal** (can start) and **terminal banner**.

### Data shown
- **Header:** eyebrow line = `venue.name · competition.name · Week N · round_name`
  (each segment conditional on presence); title "Pre-match"; subtitle instruction.
- **Kickoff strip** — two cells:
  - Kickoff time + date (from `scheduled_date` + `kickoff_time`; "Time TBC" if no date).
  - Pitch name + referee name (or "No referee assigned") + pitch surface.
- **Two squad cards** (home, away):
  - Team name + a colour swatch (`primary_colour`).
  - Count line: `N starting · M subs` if lineup submitted, else `N players`.
  - Player rows: shirt number (or `—`), name, and a **"Susp" flag** if
    `suspension_until` is a future date.
  - If lineup submitted → "Starting" subhead + list, then "Bench" subhead + list.
  - Empty state per card: "No confirmed squad yet".
  - Away card shows "(bye)" when there's no away team.

### Terminal-state mode
If `fixture.status` is `completed` / `void` / `postponed` / `walkover` / `forfeit`, the
Start control is replaced by a **banner** (label varies, e.g. "Match voided",
"Postponed — <reason>", "Decided by walkover", "Forfeit — <reason>", "Result already
recorded"). If `home_score`/`away_score` exist, a final-score line is shown too. Squads
still render. Only a **Refresh** button is offered.

### Start Match control — the kickoff gate
- A constant `EARLY_WINDOW_MIN = 15`: the Start button unlocks freely from 15 min before
  kickoff onward. A live 1-second ticker recomputes this without a refresh.
- **Inside the window** (`unlocksInMin <= 0`, or no scheduled kickoff): plain **Start Match**
  button → fires immediately on tap. Plus a "Refresh squads" ghost button.
- **Outside the window** (too early): the button is **gated**. It becomes a
  **press-and-hold** control — hold for `HOLD_MS = 3000` (3s) to override and start early.
  - Needs a visible **fill/progress** affordance driving 0→100% over the hold (the current
    code feeds a `--hold` CSS var + a countdown "Keep holding · Ns").
    Releasing early cancels and resets.
  - Hint text below shows when it'll unlock: "Unlocks in N min / N h / N days" or
    "Unlock available".
- **On start:** calls `refStartMatch(token, newUUID, nowISO)`, then re-fetches state. The
  server flips `status` → `in_progress` and stamps `actual_kickoff_at`, so the app
  re-renders into LiveMatch. Double-fire guarded. Errors show inline under the button.

---

## 3. LIVE MATCH SCREEN — the core tool

This is the screen that needs the most care. The ref taps events on it in real time.

### Top bar — always visible
- **Running clock** `MM:SS`, derived from `now − actual_kickoff_at`, ticking every second.
  (It counts continuously from kickoff; it does NOT stop at half time — there is no stored
  stoppage. The minute stamped on events is `floor(elapsed/60)`.)
- **Live score** `home – away`, derived from events.
- **Period chip** showing the current period (`1H` / `HT` / `2H` / `ET1` / `ET2` / `PEN`).

### Offline / sync banner — conditional
Shows whenever `pendingCount > 0` OR the browser is offline. Two visual states:
- **Offline:** "Offline · N events queued"
- **Syncing (back online, draining):** "Syncing · N events pending"
- Appends a drain error message if the last replay attempt failed.
- Includes a **Retry** button that manually re-runs the drain loop.

### Two team columns (home + away), each:
- Header: colour swatch + team name.
- Empty state: "No confirmed squad".
- One **player row** per squad player. Each row shows:
  - Shirt number (or `—`) + name.
  - **Live badges** derived from events: ⚽ goals (with `×N` if >1), `OG` own goals,
    🟨 yellows (`×N`), 🟥 red.
  - **Four action buttons** per player:
    1. **Goal** (⚽) — *tap* = goal; *long-press 600ms* = **own goal**. (Single button,
       `GoalButton`, distinguishes tap vs long-press via a pointer timer.)
    2. **Yellow** (🟨) — see two-yellow logic below.
    3. **Red** (🟥) — disabled once the player already has a red.
    4. **Substitution** (↕️) — opens the sub picker.

### Action logic / guards
- **All four actions are disabled when period is `HT` or `FT`** (`locked`). Events can only
  be recorded during a playing period.
- **Two yellows → red:** tapping Yellow on a player who already has one yellow pops a
  `confirm()` "already has a yellow. Show red?" — Yes records a red. (No automatic stacking;
  it's an explicit confirm.)
- **Red lock:** once a player has a red, the red button is disabled and further cards are
  blocked (except the system won't re-issue).
- **Substitution flow:** tap ↕️ on the player going OFF → a **modal/overlay** opens titled
  "Sub OFF: <name>" listing every *other* player in that team's squad as a tappable row
  (shirt + name). Tapping one records the substitution (on for off). Cancelable. Picking the
  same player is a no-op.

### Every event write — the optimistic + offline pattern (critical to preserve)
This behaviour is load-bearing and must survive the redesign untouched in *function*:
1. Tap generates a `client_event_id` (UUID).
2. The event is **immediately** added to local state (optimistic — badges/score/clock update
   instantly).
3. An **undo toast** appears (see below).
4. The event row is written to **IndexedDB** (`offlineQueue.js`) BEFORE any network call.
   - If IDB write fails (rare — private Safari/quota), it `alert()`s, rolls back the
     optimistic event, and clears the toast.
5. `pendingCount` increments.
6. The matching `ref_*` RPC fires. On success → delete the IDB row, decrement pending,
   re-fetch state. On failure → leave the row queued (no error shown; offline is expected).
- A **drain loop** replays queued rows: on mount, on the browser `online` event, and on
  manual Retry. It stops on first failure (assumes transient). Every `ref_*` RPC is
  idempotent on `client_event_id`, so replays are safe no-ops.
- **beforeunload guard:** if `pendingCount > 0`, closing the tab triggers a browser confirm.

### Undo toast
- After every event, a single toast shows the event label (e.g. "Goal — Jordan",
  "Yellow — Sam", "Sub — A on for B") with an **Undo** button. Visible `UNDO_WINDOW_MS = 30000`
  (30s), then auto-dismisses.
- **Undo logic:** if the event is still only queued (never synced) → just delete the queue
  row, server never saw it. If already synced → call `refUndoEvent(token, clientEventId)`.
  Either way the optimistic event is removed and state re-fetched.

### Period progression controls (bottom)
A single contextual button depending on current period:
- `1H` → **Half Time** button (sets period `HT`).
- `HT` → **Start 2H** button (sets period `2H`).
- `2H` / `ET1` / `ET2` / `PEN` → **Full Time** button (opens the FT confirm modal).
- (`ET1`/`ET2`/`PEN` periods exist in the model and as derived labels, but normal flow only
  surfaces HT and FT toggles; extra-time/pens are entered via the decider modal below, not as
  general period buttons in the current UI.)

### Full Time confirm modal
- "Confirm full time?" with the final score line and a warning that no more events can be
  added afterward (admin can correct later). Cancel / Confirm.
- On confirm → `refConfirmFullTime(token)`. **Two outcomes:**
  - Normal → state re-fetched, app flips to PostMatch.
  - `{ needs_decider: true, home_score, away_score }` → it's a **level cup knockout**; opens
    the **Decider modal** instead.

### Decider modal (knockout tie level at full time)
- Shows the level score after normal time.
- Inputs (numeric): **Extra time** home/away, **Penalties** home/away (both optional, but at
  least one pair required).
- **Who goes through?** — two team toggle buttons (single-select).
- Save enabled only when a winner is picked AND at least one of (AET pair / pens pair) is
  filled. Submits via `refRecordKnockoutDecider(token, {aetHome, aetAway, pensHome, pensAway,
  winnerTeamId})`; server validates consistency. On success → re-fetch → PostMatch.

---

## 4. POST-MATCH SCREEN — read-only

Shown when `status === 'completed'`. The ref **cannot edit anything** — corrections are an
admin function.

- **Header:** eyebrow (venue · competition · Week N), title "Full time", subtitle.
- **Final score block:** each team with swatch + name + final score (`fixture.home_score` /
  `away_score`).
- **Scorers section:** list of all `goal`/`own_goal` events sorted by minute — icon (⚽ or 🥅
  for OG), player name (resolved from squad maps, falling back to id), an "OG" tag, and
  `minute′ · period`. Empty state "No goals."
- **Cards section** (only if any): 🟨/🟥 + name + `minute′ · period`.
- **Subs section** (only if any): ↕️ + "<on> on for <off>" + `minute′ · period`.
- **Share result button:** builds a plain-text summary (score line + goals with minutes/OG
  tags + cards) and copies to clipboard (`navigator.clipboard`); falls back to a `prompt()`
  if clipboard blocked. Button label flips to "Copied!" for 2s.
- **Correction note:** static text telling the ref to ask the venue admin for changes.

---

## 5. THE RPC SURFACE (for reference — all already wired, do not change signatures)

All live in `packages/core/storage/supabase.js`. The redesign must keep calling these
unchanged.

| Wrapper | When called | Returns |
|---|---|---|
| `getFixtureStateByRefToken(token)` | initial load + after every write | full `state` |
| `refStartMatch(token, clientEventId, nowISO)` | Start Match | — |
| `refRecordGoal(token, {playerId, minute, period, clientEventId, ownGoal, localTimestamp})` | goal / own-goal tap | — |
| `refRecordCard(token, {playerId, minute, period, colour, clientEventId, localTimestamp})` | yellow/red | — |
| `refRecordSubstitution(token, {onPlayerId, offPlayerId, minute, period, clientEventId, localTimestamp})` | sub picker choose | — |
| `refSetPeriod(token, period, clientEventId, localTimestamp)` | HT / 2H toggles | — |
| `refUndoEvent(token, clientEventId)` | Undo (synced event) | — |
| `refConfirmFullTime(token)` | Full Time confirm | `{}` or `{needs_decider, home_score, away_score}` |
| `refRecordKnockoutDecider(token, {aetHome, aetAway, pensHome, pensAway, winnerTeamId})` | Decider submit | — |

Offline queue helpers (`apps/ref/src/lib/offlineQueue.js`): `enqueue`, `deletePending`,
`listPending(fixtureId)`, `isPending(clientEventId)` — IndexedDB store `ioo-ref-queue`,
keyed on `client_event_id`, indexed `by_fixture`.

---

## 6. CONSTANTS / TUNABLES (keep the behaviour, restyle the affordance)

| Constant | Value | Meaning |
|---|---|---|
| `EARLY_WINDOW_MIN` | 15 | Start unlocks this many minutes before kickoff |
| `HOLD_MS` | 3000 | Press-and-hold duration to override the early gate |
| `LONG_PRESS_MS` | 600 | Goal-button long-press → own goal |
| `UNDO_WINDOW_MS` | 30000 | How long the undo toast stays |

---

## 7. WHAT THE REDESIGN MUST NOT BREAK (functional invariants)

1. Optimistic-first + IndexedDB-before-network ordering on every event write.
2. `client_event_id` generated once per tap and threaded through optimistic event → queue →
   RPC → undo. It's the idempotency *and* undo key.
3. Score/period are derived from `events`, never trusted from a field.
4. Own-goal scores the opposite team; tap-vs-long-press on the goal button.
5. All event actions disabled during `HT`/`FT`.
6. Two-yellow → red confirm; red locks further cards.
7. The kickoff gate (early-window + 3s hold override).
8. Full-time → decider branch for level knockouts.
9. The offline/sync banner + manual Retry + beforeunload guard while events are pending.
10. PostMatch is strictly read-only.
