# GROUP BALANCER — Full Scope Document
*Session handoff — paste alongside CONTEXT.md at the start of each session*
*Last updated: May 22 2026 (pre-flight addendum appended)*

---

## HOW TO USE THIS DOCUMENT

Work through stages sequentially. Complete Audit → Execute → Verify → Commit
for each stage before proceeding to the next. Do not read ahead. Do not begin
a stage until the previous commit is confirmed clean.

At Stage 1B, STOP. Output the SQL block for the developer to run manually in
the Supabase SQL editor. Do not write any JS until the developer confirms the
SQL has been applied and the schema cache reloaded.

Follow CODING_SKILL.md methodology throughout.
AUDIT → EXECUTE → VERIFY → COMMIT. No edits during audit prompts.

---

## CONTEXT BLURB — READ THIS FIRST

This document specifies the Group Balancer feature for TeamsScreen.jsx. Read
it in full before writing any code. Every architectural decision is recorded
here with its rationale. Do not deviate without flagging a conflict first.

**What this feature is:**
The Group Balancer lets an admin assign players to numbered groups (1–5) that
persist across weeks. When generating teams, the algorithm splits each group
evenly across Team A and B, using win rate as a quiet within-group tiebreaker.
The app also predicts the match outcome at confirmation time and tracks
prediction accuracy as the dataset grows. Players tap chips to move them
between groups — no drag and drop, no external library.

**Why it exists:**
Casual football admins have strong intuitions about player ability but no tool
to encode that knowledge. The current Fisher-Yates shuffle ignores everything
the admin knows. Group Balancer gives them a lightweight, persistent way to
influence team balance without ratings, scores, or rankings ever being visible
to players.

**The single non-negotiable principle:**
Win rates, confidence scores, group numbers, balance deltas, and group labels
are NEVER visible to players in any form — not in player routes, not in push
notifications, not in match history (until predictions are proven accurate,
see Future Opportunities), not in IO Intelligence. Admin eyes only.

**What already exists that this builds on:**
- `TeamsScreen.jsx` — Fisher-Yates generate, teams_draft save, confirm flow,
  push notification on confirm. This feature replaces Fisher-Yates with the
  group balancer algorithm. All other flows unchanged.
- `team_players` table — already has `team_id`, `player_id`,
  `is_vice_captain`. We add `group_number` here.
- `teams_draft` jsonb on matches — still used. Balancer output populates
  draft first, admin confirms. No change to confirm/clear flow.
- `admin_set_vice_captain` RPC (migration 012) — template for the new
  `admin_set_player_group` RPC. Same pattern: admin token → team_id →
  UPDATE team_players.
- `get_team_state_by_admin_token` (migration 010) — already returns squad
  with team_players join. We add `tp.group_number` to the squad SELECT here
  only — NOT in `get_team_state_by_player_token`.
- `settings` table — already has `group_name` column. Group labels stored as
  new `group_labels jsonb` column on settings. `admin_upsert_settings` RPC
  already handles settings writes — we extend it.
- `audit_events` table — already exists for admin mutations. Group assignment
  changes logged here for future group mobility insights.
- `matches` table — `winner`, `team_a`, `team_b` already exist. We add
  `predicted_winner`, `predicted_confidence`, `balance_score`.
- Migration files live at `rls_migrations/` in the repo root.

**What this feature does NOT touch:**
- `get_team_state_by_player_token` RPC — group_number must never appear here
- `players_public` view — never use `tp.*`; always name columns explicitly
- StatsView, MyIOView, HistoryView render logic (except the null-safe
  prediction chip in Stage 5 — only renders when predicted_winner IS NOT NULL,
  so silent on all existing matches)
- Reserve list drag implementation — separate cleanup pass later
- Push notification content
- Any direct table reads or writes — all DB via SECURITY DEFINER RPCs

**No new npm dependencies.** Tap-to-move interaction replaces drag and drop.
No dnd-kit. No external library needed.

---

## PRE-FLIGHT CHECKLIST
*All resolved in scoping. Confirmed before any SQL is written.*

**PF-1: Guest players have no team_players row.**
`add_guest_player` RPC does not create a `team_players` entry. Resolution:
exclude `isGuest === true` players from the group UI entirely. Guests still
appear in the final team output via the existing assignment flow. Filter
applied in TeamsScreen before building `localGroups` and before passing
players to the algorithm.

**PF-2: `group_number` CHECK constraint must allow NULL.**
Correct constraint: `CHECK (group_number IS NULL OR group_number BETWEEN 1 AND 5)`.
NULL = unassigned (Needs Group). Never treat 0 as unassigned.

**PF-3: Win rate null vs 0.0 are different.**
`null` = no data. `0.0` = played games, lost all of them. The algorithm must
skip `null` in win rate averaging but MUST include `0.0`. Always check
`=== null`, never falsy.

**PF-4: `group_number` must NOT appear in the player-facing RPC.**
When adding `tp.group_number` to the admin squad SELECT, explicitly confirm
it is absent from `get_team_state_by_player_token` (migration 010). Verified
in Stage 1A audit.

**PF-5: Win rates must not leak into player-visible state.**
`generateBalancedTeams` returns `{ teamA, teamB, predictedWinner,
predictedConfidence, balanceScore, avgGamesPlayed, disclaimerLevel }`.
Only `teamA` and `teamB` arrays flow into `teams_draft` and onward to
player-visible state. All other return fields stay in TeamsScreen admin
scope only.

**PF-6: `tableData` is not currently in AdminView.**
StatsView owns its own `getPlayerLeagueTable` fetch internally. AdminView
needs its own fetch added in Stage 2C. Mark as dedup target for Phase 2.

---

## CONSTANTS
*Defined at the top of TeamsScreen.jsx. Easy to tune as real data accumulates.*

```js
const MIN_TEAM_GAMES = 30
const MIN_AVG_PLAYER_GAMES = 8
const PREDICTION_DRAW_THRESHOLD = 0.05
const PREDICTION_STRONG_THRESHOLD = 0.30
```

---

## SCHEMA ADDITIONS
*All applied in Stage 1B as one SQL block in the Supabase SQL editor.*

### team_players
```sql
ALTER TABLE team_players
  ADD COLUMN group_number int DEFAULT NULL
  CHECK (group_number IS NULL OR group_number BETWEEN 1 AND 5);
```

### settings
```sql
-- group_labels: {"1": "Regulars", "2": "Occasionals", ...}
-- NULL when no labels set. Sparse — only populated group numbers present.
ALTER TABLE settings
  ADD COLUMN group_labels jsonb DEFAULT NULL;
```

### matches
```sql
-- 'draw' covers both genuine draws AND delta < 5% (too close to call).
-- too_close is NOT a valid value — not in CHECK constraint.
ALTER TABLE matches
  ADD COLUMN predicted_winner text
    CHECK (predicted_winner IN ('A', 'B', 'draw')) DEFAULT NULL;

-- Raw win rate delta 0.00–1.00. Never shown in any UI.
-- Stored for future model improvement and platform analytics only.
ALTER TABLE matches
  ADD COLUMN predicted_confidence numeric(4,2) DEFAULT NULL;

-- Same value as predicted_confidence at confirm time.
-- Stored separately: balance score has meaning even when prediction is draw.
ALTER TABLE matches
  ADD COLUMN balance_score numeric(4,2) DEFAULT NULL;
```

### audit_events
No schema change. Uses existing table with:
```
event_type: 'group_assigned'  payload: { player_id, group_from, group_to }
event_type: 'groups_cleared'  payload: {}
```

---

## RPC ADDITIONS AND CHANGES

### New: `admin_set_player_group`
```sql
CREATE OR REPLACE FUNCTION admin_set_player_group(
  p_admin_token  text,
  p_player_id    text,
  p_group_number int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id   text;
  v_old_group int;
BEGIN
  SELECT id INTO v_team_id
    FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT group_number INTO v_old_group
    FROM team_players
    WHERE team_id = v_team_id AND player_id = p_player_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'player_not_found');
  END IF;

  UPDATE team_players
    SET group_number = p_group_number
    WHERE team_id = v_team_id AND player_id = p_player_id;

  INSERT INTO audit_events (team_id, event_type, payload)
    VALUES (
      v_team_id,
      'group_assigned',
      jsonb_build_object(
        'player_id',  p_player_id,
        'group_from', v_old_group,
        'group_to',   p_group_number
      )
    );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION admin_set_player_group(text, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION admin_set_player_group(text, text, int)
  TO authenticated;
```

Note: passing NULL for p_group_number clears the assignment. The CHECK
constraint `IS NULL OR BETWEEN 1 AND 5` accepts this. PostgreSQL NULL
parameter passing works correctly here.

### New: `admin_clear_all_groups`
```sql
CREATE OR REPLACE FUNCTION admin_clear_all_groups(
  p_admin_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id text;
BEGIN
  SELECT id INTO v_team_id
    FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  UPDATE team_players
    SET group_number = NULL
    WHERE team_id = v_team_id;

  INSERT INTO audit_events (team_id, event_type, payload)
    VALUES (v_team_id, 'groups_cleared', jsonb_build_object());

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION admin_clear_all_groups(text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_clear_all_groups(text) TO authenticated;
```

### Modified: `admin_upsert_settings`
Add parameter `p_group_labels jsonb DEFAULT NULL`.
In the upsert body write:
`group_labels = COALESCE(p_group_labels, settings.group_labels)`
so a null argument never wipes existing labels.

### Modified: `admin_save_teams` (the confirmTeams RPC)
Add three parameters:
```
p_predicted_winner     text    DEFAULT NULL
p_predicted_confidence numeric DEFAULT NULL
p_balance_score        numeric DEFAULT NULL
```
In the matches UPDATE, write these three fields alongside `team_a`/`team_b`.

### Modified: `get_team_state_by_admin_token` — squad SELECT (migration 010)
Add `tp.group_number` to the squad player `jsonb_build_object`.
Edit ONLY this RPC. Do not touch `get_team_state_by_player_token`.

### Modified: `get_team_state_by_admin_token` — settings SELECT (migration 010)
Return `s.group_labels` in the settings object within the state response.

### NOT modified: `get_team_state_by_player_token`
Do not add `group_number` here. Verify explicitly in Stage 1A audit.

---

## STAGE PLAN

---

### STAGE 1 — Data Layer

#### 1A — AUDIT (no edits)

Paste this prompt to Claude Code verbatim:

```
Read the following files in full and report findings only. No changes.
Migration files are in rls_migrations/ in the repo root.

1. Find the migration file containing add_guest_player RPC.
   Report: does it INSERT a team_players row? Report the exact INSERT
   statements in the function body.

2. Find the migration file containing admin_set_vice_captain RPC.
   Report the full function body — this is the template for
   admin_set_player_group.

3. Find migration 010 containing get_team_state_by_admin_token and
   get_team_state_by_player_token.
   Report:
   a. Exact columns selected from team_players in the admin squad SELECT
   b. Exact columns selected from team_players in the player squad SELECT
   c. Confirm group_number is absent from both (it does not exist yet)

4. Find the migration file containing admin_upsert_settings.
   Report the full function body and current parameter list.

5. Find the migration file containing admin_save_teams (the confirmTeams RPC).
   Report the full function body and current parameter list.

6. In packages/core/storage/supabase.js report:
   a. dbToPlayer() — full mapping block
   b. confirmTeams() — full function signature and body
   c. Any existing group-related function (expect: none)
   d. getPlayerLeagueTable() — confirm exact field names for winRate,
      played, and playerId in the return objects

7. In apps/inorout/src/views/AdminView/index.jsx report:
   a. Is tableData fetched or stored anywhere? Report any stats fetches.
   b. The TeamsScreen render site and current props passed to it
   c. Is matchHistory available in AdminView scope? If yes, confirm its
      shape includes cancelled and winner fields on each entry.

8. In apps/inorout/src/views/AdminView/TeamsScreen.jsx report:
   a. All state variables and initial values
   b. All props received by the component
   c. Fisher-Yates generate function — exact logic and line numbers
   d. handleConfirm — exact flow and arguments passed to confirmTeams
   e. handleClear / handleClearConfirm — exact flow

Report findings only. No edits.
```

#### 1B — SQL STOP

**STOP after 1A. Do not write any JS.**

Output the complete SQL block from the SCHEMA ADDITIONS and RPC ADDITIONS
AND CHANGES sections above in this exact order, formatted for copy-paste
into the Supabase SQL editor:

1. ALTER TABLE team_players ADD COLUMN group_number
2. ALTER TABLE settings ADD COLUMN group_labels
3. ALTER TABLE matches ADD COLUMN predicted_winner
4. ALTER TABLE matches ADD COLUMN predicted_confidence
5. ALTER TABLE matches ADD COLUMN balance_score
6. CREATE OR REPLACE FUNCTION admin_set_player_group (full body)
7. REVOKE / GRANT for admin_set_player_group
8. CREATE OR REPLACE FUNCTION admin_clear_all_groups (full body)
9. REVOKE / GRANT for admin_clear_all_groups
10. Modified admin_upsert_settings — add p_group_labels param + COALESCE write
11. Modified admin_save_teams — add three prediction params + write to matches
12. Modified get_team_state_by_admin_token — add tp.group_number to squad
    SELECT and group_labels to settings SELECT
13. Schema cache reload:
    `SELECT pg_notify('pgrst', 'reload schema');`

Tell the developer to run all of the above in the Supabase SQL editor,
then run this verification query and confirm 5 rows come back:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('team_players', 'settings', 'matches')
  AND column_name IN (
    'group_number', 'group_labels',
    'predicted_winner', 'predicted_confidence', 'balance_score'
  );
```

Wait for developer confirmation before proceeding to 1C.

#### 1C — Execute: supabase.js + barrel

One execute prompt. Make only these changes.

In `packages/core/storage/supabase.js`:

- `dbToPlayer`: add `groupNumber: r.group_number ?? null`
- Settings mapping (dbToSettings or inline): add
  `groupLabels: r.group_labels ?? {}`
- New `setPlayerGroup(adminToken, playerId, groupNumber)`:
```js
async function setPlayerGroup(adminToken, playerId, groupNumber) {
  // groupNumber: int 1-5 or null to clear
  const { data, error } = await supabase.rpc('admin_set_player_group', {
    p_admin_token:  adminToken,
    p_player_id:    playerId,
    p_group_number: groupNumber
  })
  if (error) throw error
  return data
}
```
- New `clearAllGroups(adminToken)`:
```js
async function clearAllGroups(adminToken) {
  const { data, error } = await supabase.rpc('admin_clear_all_groups', {
    p_admin_token: adminToken
  })
  if (error) throw error
  return data
}
```
- New `saveGroupLabels(adminToken, groupLabels)`:
  Calls `admin_upsert_settings` with the new `p_group_labels` param.
  Pass all existing settings fields through unchanged alongside it.
  Check the current `admin_upsert_settings` wrapper signature from the
  1A audit and extend — do not replace parameters.
- `confirmTeams` updated to full new signature:
```js
async function confirmTeams(
  adminToken, matchId, teamId,
  teamA, teamB,
  predictedWinner = null,
  predictedConfidence = null,
  balanceScore = null
)
```
  Pass three new params to the RPC as `p_predicted_winner`,
  `p_predicted_confidence`, `p_balance_score`.

In `packages/core/index.js`:
- Export `setPlayerGroup`, `clearAllGroups`, `saveGroupLabels`
- Confirm `confirmTeams` is already exported — do not duplicate

**Verify 1C:**
```bash
grep -r "admin_set_player_group" packages/ apps/
grep -r "admin_clear_all_groups" packages/ apps/
grep -r "setPlayerGroup" packages/ apps/
grep -r "clearAllGroups" packages/ apps/
grep -r "saveGroupLabels" packages/ apps/
grep "groupNumber" packages/core/storage/supabase.js
grep "groupLabels" packages/core/storage/supabase.js
```
Each RPC name must appear in exactly one `supabase.rpc()` call in
supabase.js and nowhere else in the codebase.

```bash
cd apps/inorout && npm run build
```

**Commits:**
```
feat(schema): group_number, group_labels, prediction fields, balance_score
feat(core): setPlayerGroup, clearAllGroups, saveGroupLabels, updated confirmTeams + dbToPlayer
```

---

### STAGE 2 — Generation Algorithm

#### 2A — AUDIT (no edits)

```
Read the following and report findings only. No changes.

1. apps/inorout/src/views/AdminView/TeamsScreen.jsx
   Confirm current state after Stage 1 changes. Report any drift from
   Stage 1A findings.

2. packages/core/storage/supabase.js — getPlayerLeagueTable()
   Confirm exact field names in return objects for:
   winRate (or win_rate?), played, playerId (or player_id?)
   Confirm null behaviour for players with no match history.

3. apps/inorout/src/views/AdminView/index.jsx
   Confirm tableData is NOT currently fetched (expect: not present).
   Confirm matchHistory shape — specifically whether each entry has
   a cancelled boolean field and a winner field.

Report findings only. No edits.
```

#### 2B — Execute: `packages/core/engine/groupBalancer.js` (NEW FILE)

Create a new file at exactly: `packages/core/engine/groupBalancer.js`

Pure function. Zero Supabase imports. Zero React imports.
Fully testable in isolation.

File header comment (required):
```js
// GROUP BALANCER — Pure generation function
// Group numbers and win rates are ADMIN-ONLY signals.
// Never expose either to player routes or any player-visible state.
// Only teamA and teamB in the return value may flow to players.
```

**Export:**
```js
export function generateBalancedTeams(players, tableData, opts = {})
export const PREDICTION_DRAW_THRESHOLD = 0.05
export const PREDICTION_STRONG_THRESHOLD = 0.30
```

**Parameters:**
- `players` — IN squad, pre-filtered by caller:
  `status === 'in' && !injured && !disabled && !isGuest`
  Each player has `{ id, groupNumber }` where groupNumber is 1–5 or null.
- `tableData` — array from getPlayerLeagueTable. Used only for win rate lookup.
- `opts` — `{ teamGames, MIN_TEAM_GAMES, MIN_AVG_PLAYER_GAMES }`
  All optional with safe defaults.

**Return shape:**
```js
{
  teamA: [playerIds],           // only these two may flow to player state
  teamB: [playerIds],
  predictedWinner: 'A'|'B'|'draw',
  predictedConfidence: 0.00–1.00,  // raw delta, never shown in UI
  balanceScore: 0.00–1.00,
  avgGamesPlayed: number,
  disclaimerLevel: 'none'|'mid'|'early'|'inconsistent'
}
```

**Full algorithm:**

```
STEP 1 — Build winRateMap
  Build { [playerId]: winRate } from tableData.
  Use the exact field name confirmed in 2A audit (winRate or win_rate).
  null if player absent from tableData — player has no history.
  0.0 is valid data — do not skip (check === null, never falsy).

STEP 2 — Separate players
  grouped = {}  keyed 1–5, only populate keys that have players
  needsGroup = players where groupNumber === null

STEP 3 — Initialise output
  teamA = []
  teamB = []
  nextSide = 'A'
  nextSide persists across ALL group iterations for odd-player balance.
  Never reset between groups.

STEP 4 — Process each populated group (sorted numerically 1 → 5)

  group.length === 1:
    push player to nextSide array
    flip nextSide

  group.length === 2:
    sort by winRate descending (null counts as 0 for sort only, not average)
    assign index 0 to nextSide, index 1 to other side
    flip nextSide

  group.length >= 3:
    Fisher-Yates shuffle the group (for variety when win rates are similar)
    half = Math.floor(group.length / 2)
    extra = group.length - (half * 2)  // 0 or 1
    if extra === 1: assign extra player to nextSide, flip nextSide

    Enumerate splits of remaining even-count players:
      if group.length <= 10: generate all C(n, half) combinations
      if group.length > 10:  sample 200 random splits

    Score each split:
      sideA_rates = winRateMap values for A-side players where value !== null
      sideB_rates = winRateMap values for B-side players where value !== null
      avgA = sideA_rates.length > 0 ? mean(sideA_rates) : 0.5
      avgB = sideB_rates.length > 0 ? mean(sideB_rates) : 0.5
      delta = Math.abs(avgA - avgB)

    Select winner:
      bestDelta = minimum delta across all splits
      candidates = splits where delta <= bestDelta + 0.05
      chosen = candidates[Math.floor(Math.random() * candidates.length)]
      This ensures rerolls feel different when multiple near-optimal splits exist.

    Append chosen split players to teamA / teamB

STEP 5 — Process needsGroup pool
  Apply same logic as STEP 4 group.length >= 3 case.
  Fill remaining slots alternating from current nextSide value.

STEP 6 — Compute prediction
  allRatesA = winRateMap values for all teamA playerIds where value !== null
  allRatesB = winRateMap values for all teamB playerIds where value !== null
  avgWinRateA = allRatesA.length > 0 ? mean(allRatesA) : 0.5
  avgWinRateB = allRatesB.length > 0 ? mean(allRatesB) : 0.5
  signedDelta = avgWinRateA - avgWinRateB
  absDelta = Math.abs(signedDelta)

  balanceScore = absDelta
  predictedConfidence = absDelta

  predictedWinner:
    absDelta < PREDICTION_DRAW_THRESHOLD (0.05) → 'draw'
    signedDelta > 0 → 'A'
    signedDelta < 0 → 'B'

  avgGamesPlayed:
    mean of (tableData lookup for each player).played ?? 0
    for all players in full lineup (teamA + teamB)

STEP 7 — Compute disclaimerLevel
  const { teamGames = 0,
          MIN_TEAM_GAMES = 30,
          MIN_AVG_PLAYER_GAMES = 8 } = opts

  teamGames < 15                                            → 'early'
  avgGamesPlayed < 5                                        → 'inconsistent'
  teamGames < MIN_TEAM_GAMES || avgGamesPlayed < MIN_AVG_PLAYER_GAMES → 'mid'
  otherwise                                                 → 'none'
```

Export `generateBalancedTeams` from `packages/core/index.js` barrel.

**Verify 2B:**
```bash
grep -r "supabase" packages/core/engine/groupBalancer.js      # expect 0
grep -r "import.*react" packages/core/engine/groupBalancer.js # expect 0
grep "generateBalancedTeams" packages/core/index.js           # expect 1
cd apps/inorout && npm run build
```

Manually verify these edge cases in the logic before committing:
- All players in needsGroup (no groups set) → produces valid split, no crash
- Single player total → goes to teamA, no crash
- All null win rates → avgWinRateA and avgWinRateB both 0.5 → delta 0 →
  predictedWinner 'draw' ✓
- winRate 0.0 is included in averaging (not treated as null) ✓
- Multiple groups each with odd count → nextSide alternates correctly
  ACROSS group boundaries, not resetting between groups ✓
- 5 players, groups of 2+3 → 3+2 split correctly, no crash ✓

**Commit:**
```
feat(engine): groupBalancer — win-rate nudge, prediction output, disclaimer levels
```

#### 2C — Execute: AdminView tableData fetch

In `apps/inorout/src/views/AdminView/index.jsx`:
- Add `const [tableData, setTableData] = useState([])`
- In the existing data load block (same place other initial fetches run):
```js
try {
  const result = await getPlayerLeagueTable(teamId, 'all')
  setTableData(result?.players ?? [])
} catch (err) {
  console.error('tableData fetch error:', err)
}
```
- Add `tableData={tableData}` to the `<TeamsScreen />` render site
- In `TeamsScreen.jsx` prop destructuring, add `tableData = []` with default

No other changes to either file.

**Verify 2C:**
```bash
grep "tableData" apps/inorout/src/views/AdminView/index.jsx
grep "tableData" apps/inorout/src/views/AdminView/TeamsScreen.jsx
cd apps/inorout && npm run build
```
Both files must show results. Build clean.

**Commit:**
```
feat(admin): fetch tableData in AdminView, thread to TeamsScreen
```

---

### STAGE 3 — TeamsScreen State + Wiring

#### 3A — AUDIT (no edits)

```
Read apps/inorout/src/views/AdminView/TeamsScreen.jsx in full.
Report:

1. All current state variables and initial values (after Stage 2 changes)
2. All props received
3. Exact line / location of the generate function call (now
   generateBalancedTeams — confirm Stage 2B wired correctly)
4. handleConfirm — exact current arguments passed to confirmTeams
5. handleClearConfirm — exact flow
6. Where in the JSX tree the player pool section (IN players list) renders
   — this will move below the new GROUP BALANCER section
7. Does matchHistory arrive as a prop? Confirm shape has cancelled + winner.
8. Any existing imports from animation or interaction libraries

Report findings only. No edits.
```

#### 3B — Execute: State + wiring (TeamsScreen.jsx)

Add the following state variables at the top of the component with
the other useState declarations:

```js
// Group Balancer
const [localGroups, setLocalGroups] = useState({})
const [groupLabels, setGroupLabels] = useState({})
const [editingLabel, setEditingLabel] = useState(null)
const [selectedPlayerId, setSelectedPlayerId] = useState(null)
const [groupsCollapsed, setGroupsCollapsed] = useState(false)
const [showClearGroupsConfirm, setShowClearGroupsConfirm] = useState(false)
const [prediction, setPrediction] = useState(null)
const [showNeedsGroupWarning, setShowNeedsGroupWarning] = useState(false)
const [manuallyAdjusted, setManuallyAdjusted] = useState(false)
```

Add this ref near other refs:
```js
const mountedPlayerIds = useRef(null)
```

Add these useEffect hooks:

```js
// Initialise localGroups — add new players, never overwrite existing entries
useEffect(() => {
  setLocalGroups(prev => {
    const next = { ...prev }
    squad
      .filter(p => !p.isGuest)
      .forEach(p => {
        if (!(p.id in next)) {
          next[p.id] = p.groupNumber ?? null
        }
      })
    return next
  })
}, [squad])

// Initialise groupLabels from settings
useEffect(() => {
  setGroupLabels(settings?.groupLabels ?? {})
}, [settings])

// Compute initial collapse state on mount only
useEffect(() => {
  const nonGuestIn = squad.filter(
    p => !p.isGuest && p.status === 'in' && !p.injured && !p.disabled
  )
  const allGrouped = nonGuestIn.length > 0 &&
    nonGuestIn.every(p => (p.groupNumber ?? null) !== null)
  setGroupsCollapsed(allGrouped)
  mountedPlayerIds.current = new Set(
    squad.filter(p => !p.isGuest).map(p => p.id)
  )
}, []) // mount only — intentionally empty deps
```

Add this derived value (with other useMemo calls):
```js
const inPlayersForGroups = useMemo(() =>
  squad.filter(p =>
    p.status === 'in' && !p.injured && !p.disabled && !p.isGuest
  ),
[squad])
```

Add these handlers:

```js
const handleSetGroup = async (playerId, groupNumber) => {
  const prev = localGroups[playerId] ?? null
  setLocalGroups(g => ({ ...g, [playerId]: groupNumber }))
  setSelectedPlayerId(null)
  try {
    await setPlayerGroup(adminToken, playerId, groupNumber)
  } catch (err) {
    console.error('handleSetGroup error:', err)
    setLocalGroups(g => ({ ...g, [playerId]: prev }))
    // show error using existing error toast pattern in this component
  }
}

const handleSetLabel = async (groupNumber, label) => {
  const trimmed = label.trim() || null
  const prev = groupLabels
  const next = trimmed
    ? { ...groupLabels, [String(groupNumber)]: trimmed }
    : Object.fromEntries(
        Object.entries(groupLabels).filter(([k]) => k !== String(groupNumber))
      )
  setGroupLabels(next)
  setEditingLabel(null)
  try {
    await saveGroupLabels(adminToken, next)
  } catch (err) {
    console.error('handleSetLabel error:', err)
    setGroupLabels(prev)
  }
}

const handleClearAllGroups = async () => {
  const prev = localGroups
  setLocalGroups({})
  setShowClearGroupsConfirm(false)
  try {
    await clearAllGroups(adminToken)
  } catch (err) {
    console.error('handleClearAllGroups error:', err)
    setLocalGroups(prev)
  }
}

const handleChipTap = (playerId) => {
  setSelectedPlayerId(prev => prev === playerId ? null : playerId)
}

const handlePanelTap = (groupNumber) => {
  if (!selectedPlayerId) return
  handleSetGroup(selectedPlayerId, groupNumber)
  // handleSetGroup clears selectedPlayerId
}
```

Replace the existing Fisher-Yates generate call with:
```js
const handleGenerate = () => {
  const needsGroupCount = inPlayersForGroups.filter(
    p => (localGroups[p.id] ?? null) === null
  ).length

  if (needsGroupCount > 0 && !showNeedsGroupWarning) {
    setShowNeedsGroupWarning(true)
    return
  }

  setShowNeedsGroupWarning(false)
  setManuallyAdjusted(false)

  const playersWithGroups = inPlayersForGroups.map(p => ({
    ...p,
    groupNumber: localGroups[p.id] ?? null
  }))

  const completedGames = (matchHistory ?? []).filter(
    m => !m.cancelled && m.winner
  ).length

  const result = generateBalancedTeams(playersWithGroups, tableData, {
    teamGames: completedGames,
    MIN_TEAM_GAMES,
    MIN_AVG_PLAYER_GAMES
  })

  setTeamA(result.teamA)
  setTeamB(result.teamB)
  setPrediction({
    winner: result.predictedWinner,
    confidence: result.predictedConfidence,
    balanceScore: result.balanceScore,
    avgGamesPlayed: result.avgGamesPlayed,
    disclaimerLevel: result.disclaimerLevel
  })
}
```

Update `handleConfirm` — extend confirmTeams call with three new trailing args:
```js
await confirmTeams(
  adminToken, matchId, teamId,
  teamA, teamB,
  prediction?.winner ?? null,
  prediction?.confidence ?? null,
  prediction?.balanceScore ?? null
)
```

Update `handleClearConfirm` — add at the top:
```js
setPrediction(null)
setManuallyAdjusted(false)
```

Add imports:
```js
import { generateBalancedTeams } from '@platform/core'
import { setPlayerGroup, clearAllGroups, saveGroupLabels } from '@platform/core'
```

**Verify 3B:**
```bash
grep "generateBalancedTeams" apps/inorout/src/views/AdminView/TeamsScreen.jsx
grep -i "fisher\|Math\.random\b" apps/inorout/src/views/AdminView/TeamsScreen.jsx
# Fisher-Yates must be gone — expect 0 results
grep "selectedPlayerId" apps/inorout/src/views/AdminView/TeamsScreen.jsx
grep "localGroups" apps/inorout/src/views/AdminView/TeamsScreen.jsx
grep "prediction" apps/inorout/src/views/AdminView/TeamsScreen.jsx
cd apps/inorout && npm run build
```

**Commit:**
```
feat(teams): Group Balancer state, tap-to-move handlers, prediction state, replace Fisher-Yates
```

---

### STAGE 4 — Group Balancer UI

#### 4A — AUDIT (no edits)

```
Read apps/inorout/src/views/AdminView/TeamsScreen.jsx in full.
Report:

1. Exact JSX location and surrounding landmarks where the GROUP BALANCER
   section should be inserted — it goes ABOVE the existing player pool /
   team assignment section.
2. How the existing player pool section is structured — component or
   inline JSX?
3. Confirm all new state from Stage 3B is present:
   selectedPlayerId, localGroups, groupLabels, prediction,
   showNeedsGroupWarning, manuallyAdjusted, groupsCollapsed,
   showClearGroupsConfirm, inPlayersForGroups, mountedPlayerIds.
4. Confirm NO dnd-kit or drag library imports exist.
5. Note the existing glass card, glow border, Bebas Neue heading patterns
   used elsewhere in this file for visual consistency.

Report findings only. No edits.
```

#### 4B — Execute: Group Balancer UI (TeamsScreen.jsx)

No new dependencies. Tap-to-move only.

**Add these derived values** (with other useMemo calls):

```js
const activeGroupNumbers = useMemo(() => {
  const nums = new Set(
    Object.values(localGroups).filter(n => n !== null)
  )
  return [1,2,3,4,5].filter(n => nums.has(n))
}, [localGroups])

const needsGroupPlayers = useMemo(() =>
  inPlayersForGroups.filter(p => (localGroups[p.id] ?? null) === null),
[inPlayersForGroups, localGroups])

const getPlayersInGroup = (groupNum) =>
  inPlayersForGroups.filter(p => localGroups[p.id] === groupNum)

const hasAnyGroupAssigned = useMemo(() =>
  inPlayersForGroups.some(p => (localGroups[p.id] ?? null) !== null),
[inPlayersForGroups, localGroups])
```

**Group panel style map** (const outside component):
```js
const GROUP_STYLES = {
  1: { border: '#60A0FF',                    bg: 'rgba(96,160,255,0.08)'   },
  2: { border: 'var(--purple)',              bg: 'rgba(176,96,240,0.08)'   },
  3: { border: 'var(--green)',               bg: 'rgba(61,220,106,0.08)'   },
  4: { border: 'var(--amber)',               bg: 'rgba(255,176,32,0.08)'   },
  5: { border: 'var(--red)',                 bg: 'rgba(255,64,64,0.08)'    },
  null: { border: 'var(--amber)',            bg: 'var(--amber2)'           },
}
```

**Prediction display copy** (const outside component):
```js
const predictionCopy = (winner, absDelta) => {
  if (winner === 'draw') return "Too close to call — should be an even game"
  const side = `Team ${winner}`
  if (absDelta >= PREDICTION_STRONG_THRESHOLD) return `${side} are strong favourites`
  if (absDelta >= 0.15) return `${side} are favoured`
  return `${side} have a slight edge`
}

const disclaimerCopy = {
  early:        "Predictions improve as your squad builds up more games together.",
  inconsistent: "Several players tonight don't have much history yet — this prediction may not reflect the game well.",
  mid:          "This prediction is based on early data — it gets sharper as regulars build up more games.",
  none:         null
}
```

**GROUP BALANCER JSX section** — insert above the existing player pool section.
Only render this section when `inPlayersForGroups.length >= 4`.

Structure:

```
{inPlayersForGroups.length >= 4 && (
  <div
    style={{ marginBottom: 16 }}
    onClick={(e) => {
      // Tap-outside deselect
      if (e.target === e.currentTarget) setSelectedPlayerId(null)
    }}
  >

    {/* ── HEADER ROW ── */}
    <div style={{ display:'flex', alignItems:'center',
                  justifyContent:'space-between', marginBottom:8 }}>
      <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:13,
                     color:'var(--t2)', letterSpacing:'0.1em' }}>
        GROUP BALANCER
      </span>
      <div style={{ display:'flex', gap:12, alignItems:'center' }}>
        {hasAnyGroupAssigned && !showClearGroupsConfirm && (
          <button
            onClick={() => setShowClearGroupsConfirm(true)}
            style={{ fontSize:11, color:'var(--t2)', background:'none',
                     border:'none', cursor:'pointer', padding:0 }}>
            Clear All
          </button>
        )}
        {showClearGroupsConfirm && (
          <>
            <span style={{ fontSize:11, color:'var(--t2)' }}>
              Clear all groups?
            </span>
            <button onClick={handleClearAllGroups}
              style={{ fontSize:11, color:'var(--red)', background:'none',
                       border:'none', cursor:'pointer', padding:0 }}>
              Yes, clear
            </button>
            <button onClick={() => setShowClearGroupsConfirm(false)}
              style={{ fontSize:11, color:'var(--t2)', background:'none',
                       border:'none', cursor:'pointer', padding:0 }}>
              Cancel
            </button>
          </>
        )}
        <button
          onClick={() => setGroupsCollapsed(c => !c)}
          style={{ background:'none', border:'none', cursor:'pointer',
                   color:'var(--t2)', display:'flex', alignItems:'center' }}>
          {groupsCollapsed
            ? <CaretDown weight="thin" size={16} />
            : <CaretUp   weight="thin" size={16} />}
        </button>
      </div>
    </div>

    {/* ── PANELS (collapsed = hidden) ── */}
    {!groupsCollapsed && (
      <>

        {/* Needs Group panel — always shown when expanded */}
        <GroupPanel
          groupNumber={null}
          label="NEEDS GROUP"
          players={needsGroupPlayers}
          selectedPlayerId={selectedPlayerId}
          mountedPlayerIds={mountedPlayerIds}
          onChipTap={handleChipTap}
          onPanelTap={() => handlePanelTap(null)}
          localGroups={localGroups}
          isReceiving={selectedPlayerId !== null}
        />

        {/* Active group panels */}
        {activeGroupNumbers.map(groupNum => (
          <GroupPanel
            key={groupNum}
            groupNumber={groupNum}
            label={groupLabels[String(groupNum)] || `Group ${groupNum}`}
            isEditingLabel={editingLabel === groupNum}
            onLabelTap={() => setEditingLabel(groupNum)}
            onLabelSave={(val) => handleSetLabel(groupNum, val)}
            players={getPlayersInGroup(groupNum)}
            selectedPlayerId={selectedPlayerId}
            mountedPlayerIds={mountedPlayerIds}
            onChipTap={handleChipTap}
            onPanelTap={() => handlePanelTap(groupNum)}
            localGroups={localGroups}
            isReceiving={selectedPlayerId !== null}
            canRemove={getPlayersInGroup(groupNum).length === 0}
            onRemove={() => {/* removes panel from display — no DB call needed */}}
          />
        ))}

        {/* Add Group button */}
        {activeGroupNumbers.length < 5 && (
          <button
            onClick={() => {
              const next = [1,2,3,4,5].find(
                n => !activeGroupNumbers.includes(n)
              )
              if (next) {
                // Add an empty panel by assigning a placeholder
                // Panel only shows when it has players or is explicitly added
                // For empty panel display, maintain a local emptyPanels Set
              }
            }}
            style={{
              width:'100%', padding:'8px', marginTop:8,
              background:'none', border:'0.5px dashed rgba(255,255,255,0.15)',
              borderRadius:10, color:'var(--t2)', fontSize:12,
              fontFamily:"'Bebas Neue',sans-serif", letterSpacing:'0.08em',
              cursor:'pointer'
            }}>
            + ADD GROUP
          </button>
        )}

      </>
    )}

  </div>
)}
```

**`GroupPanel` component** — define as a named function inside the file,
above the TeamsScreen component, or in the same file after it:

```jsx
function GroupPanel({
  groupNumber, label, players,
  selectedPlayerId, mountedPlayerIds,
  onChipTap, onPanelTap,
  localGroups, isReceiving,
  isEditingLabel, onLabelTap, onLabelSave,
  canRemove, onRemove
}) {
  const isNeedsGroup = groupNumber === null
  const style = GROUP_STYLES[groupNumber] ?? GROUP_STYLES[null]

  return (
    <div
      onClick={onPanelTap}
      style={{
        background: style.bg,
        border: `0.5px solid ${
          isReceiving && selectedPlayerId
            ? style.border   // glow when a player is selected
            : 'rgba(255,255,255,0.08)'
        }`,
        boxShadow: isReceiving && selectedPlayerId
          ? `0 0 0 1px ${style.border}`
          : 'none',
        borderRadius: 10,
        padding: '8px 10px',
        marginBottom: 8,
        cursor: isReceiving ? 'pointer' : 'default',
        transition: 'border 0.15s, box-shadow 0.15s'
      }}>

      {/* Panel header */}
      <div style={{ display:'flex', alignItems:'center',
                    justifyContent:'space-between', marginBottom:6 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {isNeedsGroup ? (
            <span style={{
              fontFamily:"'Bebas Neue',sans-serif", fontSize:11,
              color:'var(--amber)', letterSpacing:'0.08em'
            }}>
              NEEDS GROUP
            </span>
          ) : isEditingLabel ? (
            <input
              autoFocus
              defaultValue={label.startsWith('Group ') ? '' : label}
              placeholder={`Group ${groupNumber}`}
              maxLength={20}
              onBlur={e => onLabelSave(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--s3)', border: 'none',
                borderBottom: `1px solid ${style.border}`,
                color: 'var(--t1)', fontSize: 12,
                fontFamily: "'Bebas Neue',sans-serif",
                letterSpacing: '0.08em', outline: 'none',
                width: 100, padding: '2px 4px'
              }}
            />
          ) : (
            <span
              onClick={e => { e.stopPropagation(); onLabelTap?.() }}
              style={{
                fontFamily:"'Bebas Neue',sans-serif", fontSize:12,
                color:'var(--t1)', letterSpacing:'0.08em', cursor:'text'
              }}>
              {label}
            </span>
          )}
          <span style={{
            fontSize:10, padding:'1px 6px',
            background:'rgba(255,255,255,0.08)',
            borderRadius:10, color:'var(--t2)'
          }}>
            {players.length}
          </span>
        </div>
        {canRemove && (
          <button
            onClick={e => { e.stopPropagation(); onRemove?.() }}
            style={{ background:'none', border:'none', cursor:'pointer',
                     color:'var(--t2)', fontSize:11, padding:0 }}>
            ×
          </button>
        )}
      </div>

      {/* Player chips */}
      {players.length === 0 ? (
        <span style={{
          fontSize:11, color:'var(--t2)', fontStyle:'italic',
          opacity:0.6
        }}>
          Drag players here
        </span>
      ) : (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {players.map(p => {
            const isSelected = selectedPlayerId === p.id
            const isNew = mountedPlayerIds?.current &&
                          !mountedPlayerIds.current.has(p.id)
            return (
              <div
                key={p.id}
                onClick={e => { e.stopPropagation(); onChipTap(p.id) }}
                style={{
                  display:'flex', alignItems:'center', gap:6,
                  padding:'5px 8px', borderRadius:8,
                  background: isSelected ? 'var(--gold2)' : 'var(--s2)',
                  border: isSelected
                    ? '0.5px solid var(--gold)'
                    : '0.5px solid rgba(255,255,255,0.08)',
                  opacity: selectedPlayerId && !isSelected ? 0.5 : 1,
                  cursor:'pointer',
                  transition:'opacity 0.1s, border 0.1s, background 0.1s'
                }}>
                {/* Avatar circle */}
                <div style={{
                  width:24, height:24, borderRadius:'50%',
                  background:'var(--s3)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:9, color:'var(--t2)',
                  fontFamily:"'Bebas Neue',sans-serif"
                }}>
                  {(p.nickname || p.name || '?')
                    .split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}
                </div>
                {/* Name */}
                <span style={{
                  fontSize:12, color:'var(--t1)',
                  fontFamily:"'DM Sans',sans-serif", fontWeight:400
                }}>
                  {p.nickname || p.name}
                </span>
                {/* NEW badge */}
                {isNew && (
                  <span style={{
                    fontSize:8, color:'var(--amber)',
                    fontFamily:"'Bebas Neue',sans-serif",
                    letterSpacing:'0.05em'
                  }}>
                    NEW
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

**Needs Group warning banner** — add immediately above the Generate button:
```jsx
{showNeedsGroupWarning && needsGroupPlayers.length > 0 && (
  <div style={{
    background:'var(--amber2)',
    border:'0.5px solid var(--amberb)',
    borderRadius:8, padding:'8px 12px',
    marginBottom:8, fontSize:12,
    color:'var(--t1)', fontFamily:"'DM Sans',sans-serif"
  }}>
    {needsGroupPlayers.length} player
    {needsGroupPlayers.length > 1 ? 's' : ''} have no group —
    they'll be placed randomly.{' '}
    <span
      onClick={handleGenerate}
      style={{ color:'var(--amber)', cursor:'pointer',
               textDecoration:'underline' }}>
      Generate anyway
    </span>
  </div>
)}
```

**Prediction card** — add between the generate/reroll buttons and the
confirm button, only when `prediction !== null`:
```jsx
{prediction && (
  <div style={{
    background:'var(--s2)',
    border:'0.5px solid var(--s3)',
    borderRadius:10, padding:'10px 14px',
    marginBottom:12
  }}>
    <div style={{
      fontFamily:"'Bebas Neue',sans-serif", fontSize:11,
      color:'var(--t2)', letterSpacing:'0.1em', marginBottom:4
    }}>
      IO PREDICTION
    </div>
    <div style={{
      fontSize:14, color:'var(--t1)',
      fontFamily:"'DM Sans',sans-serif", fontWeight:400
    }}>
      {predictionCopy(prediction.winner, prediction.confidence)}
    </div>
    {disclaimerCopy[prediction.disclaimerLevel] && (
      <div style={{
        fontSize:11, color:'var(--t2)',
        fontFamily:"'DM Sans',sans-serif", fontWeight:300,
        fontStyle:'italic', marginTop:6
      }}>
        {disclaimerCopy[prediction.disclaimerLevel]}
      </div>
    )}
  </div>
)}
```

**Reroll warning** — when `manuallyAdjusted === true` and reroll tapped,
show inline amber banner before executing:
```jsx
{manuallyAdjusted && (
  <div style={{
    fontSize:11, color:'var(--amber)',
    fontFamily:"'DM Sans',sans-serif",
    marginBottom:6, textAlign:'center'
  }}>
    Rerolling will reset your manual changes
  </div>
)}
```
Reroll button: on first tap when `manuallyAdjusted`, set
`setManuallyAdjusted(false)` and proceed with generate (do not require
a second tap — the warning is informational only).

**Deselect on tap-outside:** The outer div wrapping the whole section
has the onClick deselect handler. The panels and chips use
`e.stopPropagation()` so tapping them does not bubble up.

**CaretUp / CaretDown** must be in the Phosphor import if not already.

**Verify 4B:**
```bash
grep "GroupPanel" apps/inorout/src/views/AdminView/TeamsScreen.jsx
grep "selectedPlayerId" apps/inorout/src/views/AdminView/TeamsScreen.jsx
grep "prediction" apps/inorout/src/views/AdminView/TeamsScreen.jsx
grep "dnd\|DndContext\|useDrag\|useSensor" apps/inorout/src/views/AdminView/TeamsScreen.jsx
# expect 0 — no drag library
cd apps/inorout && npm run build
```

Manual browser checks:
- Tap a chip → it highlights, others dim
- Tap same chip again → deselects
- Tap a different chip → selection moves
- Tap a panel when chip selected → chip moves to that panel
- Tap outside all panels → deselects
- Tap Needs Group panel when chip selected → chip moves to Needs Group (null)
- Prediction renders for all 5 copy states
- Disclaimer shows/hides correctly per level
- Needs Group warning + Generate Anyway flow works

Build clean.

**Commit:**
```
feat(teams): Group Balancer UI — tap-to-move panels, inline labels, prediction card
```

---

### STAGE 5 — Polish + HistoryView Hook

#### 5A — AUDIT (no edits)

```
Read the following and report findings only. No changes.

1. apps/inorout/src/views/AdminView/TeamsScreen.jsx — full current state.
   Flag any edge cases or visual inconsistencies not yet addressed.

2. apps/inorout/src/views/HistoryView.jsx — the expanded match drill-down
   section only. Report:
   a. Where POTM / bibs / last goal scorer display currently renders
   b. Confirm predicted_winner is now available via dbToMatch
      (it should be, from Stage 1C)

Report findings only. No edits.
```

#### 5B — Execute: TeamsScreen polish

In `apps/inorout/src/views/AdminView/TeamsScreen.jsx`:

**Empty group panel text:** Change "Drag players here" to
"Tap a player to move them here" — reflects tap-to-move interaction.

**`teams_draft` group snapshot:** When `saveTeamsDraft` is called on
generate, extend the draft payload:
```js
{
  a: teamA,
  b: teamB,
  groups: localGroups,            // group assignments at generation time
  predictedWinner: prediction?.winner ?? null
}
```
This preserves what the algorithm saw for future balancer accuracy analysis.

**Min squad guard:** GROUP BALANCER section is already gated on
`inPlayersForGroups.length >= 4`. Confirm this is correctly placed so
the section is completely absent (not just empty) below 4 players.

**Consistency check — all null win rates:** When all tableData entries
have null winRate, `avgWinRateA` and `avgWinRateB` both resolve to 0.5,
delta = 0, predictedWinner = 'draw'. Verify this path renders the
prediction card correctly with draw copy and appropriate disclaimer.

#### 5C — Execute: HistoryView prediction chip

In `apps/inorout/src/views/HistoryView.jsx`, in the expanded match
drill-down section, after the last goal scorer row:

```jsx
{m.predictedWinner && (
  <div style={{
    fontSize: 11,
    color: 'var(--t2)',
    fontFamily: "'DM Sans', sans-serif",
    marginTop: 4
  }}>
    {(() => {
      const pred = m.predictedWinner
      const actual = m.winner
      const predLabel = pred === 'draw' ? 'Draw'
        : pred === 'A' ? 'Team A' : 'Team B'
      const correct =
        pred === actual ||
        (pred === 'draw' && !actual)  // draw predicted, no winner = draw result
      return correct
        ? `🎯 Predicted: ${predLabel} · ✓ Correct`
        : `🎯 Predicted: ${predLabel} · Result: ${
            actual ? `Team ${actual} won` : 'Draw'
          }`
    })()}
  </div>
)}
```

This chip:
- Only renders when `m.predictedWinner` is non-null
- All existing matches have `predicted_winner = NULL` → chip never shows
- No conditional, no flag, no date check needed — null-safety is enough
- Forward-only by nature of the data

**Verify 5:**
```bash
grep "predictedWinner" apps/inorout/src/views/AdminView/TeamsScreen.jsx
grep "predictedWinner" apps/inorout/src/views/HistoryView.jsx
grep "teams_draft" apps/inorout/src/views/AdminView/TeamsScreen.jsx
cd apps/inorout && npm run build
```

Full flow test before committing:
1. Assign players to groups → generate → groups persist in UI
2. Inline label edit → save → reopen TeamsScreen → label persists from DB
3. Reroll multiple times → different teams produced (candidates randomisation)
4. Confirm → reopen TeamsScreen → groups still present, teams blank
5. Odd player count (5, 7, 9) → no crash, teams balanced
6. All null win rates → prediction shows draw + early disclaimer
7. winRate 0.0 player → included in team averaging
8. Guest player → not in group panels, appears in team output correctly
9. < 4 IN players → GROUP BALANCER section entirely absent
10. HistoryView: old match (null predicted_winner) → chip absent
11. HistoryView: new match after feature → chip shows with correct/incorrect text
12. Tap-outside deselects chip selection

Build clean.

**Commits:**
```
feat(teams): Group Balancer polish — draft snapshot, empty state copy, squad guard
feat(history): prediction chip in match drill-down, null-safe, forward-only
```

---

## COMMIT SEQUENCE SUMMARY

```
1. feat(schema): group_number, group_labels, prediction fields, balance_score
2. feat(core): setPlayerGroup, clearAllGroups, saveGroupLabels, updated confirmTeams + dbToPlayer
3. feat(engine): groupBalancer — win-rate nudge, prediction output, disclaimer levels
4. feat(admin): fetch tableData in AdminView, thread to TeamsScreen
5. feat(teams): Group Balancer state, tap-to-move handlers, prediction state, replace Fisher-Yates
6. feat(teams): Group Balancer UI — tap-to-move panels, inline labels, prediction card
7. feat(teams): Group Balancer polish — draft snapshot, empty state copy, squad guard
8. feat(history): prediction chip in match drill-down, null-safe, forward-only
```

---

## FUTURE DATA AND STAT OPPORTUNITIES
*No action now. Logged for Phase 2+.*

**Prediction accuracy stat (admin IO Intelligence)**
"IO has predicted X% of your results correctly this season."
Derived at query time from `predicted_winner` vs `winner` on matches.
No extra write needed. Build when accuracy is demonstrably above coin flip
(target: 30+ team games, > 65% accuracy on non-draw predictions).

**HistoryView prediction chip on historical / all games**
The chip is already null-safe. Extend to all completed matches only when
prediction accuracy is proven. This is the moment to market the feature.

**"Balanced by IO" badge on teams tile (player-facing)**
Subtle badge on the teams confirmed tile. Never mentions groups or win rates.
Build when feature has proven accuracy and is worth surfacing to players.

**Balancer accuracy tracking**
`teams_draft` now stores a `groups` snapshot at generation time. Compare
against confirmed lineups and final results. Platform-level insight: do
balanced splits produce closer games? Queryable once N > 30 across teams.

**Group mobility (IO Intelligence)**
Every group change is logged in `audit_events`. Future card:
"Hassan was recognised as a stronger player after 8 games."
Data collection starts now.

**Group-relative form**
"In the last 5 games you've outperformed your group average."
More meaningful than absolute rankings for mid-tier players.

**"Punching Above Your Weight" IO insight**
Group 2 player with win rate higher than Group 1 average.

**Fairness score in admin IO**
"Your games have been balanced to within 8% on average this season."
Derived from `balance_score` on matches — already being stored.

**Win rate weighted model — Phase 2**
Add goals-per-game weighting. Already in tableData. Low effort, meaningful
accuracy lift once enough data exists.

**H2H weighted model — Phase 3**
Factor in head-to-head history between specific opposing players.
`getHeadToHead` already exists. Needs cross-team matchup depth first.

**Suggested group reassignment**
After N games, flag players whose performance consistently diverges from
their group. "Jordan has been outperforming Group 2 for 6 games — consider
moving them up." Phase 2+ IO Intelligence feature.

**Group-aware squad management in SquadScreen**
Optional "view by group" mode. Once groups are established, helps admin
understand squad composition. Phase 2.

**Multi-team / venue layer (Phase 4)**
Group numbers from organiser app become natural seeding input for league
placement. Data exists without extra collection effort.

---

## EXPLICIT EXCLUSIONS

- Guest players in group assignment UI — no team_players row
- Player-visible group numbers, labels, win rates — in any form, ever
- Chemistry-based optimisation — Phase 2+
- Automatic group suggestions based on stats — Phase 2+
- Reserve list dnd-kit migration — separate cleanup pass
- Prediction chip on matches where predicted_winner IS NULL — null-safety handles this
- tableData deduplication / shared context — Phase 2
- Prediction accuracy UI — build only when accuracy is proven
- Group label history / append-only log — Phase 2
- balance_score or predicted_confidence shown to anyone
- too_close as a predicted_winner value — not used, not in CHECK constraint
- dnd-kit or any drag library — tap-to-move only, no new dependencies

---

## PRE-FLIGHT ADDENDUM (May 22 2026)

Decisions locked after spec review. Where the addendum and the original
spec disagree, the addendum wins.

### Algorithm

- **Large groups (>8 players):** sample 200 random 50/50 splits, pick the
  best within 5% of best score. Never enumerate all splits. Avoids the
  UI-freeze risk on a group of 12+ where the combination count explodes
  (C(12,6) = 924; C(14,7) = 3432).
- **Odd-numbered groups (3, 5, 7…):** extra player goes to the team with
  the lower current headcount. Ties → team with lower average win rate.
  Still tied → random. Apply during the per-group split step.
- **Reroll semantics:** groups stick. Reroll re-shuffles the A/B split
  *within* the existing group assignments only. Groups are config; reroll
  is shuffle. Changing groups requires explicit reassignment.

### Database safety

- **`admin_set_player_group` return shape:** `jsonb_build_object('ok',
  true, 'updated', <int>)`. Client inspects `updated`; if 0, the optimistic
  UI update reverts and the player chip is rendered greyed-out with
  tooltip "guests can't be grouped yet". Prevents the silent-no-op failure
  mode where the UI shows success but the DB is unchanged (same class as
  the session-29 `is_vice_captain` bug).
- **PostgREST schema cache:** Stage 1B migration ends with
  `SELECT pg_notify('pgrst', 'reload schema');`. Mandatory after every new
  RPC; avoids first-call 404.
- **RPC access lockdown:** Stage 1B SQL includes
  `REVOKE ALL ON FUNCTION admin_set_player_group FROM anon;` and
  `GRANT EXECUTE ON FUNCTION admin_set_player_group TO authenticated;`.
  Non-discretionary per CLAUDE.md RPC checklist.

### Product behaviour

- **Group persistence across "out" weeks:** `group_number` is **cleared
  when a player flips to `going=false`**. Returning the following week,
  they appear in "Needs Group" and must be reassigned. Chosen over
  sticky-by-default to prevent stale assignments from weeks-old squad
  states surfacing unexpectedly.
- **"Needs Group" amber banner:** shown on **every** Generate and Reroll
  while any IN players are ungrouped. Confirm step ("Generate Anyway")
  does not block. Intentional repetition — admin should feel friction
  each time grouping is bypassed.
- **Player-visible state:** unchanged. No group numbers, labels, or hints
  in any player-facing view, API response, or notification.
- **Mid-game team switches** (shipped session 28): do not modify
  `group_number`. Final A/B side updates; group assignment is untouched.
  Clean separation between "how grouped" and "ended up where".
- **Reserves / cover players:** default to "Needs Group" when promoted to
  IN. No automatic group inheritance.

### Analytics

PostHog events fired from TeamsScreen on the Group Balancer interactions:
- `group_assigned` — on tap-to-assign commit; properties:
  `{ group: 1..5 | "needs_group" }`
- `group_balancer_generate` — on Generate tap; properties:
  `{ groupCount, needsGroupCount, totalIn }`
- `group_balancer_reroll` — on Reroll tap
- `group_balancer_needs_group_confirmed` — on "Generate Anyway" tap

One small commit between Stage 4 and Stage 5.

### Time estimate

Original 5.5–7h raw / 8–9h with overhead is optimistic. Plan for
**9–11h calendar time across 3 sessions**. Stage 3 (UI + tap-to-assign
visual states) is the main risk; treat anything faster as a bonus.

---

## BUILD COMPLETE (May 22 2026 — session 30)

> **Naming note:** user-facing label is **Smart Teams**. Internal code,
> spec file, algorithm name, and PostHog event prefixes remain
> `group_balancer` / `Group Balancer`. Grep either term and you'll
> find the right place.

All five stages shipped. Initially gated behind the `group_balancer`
PostHog feature flag, then promoted to permanent in the same session
once the build was clean (feature is unconditionally on for every team).
PostHog feature flag retired in code; analytics events still flow.
Commits, in order:

1. `39637d0` — feat(schema): migration 031 applied + verified
2. `b119bfd` — feat(core): JS wrappers + dbToPlayer / dbToMatch / dbToSettings
3. `247b209` — feat(engine): pure `groupBalancer.js` algorithm
4. `268bf54` — chore(hygiene): pre-existing hex literals → tokens
5. `cf25829` — feat(admin): AdminView fetches tableData, threads to TeamsScreen
6. `7674af1` — feat(teams): state + tap-to-move handlers + prediction state
7. `2742f46` — feat(teams): Group Balancer UI (panels, labels, prediction card)
8. `3974359` — feat(history): prediction chip in match drill-down

### Deferred to Phase 2

- **`teams_draft` group snapshot** — the spec's Stage 5B item to persist
  `{ groups, predictedWinner }` inside `teams_draft` on Save Draft was
  deferred. Reason: it requires another `admin_save_teams` reshape and
  the data that matters for the accuracy stat (predicted_winner vs
  winner) is already persisted on matches at confirm time. The snapshot
  was only for "what did the algorithm see at draft time" analytics —
  nice-to-have, not load-bearing.
- **Group panel "summon" lifecycle bug** — when admin taps `+ ADD GROUP`,
  the empty panel renders. If admin moves a player into it then removes
  them all, the panel goes back to empty state. The `emptyPanels` Set
  doesn't automatically re-add it, so the × becomes available and the
  panel can be dismissed even though it was originally summoned. Minor
  UX edge case; revisit during QA if it actually surfaces.

### Rollout plan (recap)

1. Flag stays OFF in production — zero behaviour change for all teams.
2. Enable for `team_demo` in PostHog. Walk through the full flow against
   demo data (assign → generate → reroll → confirm → reopen → see chip
   in HistoryView).
3. Enable for `team_finbars` (Tarny's real team). One week of real
   match-day usage. Watch predictions vs actual results.
4. Enable for the first onboarded team (Monday Footy) once confident.
5. Enable globally in PostHog.
6. Final cleanup PR: drop `groupBalancerEnabled` checks from
   TeamsScreen, delete the Fisher-Yates branch, retire the PostHog flag.

Note: with the expanded scope (predictions, balance score, group labels,
audit events, HistoryView chip) the realistic range is **14–18h across
4–5 sessions**. The 9–11h figure above stands for the *core* group
balancer only.

---

## FEATURE FLAG STRATEGY

Build the entire spec end-to-end, ship to production with the user-facing
UI gated behind a flag default-off, then enable per-team once confident.
Most of the spec is naturally forward-compatible — only one file needs a
conditional.

### What ships dormant (no gating needed)

All of the following are safe to land in production without any flag,
because they activate only when called and have no effect on existing
flows:

- **Schema additions** — every new column nullable with `DEFAULT NULL`.
  Existing rows untouched. `group_number`, `group_labels`,
  `predicted_winner`, `predicted_confidence`, `balance_score`.
- **New RPCs** — `admin_set_player_group`, `admin_clear_all_groups`.
  Never called until the UI calls them.
- **Modified `admin_upsert_settings`** — new `p_group_labels` param with
  `COALESCE` default. Existing callers don't pass it; behaviour unchanged.
- **Modified `admin_save_teams`** — three new params default NULL.
  Existing callers don't pass them; columns stay null on confirm.
- **Modified `get_team_state_by_admin_token`** — adds two fields to the
  response that the client either ignores or maps to defaults.
- **`dbToPlayer` / `dbToMatch` / `dbToSettings` mappings** — return
  `null`/`{}` for absent values.
- **`generateBalancedTeams`** pure function in
  `packages/core/engine/groupBalancer.js` — sits unused until imported.
- **HistoryView prediction chip** — already null-safe
  (`{m.predictedWinner && ...}`). Invisible on every existing match.
  Self-gating.

### What needs the flag

Exactly one file: **`apps/inorout/src/views/AdminView/TeamsScreen.jsx`**.
The Group Balancer UI section and the swap from Fisher-Yates to
`generateBalancedTeams` are the only user-visible changes. Everything
else is dormant code paths.

### Mechanism: PostHog feature flag

PostHog is already integrated. Use a remote-controlled flag rather than
an env var or localStorage — instant rollback, per-team targeting, no
redeploy required.

```js
// Top of TeamsScreen.jsx
const groupBalancerEnabled =
  window.posthog?.isFeatureEnabled('group_balancer') ?? false;

const handleGenerate = () => {
  if (groupBalancerEnabled) {
    // new generateBalancedTeams flow
  } else {
    // existing Fisher-Yates
  }
};

// JSX:
{groupBalancerEnabled && inPlayersForGroups.length >= 4 && (
  <div>{/* GROUP BALANCER section */}</div>
)}

{prediction && groupBalancerEnabled && (
  <div>{/* IO PREDICTION card */}</div>
)}
```

Roughly 8–10 conditional renders/branches across the file. When the flag
is off, TeamsScreen behaves exactly as it does today.

### Rollout sequence

1. Build all 8 commits as specified. PostHog flag `group_balancer` created
   in dashboard, default off.
2. Deploy to production. Schema + RPCs live, dormant. Existing teams see
   zero change.
3. Enable for `team_demo` in PostHog. Test the full flow against demo data.
4. Enable for `team_finbars` (Tarny's real team). Run a week of real
   match-day usage. Watch predictions vs actual results.
5. Enable for Monday Footy (first real onboarded team) once confident.
6. Enable globally in PostHog. Run for a release cycle.
7. Final cleanup PR: drop the flag check from TeamsScreen, delete the
   Fisher-Yates branch, retire the PostHog flag.

### One semantic caveat

`predicted_winner` only populates from the moment the flag flips on for
a given team. The "IO predicted X% of your results correctly this season"
stat (Phase 2) starts from that point forward — no backfill awkwardness.
Treat this as a feature, not a bug.

### What the flag does NOT gate

- The HistoryView prediction chip — it's null-safe and only renders when
  `predicted_winner IS NOT NULL`. Pre-flag matches have no chip; post-flag
  matches do. Self-managing.
- Database state — once the flag is on for any team and any admin
  confirms a match, prediction columns populate. Flipping the flag back
  off hides the UI but leaves the data in place. This is intentional
  for accuracy tracking.
