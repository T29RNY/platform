# Stats accuracy fix — build manifest

Scoped 2026-07-04 (read-only investigation against live team **Footy Tuesdays**
`team_KPaoX8oJYMQ` / `/admin/admin_0OcDVOpcoGnujleetMhGYw`). No code changed, no
migration applied — investigation only. `player_match` is the source of truth.
Shared view code, platform-wide, no per-team paths. Casual-regression applies.

Operator product decision (made this session): margin/declared groups show
**"avg winning margin"** in the Season hero, not fake "avg goals".

---

## StatsView.jsx

**1. Upcoming-game denominator bug (root of 3 symptoms).**
`totalGames`/`played` (~line 394: `periodMatches.filter(m => !m.cancelled)`) counts
games that merely aren't cancelled, so the not-yet-played upcoming game (winner null)
is counted. Change to only games with a recorded result:
`filter(m => !m.cancelled && m.winner)` — matching `filtered`/`totalGamesInPeriod`.
Fixes:
- Team A vs B %: 60% (3 wins ÷ 5) → **75%** (÷4).
- Avg stat denominator: ÷5 → ÷4.
- Thrillers (tightGames): drop latent inclusion of the upcoming game.
After the fix `totalGames` must equal `totalGamesInPeriod` (both 4 for Footy).

**2. Season hero "games played" (line 494).**
Currently `stats?.matchStats?.attended ?? totalGames` — `matchStats.attended` is the
VIEWING PLAYER's personal count, wrong for a group headline. Feed the true team total
(fixed `totalGames`). Never a per-player figure.

**3. Adaptive hero second stat by dominant `score_type`** — mirror the existing
HeadToHead `dominantType` precedent (HeadToHead.jsx ~474–501). Matches carry
`scoreType` ∈ {exact, margin, declared}. Compute dominant type over played
(result-recorded) matches:
- **exact** → "avg goals / game", over EXACT matches only (never sum margin/declared
  score fields as goals).
- **margin** → **"avg winning margin"** — mean winning margin across decisive played
  matches (winner's stored margin; for exact matches `|scoreA−scoreB|`). Footy = all
  margin → ~1.0–1.3.
- **declared** → no score/margin exists → show **"% decisive"** (games with a winner ÷
  played); drop the goals/margin number.
- Micro-decision to surface, don't guess: whether the margin average excludes draws
  (recommended: exclude) or counts them as 0.
Goal-dependent leaderboard tiles (Top Scorers, Clinical, Most Consistent) already
self-hide with "No goals recorded yet" in non-exact modes — leave them, confirm honest.

**4. POTM subtitle (~line 674).**
`1 in every ${every} games` with `every = round(played/potm)` is garbled
("1 in every 1 games") and the rounding misleads. Replace with plain exact phrasing:
`${p.potm} from ${p.played} games` ("2 from 2 games"). The POTM count is correct.

**5. Cancellation rate (optional, product decision — flag, don't force).**
`cancRate = cancelledCount ÷ totalAll` includes the upcoming game (2÷7=29%).
Recommend `cancelled ÷ (played + cancelled)` (→33%). Low priority.

---

## MyIOView.jsx (separate root cause: reads drifted flat `players` columns)

**6. Remove EVERY flat-column stat read; source all from the derived stats block,
never `players.*`:**
- ~807 `gamesPlayed = player?.attended` (drives hero progress, unlock thresholds,
  "games played") — THE critical one, wrong on every route incl. real players →
  use `stats.matchStats.attended`.
- ~808 `total = player?.total` → from the stats block / matchHistory.
- ~224–229 StatsRow wins/losses/draws/attended/goals/motm `?? player?.*` → remove.
- ~125–126 TacticsBoardHero goals/motm `?? player?.*` → remove.
- ~692–693 achievements `player?.attended/goals/motm` → remove.
Guarantee `stats.matchStats` is populated on EVERY route (trace App.jsx branches
setting `matchStats:null` ~612/~666; either always compute via
`computeStatsFromHistory` or derive locally from matchHistory like StatsView's
leaderboard). No code path may render a stat from a flat column.

---

## VERIFY (Footy Tuesdays, before + after)
Team A vs B = 75% (was 60%). Games played (hero) = 4 (not 3 or 5). Avg stat =
"avg winning margin" ~1.0–1.3, NOT "avg goals 0.8". POTM Kyle = "2 from 2 games".
MyIO W/L/D + games-played match the player_match recompute (Bidz 3W-0L-0D/3,
Manny 2W-1L-1D/4) and agree with StatsView.

## GATED — surface, do NOT apply (needs sign-off)
- **Reconcile migration** (next free = **477**): backfill
  `players.w/l/d/attended/goals/motm/total` from `player_match` across ALL teams.
  Cosmetic once #6 lands (nothing reads them).
- **Harden the result-save cascade** (mig 205/206) so `player_match` and the flat
  mirror can't drift again — or drop the flat stat columns entirely (RPC/schema).

## Un-audited (separate data paths — sweep next if wanted)
- Match Fitness section (Apple Watch data, self-hides on empty).
- Head-to-Head modal (own calculation).
