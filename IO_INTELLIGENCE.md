# In or Out — IO Intelligence System
*Last updated: May 21 2026 (session 28)*

Read this only when working on IO Intelligence features (MyIOView.jsx,
useIOIntelligence.js, or the underlying query functions).

---

## BRANDING

- Tab: MY IO (MY = var(--t2), I = var(--green), O = var(--red))
- Phosphor Brain icon weight="thin"
- Screen heading: IO Intelligence (IO = branded colours, italic skew, sticky at top)
- Locked cards: pentagon crest SVG `path d="M27 2L52 12V30C52 43.5 41 54.5 27 58C13 54.5 2 43.5 2 30V12L27 2Z"`, ghost shield opacity 0.15
- Season report: IO Wrapped (Phase 3)

---

## PROGRESSIVE UNLOCK THRESHOLDS (per player per team)

| Games | Unlocks | Status |
|---|---|---|
| 1+ | Goals, POTM, W/L/D, Attendance ring, Reliability, Form strip | ✅ |
| 2+ | Win Rate card | ✅ |
| 3+ | Current Run card (unbeaten OR losing run) | ✅ |
| 4+ | Most Faced Opponent | 🔲 Not built |
| 5+ | Reliability Ranking | 🔲 Not built |
| 6+ | Most Played With card | ✅ |
| 7+ | Team Impact card | ✅ |
| 8+ | Nemesis, Best Partnership, Advanced Chemistry cards | ✅ |
| 16+ | Legacy Insights | ✅ |

---

## MyIOView.jsx STRUCTURE

```
IOBrandHeader          ← sticky top:0 zIndex:20 height:48px
TacticsBoardHero       ← sticky top:48 zIndex:15 (48px = IOBrandHeader height)
  SVG tactics board pitch
  YOUR GAME / YOUR STORY heading (40px Bebas Neue italic)
  Attendance ring (glass tile)
StatsRow               ← 3 tiles: POTM (gold), Goals/Run (green), W/D/L (--t2)
InsightsGrid           ← 2-col grid, 8 cards in unlock order
UnlockBar              ← next unlock step
DeeperIntelSection     ← ranked rows: partnerships, nemeses, played with, impact — unlocks at 6
LegacySection          ← gold crest cards — unlocks at 16
JourneyStartsHere      ← 0 games empty state
GuestCard              ← guest player state
```

**Critical:** `position:sticky` breaks with CSS transform on parent.
`TacticsBoardHero` is a sibling ABOVE `.io-section` divs (which have `translateY`),
NOT inside them. Sticky at `top:48` works only in this structure.

---

## INSIGHT CARDS — ORDER IN 2-COL GRID

1. Win Rate (2+) — gold, winRate% on badge
2. Current Run (3+) — dynamic green/red based on run type
3. Most Played With (6+) — blue
4. Team Impact (7+) — purple
5. Nemesis (8+) — red
6. Best Partnership (8+) — green
7. Advanced Chemistry (8+) — amber, "Coming soon"
8. Legacy Insights (16+) — gold

---

## HERO CARD — ATTENDANCE RING

- SVG 56×56, viewBox "0 0 38 38", R=16
- Progress ring stroke `#3DDC6A` strokeWidth 3
- Glass tile: `rgba(255,255,255,0.07)`, `blur(12px)`, `0.5px border rgba(255,255,255,0.18)`, borderRadius 14px, padding 10px, minWidth/minHeight 80px
- Ring text (HTML spans, NOT SVG text): number 16px/600/#fff, "/X" 9px/#fff, "games" 7px/rgba(255,255,255,0.6)

---

## useIOIntelligence.js HOOK

**Since session 25:** Pure passthrough — takes `stats` prop from state RPC, makes
NO direct Supabase calls. Returns `{ stats, loading, error }`.

Stats keys: `matchStats`, `reliability`, `winRate`, `currentRun`, `mostPlayedWith`,
`impact`, `nemesis`, `bestPartnership`, `potmVotes`

---

## SUPABASE QUERY FUNCTIONS (in supabase.js)

All built via two-query pattern (no PostgREST self-joins):

| Function | Returns |
|---|---|
| `getPlayerMatchStats(playerId, teamId)` | `{ goals, motm, wins, losses, draws, attended }` |
| `getWinRate(playerId, teamId)` | `{ winRate, wins, draws, losses }` |
| `getCurrentRun(playerId, teamId)` | `{ type: "unbeaten"\|"losing", length }` |
| `getReliabilityScore(playerId, teamId)` | `{ score }` |
| `getMostPlayedWith(playerId, teamId)` | `[{ playerId, name, games }]` |
| `getPlayerImpact(playerId, teamId)` | `{ withRate, withoutRate, diff }` |
| `getNemesis(playerId, teamId)` | `[{ playerId, name, games, lossRate }]` |
| `getBestPartnership(playerId, teamId)` | `[{ playerId, name, games, winRate }]` |
| `getPOTMVoteStats(playerId, teamId)` | Wrapped in try/catch (table may not exist) |

**Note:** `getMostPlayedWith`, `getNemesis`, `getBestPartnership`, `getPlayerImpact`
all use two sequential queries + JS computation. PostgREST foreign key joins are
unreliable in this config.

---

## getPlayerLeagueTable (supabase.js)

```
getPlayerLeagueTable(teamId, period)
period: 'month' | 'season' | 'all'
```

**5-step query:**
1. Matches in period → match IDs
2. player_match rows for those match IDs
3. All-team match dates since player.created_at (reliability denominator — always all-time)
4. Players in team
5. Compute: points (W×3+D) → goals → winRate → potm → name ranking

**Returns:**
```js
{
  players: [{
    playerId, name, nickname, injured,
    played, wins, draws, losses,
    points, winRate, goals, potm,
    reliability,  // always all-time regardless of period
    form,         // last 5: ["W","D","L",...] uppercase
    ranked,       // bool — false if < 3 games in period
    rank          // int (tied players share rank, next rank skips)
  }],
  totalGamesInPeriod: int
}
```

**Reliability detail:**
- Numerator and denominator both use all-time queries (separate Step 3b query)
- Period selector does NOT affect reliability
- Reliability null if `allTimePlayed < 3`
- Reliability = `allTimePlayed / totalTeamGames` (games since player joined)

**Exclusions:** Guests and disabled players excluded.

**Goals count:** Only where `score_type = null OR 'exact'`. Margin/declared scores excluded.

**tableData shape note:** `tableData` players use `playerId` (not `id`), `wins/draws/losses`
(not `w/l/d`), `played` (not `attended`), `potm` (not `motm`), `form` as uppercase array.

---

## EDGE CASES

- **0 games:** "YOUR IO JOURNEY STARTS HERE" empty state
- **Guest player:** "Join the squad properly to unlock IO Intelligence"
- **POTM zero state:** "yet to win one" (not "0% of wins")
- **CSS vars in SVG:** Can't use CSS vars in SVG `fill`/`stroke` — use hex literals or `style={{}}` inside SVG
- **InsightCard body renderer:** Guard against non-React-element children — numbers as bare JSX fragment children throw TypeError. Extend primitive guard to include `!child?.props` (fixed session 23 d387c58)
- **`position:sticky` + transform:** sticky breaks inside transform parent. TacticsBoardHero must be a sibling of (not inside) `.io-section` divs which have `translateY`.

---

## HEAD TO HEAD (HeadToHead.jsx)

Built sessions 22–23. Wired to PlayerLeagueTable tap target.

### Two queries pattern
- Query 1a: all-time matches (for `dominantType` — always team-wide all-time)
- Query 1b: period-filtered matches (for all stats)
- Query 2: all-time player_match rows for both players

`meRows`/`themRows` filtered by `matchMap` membership immediately after Query 2.
`matchMap` = period-filtered match IDs. Single gating point — all downstream inherits period.

### Five sections
1. When You Play Together — games/W/D/L, goal threat or match outcome (adaptive on dominantType)
2. When You Face Each Other — head-to-head record, streak
3. You Make Them Better — chemistry (hidden if < 3 shared games)
4. Overall Comparison — mirrored bar chart (reliability always all-time)
5. Recent Shared Matches — last 5 horizontal scroll

### Chemistry verdicts (5)
`good_luck_charm` / `bad_influence` / `asymmetric` / `no_effect` / `building`

Sample floor: `gamesTogether >= 3 AND meNonShared >= 3 AND themNonShared >= 3`.
If floor fails → `'building'`.

### Main verdicts
`better_together` / `nemesis` / `you_own_them` / `dead_even` / `early_days`
Requires `totalShared >= 3`. `> 55%` win rate = `better_together`. `> 1.5x` wins = `nemesis`.

### `myId` requirement
`myId` required for H2H. Non-tappable for pure admins without squad account.
`myId` must be passed to BOTH top-level `<StatsView>` AND PlayerView's internal `<StatsView>`
(admin stats-tab route renders through PlayerView's internal render, not top-level).

### Score type gating
`dominantType` computed via `resolveDominantType(matchData)` from `packages/core/engine/scoring.js`.
- `'exact'` → show Goal Threat row in Section 1
- `'margin'` → show Match Outcome row (average signed differential)
- `'declared'` → hide Row 1 entirely

### Period filter implementation
Filter `meRows`/`themRows` by `matchMap` membership IMMEDIATELY after Query 2, before any
downstream computation. Propagates period scope naturally — no per-call gating needed.
