// GROUP BALANCER — Pure generation function.
// Group numbers and win rates are ADMIN-ONLY signals. Never expose either
// to player routes or any player-visible state. Only teamA and teamB in
// the return value may flow to players.
//
// Inputs:
//   players    — IN squad: { id, groupNumber: 1–5 | null }. Caller pre-filters
//                to status === 'in' && !injured && !disabled. Guests are
//                included per Group Balancer decision A.
//   tableData  — { players: [{ playerId, winRate, played, ranked, ... }] }
//                from getPlayerLeagueTable. winRate is an integer 0–100.
//                We normalise to 0.0–1.0 INSIDE this function only.
//                Players with played < 3 are treated as null (insufficient
//                signal — would skew prediction averaging).
//   opts       — { teamGames, MIN_TEAM_GAMES, MIN_AVG_PLAYER_GAMES, ratingMap,
//                ratingBreakdown } — all optional with safe defaults. ratingMap
//                (from playerRating.js) is a precomputed { playerId: composite
//                0–1 } strength map; when present it REPLACES the win-rate signal
//                for splitting and prediction (0.5 = squad average). Precomputed
//                ONCE by the caller — never inside the enumeration hot path.
//                Absent ⇒ the engine falls back to today's win-rate math.
//
// Returns (keys stable — new fields are ADDITIVE only):
//   {
//     teamA: [playerIds],            // only these two arrays may flow to players
//     teamB: [playerIds],
//     predictedWinner: 'A'|'B'|'draw',
//     predictedConfidence: 0.00–1.00,
//     balanceScore: 0.00–1.00,
//     avgGamesPlayed: number,
//     disclaimerLevel: 'none'|'mid'|'early'|'inconsistent',
//     compositeBalanceScore: 0.00–1.00,   // additive — mirrors balanceScore
//     usedComposite: boolean,             // additive — true when ratingMap drove it
//     ratingBreakdown: {…}|null,          // additive — pass-through of opts.ratingBreakdown
//     predictedMargin: null,              // additive — reserved (derived later, OQ1)
//   }

// Prediction/noise thresholds. Recalibrated for the composite signal: shrunk
// composites cluster nearer 0.5 than raw win%, so the old win-rate thresholds
// (0.05/0.05/0.30) would read as "everything's a draw". Tuned against demo data.
export const PREDICTION_DRAW_THRESHOLD = 0.02;
export const PREDICTION_STRONG_THRESHOLD = 0.12;
const NOISE_FLOOR = 0.03;          // candidates within this of best score
const ENUMERATE_LIMIT = 10;        // exhaustive enumeration up to this group size
const RANDOM_SAMPLE_COUNT = 200;   // sampled splits for groups larger than the limit

// Fitness second axis (opts.fitnessMap, playerRating consumers). Objective becomes
// α·skillBalance + (1−α)·fitnessBalance — skill-dominant so fitness only NUDGES. The
// axis is COVERAGE-GATED: it applies to a split only when BOTH sides carry at least
// this many consented-adult fitness scalars, else it silently drops for that split
// (degrades to skill-only — no over-claim).
export const FITNESS_ALPHA_DEFAULT = 0.8;
const FITNESS_MIN_COVERAGE = 2;

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function meanOrNull(values) {
  const filtered = values.filter(v => v !== null);
  if (filtered.length === 0) return null;
  return filtered.reduce((s, v) => s + v, 0) / filtered.length;
}

// All k-combinations of [0..n-1] as arrays of selected indices.
function combinations(n, k) {
  const out = [];
  const stack = new Array(k);
  function recurse(start, depth) {
    if (depth === k) { out.push(stack.slice()); return; }
    for (let i = start; i <= n - (k - depth); i++) {
      stack[depth] = i;
      recurse(i + 1, depth + 1);
    }
  }
  recurse(0, 0);
  return out;
}

function randomSubsetIndices(n, k) {
  const idx = Array.from({ length: n }, (_, i) => i);
  shuffleInPlace(idx);
  return idx.slice(0, k).sort((a, b) => a - b);
}

// Mean fitness scalar over a side's players that HAVE a scalar (consented adults),
// plus the coverage count. Players without a fitness scalar are simply absent.
function sideFitness(ids, fitnessMap) {
  const vals = ids.map(id => fitnessMap[id]).filter(v => v !== null && v !== undefined);
  return {
    mean: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
    n: vals.length,
  };
}

// Score a split into sideA/sideB index sets. Returns the absolute delta of the two
// sides' average strength (composite ratingMap when present, else win rate). When a
// fitness axis is supplied AND both sides meet the coverage floor, blends in the
// fitness balance: α·skillDelta + (1−α)·fitnessDelta. Null values are skipped in
// averaging; a whole side with no data is treated as 0.5 (neutral) so the split
// still scores instead of being discarded.
function scoreSplit(sideAIds, sideBIds, scoreMap, fitnessCtx) {
  const ratesA = sideAIds.map(id => scoreMap[id] ?? null);
  const ratesB = sideBIds.map(id => scoreMap[id] ?? null);
  const avgA = meanOrNull(ratesA) ?? 0.5;
  const avgB = meanOrNull(ratesB) ?? 0.5;
  const skillDelta = Math.abs(avgA - avgB);

  if (fitnessCtx && fitnessCtx.map) {
    const fA = sideFitness(sideAIds, fitnessCtx.map);
    const fB = sideFitness(sideBIds, fitnessCtx.map);
    if (fA.n >= FITNESS_MIN_COVERAGE && fB.n >= FITNESS_MIN_COVERAGE) {
      const fitnessDelta = Math.abs(fA.mean - fB.mean);
      return fitnessCtx.alpha * skillDelta + (1 - fitnessCtx.alpha) * fitnessDelta;
    }
  }
  return skillDelta;
}

// Per the pre-flight addendum: the extra player from an odd group goes to
// the team with the lower current headcount, then lower average strength,
// then random. teamA/teamB carry the in-progress assignments.
function placeExtraPlayer(extraId, teamA, teamB, scoreMap) {
  if (teamA.length < teamB.length) return 'A';
  if (teamB.length < teamA.length) return 'B';
  const avgA = meanOrNull(teamA.map(id => scoreMap[id] ?? null)) ?? 0.5;
  const avgB = meanOrNull(teamB.map(id => scoreMap[id] ?? null)) ?? 0.5;
  if (avgA < avgB) return 'A';
  if (avgB < avgA) return 'B';
  return Math.random() < 0.5 ? 'A' : 'B';
}

// Split a single group (size >= 3) into two halves, picking the most-
// balanced split (within NOISE_FLOOR of best) at random for reroll variety.
function splitGroupBalanced(groupIds, scoreMap, fitnessCtx) {
  const shuffled = shuffleInPlace(groupIds.slice());
  const half = Math.floor(shuffled.length / 2);

  let aIndexSets;
  if (shuffled.length <= ENUMERATE_LIMIT) {
    aIndexSets = combinations(shuffled.length, half);
  } else {
    aIndexSets = [];
    for (let i = 0; i < RANDOM_SAMPLE_COUNT; i++) {
      aIndexSets.push(randomSubsetIndices(shuffled.length, half));
    }
  }

  const scored = aIndexSets.map(aIndices => {
    const aSet = new Set(aIndices);
    const sideA = aIndices.map(i => shuffled[i]);
    const sideB = shuffled.filter((_, i) => !aSet.has(i));
    return { sideA, sideB, delta: scoreSplit(sideA, sideB, scoreMap, fitnessCtx) };
  });

  const bestDelta = Math.min(...scored.map(s => s.delta));
  const candidates = scored.filter(s => s.delta <= bestDelta + NOISE_FLOOR);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function generateBalancedTeams(players, tableData, opts = {}) {
  const {
    teamGames = 0,
    MIN_TEAM_GAMES = 30,
    MIN_AVG_PLAYER_GAMES = 8,
    ratingMap = null,
    ratingBreakdown = null,
    fitnessMap = null,
    fitnessAlpha = FITNESS_ALPHA_DEFAULT,
  } = opts;

  // Fitness second axis context. Present only when a non-empty fitnessMap is
  // supplied (mig-503 reader → AdminView). scoreSplit consults it per candidate
  // and coverage-gates internally; absent ⇒ pure skill balance, byte-stable.
  const fitnessActive = !!fitnessMap && Object.keys(fitnessMap).length > 0;
  const fitnessCtx = fitnessActive ? { map: fitnessMap, alpha: fitnessAlpha } : null;

  // ── 1. Build the strength signal map. When a precomputed composite
  //      ratingMap (playerRating.js) is supplied it drives every split /
  //      placement / prediction decision below (0.5 = squad average). Absent ⇒
  //      fall back to today's win-rate math: normalise 0–100 int → 0.0–1.0,
  //      treating played < 3 (or absent / not ranked) as null (insufficient
  //      signal would skew averaging).
  const winRateMap = {};
  const playedMap = {};
  for (const row of (tableData?.players ?? [])) {
    const usable = (row.played ?? 0) >= 3 && row.ranked !== false;
    winRateMap[row.playerId] = usable ? (row.winRate / 100) : null;
    playedMap[row.playerId] = row.played ?? 0;
  }
  const usedComposite = !!ratingMap && Object.keys(ratingMap).length > 0;
  const scoreMap = usedComposite ? ratingMap : winRateMap;

  // ── 2. Separate by group.
  const grouped = {};
  const needsGroup = [];
  for (const p of players) {
    const g = p.groupNumber ?? null;
    if (g === null) {
      needsGroup.push(p.id);
    } else {
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(p.id);
    }
  }

  // ── 3. Initialise output. nextSide persists ACROSS all groups so that
  //      odd singletons / pairs balance over the whole lineup, not per group.
  const teamA = [];
  const teamB = [];
  let nextSide = 'A';
  const flip = () => { nextSide = nextSide === 'A' ? 'B' : 'A'; };
  const pushTo = (side, id) => { (side === 'A' ? teamA : teamB).push(id); };

  // ── 4. Process each populated group sorted numerically 1 → 5.
  const populatedGroupNums = Object.keys(grouped)
    .map(n => parseInt(n, 10))
    .sort((a, b) => a - b);

  for (const gNum of populatedGroupNums) {
    const ids = grouped[gNum];

    if (ids.length === 1) {
      pushTo(nextSide, ids[0]);
      flip();
      continue;
    }

    if (ids.length === 2) {
      const sorted = ids.slice().sort((a, b) =>
        (scoreMap[b] ?? -1) - (scoreMap[a] ?? -1)
      );
      pushTo(nextSide, sorted[0]);
      pushTo(nextSide === 'A' ? 'B' : 'A', sorted[1]);
      flip();
      continue;
    }

    // size >= 3
    const isOdd = ids.length % 2 === 1;
    let workingIds = ids;
    let extraSide = null;
    if (isOdd) {
      // Pull an extra player out — the one with the LOWEST winRate so the
      // strong remaining set splits cleanly. Null win rates count as 0.5
      // (neutral) so they don't get steered into the extra slot every time.
      const sorted = ids.slice().sort((a, b) =>
        (scoreMap[a] ?? 0.5) - (scoreMap[b] ?? 0.5)
      );
      const extraId = sorted[0];
      workingIds = ids.filter(id => id !== extraId);
      extraSide = placeExtraPlayer(extraId, teamA, teamB, scoreMap);
      pushTo(extraSide, extraId);
    }

    const split = splitGroupBalanced(workingIds, scoreMap, fitnessCtx);
    for (const id of split.sideA) teamA.push(id);
    for (const id of split.sideB) teamB.push(id);
  }

  // ── 5. Process needsGroup pool. Mirrors the per-group dispatch above:
  //      size 1 → single placement, size 2 → straight across, size ≥ 3 →
  //      balanced split with the same odd-handling rule.
  if (needsGroup.length === 1) {
    const side = placeExtraPlayer(needsGroup[0], teamA, teamB, scoreMap);
    pushTo(side, needsGroup[0]);
  } else if (needsGroup.length === 2) {
    const sorted = needsGroup.slice().sort((a, b) =>
      (scoreMap[b] ?? -1) - (scoreMap[a] ?? -1)
    );
    pushTo(nextSide, sorted[0]);
    pushTo(nextSide === 'A' ? 'B' : 'A', sorted[1]);
    flip();
  } else if (needsGroup.length >= 3) {
    const isOdd = needsGroup.length % 2 === 1;
    let workingIds = needsGroup;
    if (isOdd) {
      const sorted = needsGroup.slice().sort((a, b) =>
        (scoreMap[a] ?? 0.5) - (scoreMap[b] ?? 0.5)
      );
      const extraId = sorted[0];
      workingIds = needsGroup.filter(id => id !== extraId);
      const side = placeExtraPlayer(extraId, teamA, teamB, scoreMap);
      pushTo(side, extraId);
    }
    const split = splitGroupBalanced(workingIds, scoreMap, fitnessCtx);
    for (const id of split.sideA) teamA.push(id);
    for (const id of split.sideB) teamB.push(id);
  }

  // ── 6. Compute prediction from the same strength signal that drove the split.
  const ratesA = teamA.map(id => scoreMap[id] ?? null);
  const ratesB = teamB.map(id => scoreMap[id] ?? null);
  const avgScoreA = meanOrNull(ratesA) ?? 0.5;
  const avgScoreB = meanOrNull(ratesB) ?? 0.5;
  const signedDelta = avgScoreA - avgScoreB;
  const absDelta = Math.abs(signedDelta);

  let predictedWinner;
  if (absDelta < PREDICTION_DRAW_THRESHOLD) predictedWinner = 'draw';
  else if (signedDelta > 0) predictedWinner = 'A';
  else predictedWinner = 'B';

  const lineup = [...teamA, ...teamB];
  const avgGamesPlayed = lineup.length === 0
    ? 0
    : lineup.reduce((s, id) => s + (playedMap[id] ?? 0), 0) / lineup.length;

  // ── 7. Disclaimer level. First-match wins; checked in order of severity.
  let disclaimerLevel = 'none';
  if (teamGames < 15) {
    disclaimerLevel = 'early';
  } else if (avgGamesPlayed < 5) {
    disclaimerLevel = 'inconsistent';
  } else if (teamGames < MIN_TEAM_GAMES || avgGamesPlayed < MIN_AVG_PLAYER_GAMES) {
    disclaimerLevel = 'mid';
  }

  // Did the fitness axis MATERIALLY run? True only when a fitnessMap was supplied
  // AND the final split clears the coverage floor on BOTH sides — i.e. fitness
  // actually influenced the chosen split. Drives the UI "& fitness" basis clause
  // and must never over-claim below the coverage gate.
  let fitnessAxisApplied = false;
  if (fitnessActive) {
    const fA = sideFitness(teamA, fitnessMap);
    const fB = sideFitness(teamB, fitnessMap);
    fitnessAxisApplied = fA.n >= FITNESS_MIN_COVERAGE && fB.n >= FITNESS_MIN_COVERAGE;
  }

  return {
    teamA,
    teamB,
    predictedWinner,
    predictedConfidence: absDelta,
    balanceScore: absDelta,
    avgGamesPlayed,
    disclaimerLevel,
    // Additive fields (never rename/remove the seven above — Hard Rule #7):
    compositeBalanceScore: absDelta,
    usedComposite,
    ratingBreakdown: ratingBreakdown ?? null,
    predictedMargin: null,
    fitnessAxisApplied,
  };
}
