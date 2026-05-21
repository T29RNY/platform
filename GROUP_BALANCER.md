# GROUP BALANCER — Build Spec

*Last updated: May 21 2026 (session 30)*

Lightweight organiser-assisted team balancing system inside
`apps/inorout/src/views/AdminView/TeamsScreen.jsx`.

Admin assigns IN players to numbered groups (1–5). The app splits each group
evenly across Team A and B, using win rate as a quiet within-group tiebreaker.
**Interaction is tap-to-assign — no drag-and-drop.** No scores, ratings, or
rankings are ever visible to players.

---

## CORE PRINCIPLES

- No player scores visible anywhere — not in UI, not in API responses
- Admin stays in control — groups are a suggestion, not a lock
- Degrades gracefully — works from week 1 with zero history
- Tap-to-assign interaction (no drag): tap a chip → group panels highlight →
  tap target panel. Bulletproof on mobile, accessible, zero drag library
- Follows AUDIT → EXECUTE → VERIFY → COMMIT methodology

---

## ARCHITECTURE DECISIONS (AGREED)

**Storage:** `group_number int DEFAULT NULL CHECK (group_number BETWEEN 1 AND 5)`
added to `team_players` table. Per-player, per-team, persists across weeks,
survives confirm. Cleared only when admin explicitly removes a player from groups.

**Groups:** Adaptive 1–5. Only populated groups shown. "Needs Group" always shown
if any players are ungrouped.

**Generation algorithm:**
1. Separate IN players into groups (1–5) and `needsGroup` pool
2. For each group with 3+ players: try all 50/50 splits, pick lowest win-rate
   delta between resulting A and B sides. Random tiebreak when delta < 5% so
   rerolls feel varied
3. Groups of 1–2: assign directly, alternating A/B
4. `needsGroup` players: same win-rate nudge across remaining pool
5. Return `{ teamA: [playerIds], teamB: [playerIds] }`

**Win rate source:** `tableData` from `getPlayerLeagueTable` — already fetched
in AdminView for StatsView. Players with null win rate placed randomly.

**Interaction:** Tap-to-assign. Tap a player chip → enters "assigning" mode
(chip pulses, group panels glow as targets) → tap a group panel to assign.
Tap chip again or tap outside to cancel. No drag library required.

**Chemistry:** Not in this build. Phase 2+ once match history is deep enough.

---

## OPEN QUESTIONS TO RESOLVE IN STAGE 1A AUDIT

1. **Guest team_players rows** — does `add_guest_player` RPC create a
   `team_players` entry? If not, `admin_set_player_group` will fail for guests.
   Must confirm before writing SQL.
2. **Reserve list interaction** — AdminView reserve list uses some form of
   reordering. Audit current pattern; tap-to-assign elsewhere doesn't require
   consistency but worth noting.
3. **tableData in AdminView** — confirm it's already fetched and available to
   thread to TeamsScreen, or identify where the fetch needs adding.

---

## STAGE PLAN

### STAGE 1 — Data layer

**1A — AUDIT (no edits)**
- `add_guest_player` RPC SQL — guest team_players row question
- `admin_set_vice_captain` RPC — template for new group RPC
- `get_team_state_by_admin_token` squad SELECT — where `group_number` slots in
- `packages/core/storage/supabase.js` — `dbToPlayer` mapping + `addPlayerToTeam`
- AdminView reserve list — current reorder pattern
- Report findings only. No edits.

**1B — SQL (applied in Supabase SQL editor, not Claude Code)**

```sql
ALTER TABLE team_players
  ADD COLUMN group_number int DEFAULT NULL
  CHECK (group_number BETWEEN 1 AND 5);

CREATE OR REPLACE FUNCTION admin_set_player_group(
  p_admin_token text,
  p_player_id text,
  p_group_number int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  UPDATE team_players
    SET group_number = p_group_number
    WHERE team_id = v_team_id AND player_id = p_player_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
```

If guests need a `team_players` row fix, that SQL goes here too.

**1C — supabase.js + barrel (one execute prompt)**
- Add `setPlayerGroup(adminToken, playerId, groupNumber)` wrapper
- Update `dbToPlayer` to map `r.group_number ?? null`
- Update `get_team_state_by_admin_token` squad SELECT to include `tp.group_number`
- Export `setPlayerGroup` from `packages/core/index.js`

**Verify 1:**
- `setPlayerGroup` in exactly one `supabase.rpc()` call
- `group_number` in `dbToPlayer` and admin RPC squad SELECT
- Build clean

**Commits:**
- `feat(schema): add group_number to team_players + admin_set_player_group RPC`
- `feat(core): setPlayerGroup wrapper + dbToPlayer + admin RPC squad select`

---

### STAGE 2 — Generation algorithm

**2A — AUDIT (no edits)**
- Current Fisher-Yates logic in TeamsScreen.jsx
- `getPlayerLeagueTable` return shape — confirm `winRate` field name + null behaviour
- Report findings only

**2B — Execute: new file `packages/core/engine/groupBalancer.js`**

Pure function, no Supabase calls, fully testable in isolation.

```
generateBalancedTeams(players, tableData)
  players    — current IN squad with groupNumber field
  tableData  — from getPlayerLeagueTable, win rate lookup only
  returns    — { teamA: [playerIds], teamB: [playerIds] }
```

Algorithm detail:
- Build `winRateMap` from `tableData` (playerId → winRate, null if missing)
- Group players by `groupNumber` (null → `needsGroup`)
- For each group ≥ 3 players:
  - Shuffle first
  - Enumerate all 50/50 splits (or sample if group > 8)
  - Score each split: `|avgWinRateA - avgWinRateB|` (skip null players in avg)
  - Collect splits within 5% of best score → pick randomly from those
- For groups of 1–2: straight across, alternating A/B
- `needsGroup`: same win-rate nudge across pool, fill remaining slots
- Header comment: `// Group numbers are admin-only. Never expose to player routes.`

**Verify 2:**
- No Supabase imports in `groupBalancer.js`
- Edge cases handled: all `needsGroup`, single player, odd totals, all null win rates
- Build clean

**Commit:** `feat(engine): groupBalancer — balanced generation with win-rate nudge`

---

### STAGE 3 — TeamsScreen UI

**3A — AUDIT (no edits)**
- Read TeamsScreen.jsx in full
- Map all state variables, props, handlers, existing generate/confirm/clear flow
- Identify where GROUP BALANCER section slots in the render tree
- Report findings only

**3B — Execute: state + data wiring (TeamsScreen.jsx)**
- `localGroups` state: `{ [playerId]: groupNumber }` initialised from squad prop
- `assigningPlayerId` state: the chip currently in assign mode (null when idle)
- `handleSelectChip(playerId)`: toggles assign mode for that chip
- `handleAssignToGroup(groupNumber)`: commits the assignment via
  `setPlayerGroup(adminToken, playerId, groupNumber)` with optimistic update +
  revert on error
- `handleCancelAssign()`: clears `assigningPlayerId` (tap outside, escape)
- Replace Fisher-Yates call with `generateBalancedTeams(inPlayers, tableData)`
- `tableData` added as new prop (wired in Stage 4)

**3C — Execute: Group Balancer UI (TeamsScreen.jsx)**

New section above existing player pool:

```
GROUP BALANCER  [▲ collapse toggle]

┌─ Needs Group ──────────────────────┐  ← amber tint if count > 0
│  [chip] [chip] [chip]              │
└────────────────────────────────────┘

┌─ Group 1  [N] ─────────────────────┐  ← blue tint
│  [chip] [chip]                     │
└────────────────────────────────────┘

┌─ Group 2  [N] ─────────────────────┐  ← purple tint
│  [chip] [chip] [chip]              │
└────────────────────────────────────┘

[ + New Group ]   ← shown if active groups < 5
```

Player chip anatomy: `[avatar] [name]` — tap to enter assign mode

Group panel tints (visual differentiation only, not ability-ranked):
- Group 1: `#60A0FF` border + `rgba(96,160,255,0.08)` bg
- Group 2: `var(--purple)` border + `rgba(176,96,240,0.08)` bg
- Group 3: `var(--green)` border + `rgba(61,220,106,0.08)` bg
- Group 4: `var(--amber)` border + `rgba(255,176,32,0.08)` bg
- Group 5: `var(--red)` border + `rgba(255,64,64,0.08)` bg
- Needs Group: `var(--amber)` border + `var(--amber2)` bg

Tap-to-assign visual states:
- Idle: chips and panels at rest
- Assigning (`assigningPlayerId` set): source chip pulses (CSS animation),
  group panels glow with box-shadow + slight scale, tap outside cancels
- Tap a panel: commit assignment, exit assign mode

Needs Group warning:
- If any players in Needs Group when Generate tapped: amber inline banner
  "X players have no group — they'll be placed randomly" with "Generate Anyway"
  confirm. Does not block.

Collapse behaviour:
- Default collapsed if ALL players have a group assigned
- Default expanded if ANY players in Needs Group

**Verify 3:**
- `generateBalancedTeams` called in exactly one place
- `setPlayerGroup` called from `handleAssignToGroup` only
- All existing confirm/clear/reroll flows still work
- Tap-to-assign works on mobile (test in browser touch emulation)
- Tap outside cancels assign mode
- Build clean

**Commits:**
- `feat(teams): Group Balancer state + data wiring + replace Fisher-Yates`
- `feat(teams): Group Balancer UI — tap-to-assign panels, Needs Group`

---

### STAGE 4 — AdminView wiring

**4A — AUDIT (no edits)**
- Confirm `tableData` fetch location in AdminView/index.jsx
- Confirm `adminToken` already reaches TeamsScreen (expect yes per session 21)
- Report findings only

**4B — Execute (AdminView/index.jsx)**
- Pass `tableData` to TeamsScreen as new prop
- No other changes

**Verify 4:**
- `tableData` prop on TeamsScreen render site
- Build clean

**Commit:** `feat(admin): thread tableData to TeamsScreen for balanced generation`

---

### STAGE 5 — Polish

**5A — Execute (TeamsScreen.jsx)**
- New arrival chip: players who became IN after last group save get amber
  "NEW" badge in Needs Group
- Group count badge on each panel header
- Empty state: hide GROUP BALANCER entirely if squad < 4 players
- Reroll: confirm noise floor produces different teams on consecutive rerolls
- Header comment in `groupBalancer.js`: `// Group numbers are admin-only. Never expose to player routes.`

**Verify 5:**
- Full flow: assign groups → generate → reroll → confirm → reopen (groups persist)
- Guest players: group assignment works (or gracefully skipped if no `team_players` row)
- Odd player counts: no crash, Team A gets the extra
- All null win rates: teams still generate, no crash
- Build clean

**Commit:** `feat(teams): Group Balancer polish — new arrival, edge cases`

---

## COMMIT SEQUENCE SUMMARY (7 commits)

1. `feat(schema): add group_number to team_players + admin_set_player_group RPC`
2. `feat(core): setPlayerGroup wrapper + dbToPlayer + admin RPC squad select`
3. `feat(engine): groupBalancer — balanced generation with win-rate nudge`
4. `feat(teams): Group Balancer state + data wiring + replace Fisher-Yates`
5. `feat(teams): Group Balancer UI — tap-to-assign panels, Needs Group`
6. `feat(admin): thread tableData to TeamsScreen for balanced generation`
7. `feat(teams): Group Balancer polish — new arrival, edge cases`

---

## TIME ESTIMATE

| Stage | Raw work | With methodology overhead |
|---|---|---|
| 1 — Data layer (SQL + wrapper) | ~1h | ~1.5h |
| 2 — `groupBalancer.js` algorithm | ~1h | ~1.5h |
| 3 — TeamsScreen UI (tap-to-assign) | ~2–3h | ~3–4h |
| 4 — AdminView wiring | ~20min | ~30min |
| 5 — Polish + edge cases | ~1h | ~1.5h |
| **Total** | **~5.5–7h** | **~8–9h** |

**Calendar:** 2–3 sessions. Slot into May 27–29 window after Stage 2 ships.

**Risk buffer:**
- Guest `team_players` row gap (if audit confirms): +1h for migration + RPC change
- Reroll noise tuning: +30min
- Worst case: ~11h / 3 sessions

---

## WHAT WE ARE EXPLICITLY NOT BUILDING

- Player-visible group numbers or rankings
- Chemistry-based optimisation (Phase 2+)
- Automatic group suggestions based on stats
- Group labels ("strong", "weak", "anchor" etc.)
- MMR, balance scores, or any numerical ability signal in the UI
- Drag-and-drop (tap-to-assign was chosen for mobile reliability — see DECISIONS.md)
