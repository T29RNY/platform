// PLAYER RATING — Pure per-player composite strength engine.
//
// ADMIN-ONLY signal, exactly like groupBalancer.js: the numbers computed here
// (skill θ, composite strength) MUST NEVER flow to a player route or any
// player-visible state. Only the balancer's teamA/teamB output may reach
// players. This module is Math-only — no Supabase, no I/O, no Math.random —
// so the same history always yields the same ratings (determinism is required
// so a lineup's predicted winner never flickers between reshuffles).
//
// It replaces "win-rate only" with a composite of four per-player signals:
//
//   • SKILL — a ridge-regularized batch Bradley-Terry rating inferred from the
//     ACTUAL A-vs-B team compositions and results across all history. The
//     reshuffle graph (players keep landing on different sides) makes individual
//     strength identifiable. Margin-weighted where a scoreline is derivable.
//   • GOALS — goals per exact-score game attended.
//   • POTM  — player-of-the-match rate.
//   • FORM  — last-5 results.
//
// Goals/POTM/form are each empirical-Bayes shrunk toward the squad mean so a
// 2-game hot streak can't dominate a reshuffle, then mapped to a squad-relative
// 0–1 score (0.5 = squad average). SKILL is σ(θ), already squad-centred by the
// ridge prior (θ=0 ⇒ 0.5).
//
// The blend is ADAPTIVE: early (few team-games) it leans on the fast per-player
// signals (goals/POTM/form); as team-games accumulate it hands authority to the
// skill rating. This is what makes it useful at ~5 games.
//
// Input (threaded additively by getPlayerLeagueTable — RPC already returns it):
//   {
//     players:       [{ playerId, played, potm, form:[…'W'/'L'/'D'], ranked }],
//                    // per-player aggregates; guests/unranked absent in PR1
//     matchRows:     [{ player_id, match_id, attended, result, goals,
//                       was_motm, team_assignment }],   // raw player_match rows
//     exactMatchIds: [matchId, …],   // matches with a real scoreline (goal gate)
//   }
//
// Returns:
//   {
//     ratingMap:  { playerId: composite 0–1 },   // 0.5 = squad average
//     skillMap:   { playerId: skill 0–1 },
//     breakdown:  { playerId: { skill, goals, potm, form, weights } },
//   }
//
// A player with no usable data (0 games) resolves to exactly 0.5 on every axis.

// ── Tunables ─────────────────────────────────────────────────────────────────
const RIDGE_LAMBDA        = 1.5;   // BT L2 prior — shrinkage AND the separation fix
const BT_ITERATIONS       = 100;   // damped diagonal-Newton steps (fixed = deterministic)
const BT_STEP_DAMPING     = 0.9;   // damping on each Newton step for stability
const MARGIN_WEIGHT_SCALE = 0.15;  // exact-score margin uplift per goal
const MARGIN_CAP          = 5;     // margin beyond this stops adding weight

const K_GOALS = 6;   // empirical-Bayes prior strength (pseudo-games) per component
const K_POTM  = 9;
const K_FORM  = 4;

const SKILL_TRUST_PRIOR = 20;      // teamGames/(teamGames+20) → authority to skill

// Adaptive blend endpoints. Lerp EARLY → MATURE by skillTrust. Each sums to 1.
const W_EARLY  = { skill: 0.15, form: 0.30, goals: 0.30, potm: 0.25 };
const W_MATURE = { skill: 0.60, form: 0.15, goals: 0.15, potm: 0.10 };

// ── Small pure helpers ───────────────────────────────────────────────────────
function logistic(x) { return 1 / (1 + Math.exp(-x)); }

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values, mu) {
  if (values.length === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mu) * (v - mu), 0) / values.length;
  return Math.sqrt(variance);
}

// Empirical-Bayes shrinkage of a per-player rate toward the squad mean.
// n = evidence count; k = prior strength. n=0 ⇒ returns the squad mean exactly.
function shrink(rawSum, n, k, squadMean) {
  return (rawSum + k * squadMean) / (n + k);
}

// Map a shrunk per-player value to a squad-relative 0–1 score (0.5 = squad mean).
// Standardise by squad spread then squash; a near-flat squad maps everyone ~0.5.
function relativeScore(value, mu, sigma) {
  const s = sigma > 1e-6 ? sigma : 1e-6;
  return logistic((value - mu) / s);
}

// ── Bradley-Terry skill solve ─────────────────────────────────────────────────
// Reconstruct every historical A-vs-B match from the raw rows, then fit a latent
// θ per player by maximising a ridge-penalised BT log-likelihood. Team strength =
// MEAN of member θ (robust to 6-v-5, doesn't reward stacking). Draw = y=0.5.
// Returns { skillMap:{id:σ(θ)}, thetaIds:[…] } over EVERY player who ever played
// (guests and <3-game players included as latents so team means are correct — but
// only surfaced downstream for players present in the aggregates).
function solveSkill(matchRows, exactMatchIdSet) {
  // Group attended rows by match.
  const byMatch = new Map();
  const playerIndex = new Map();   // playerId → dense θ index
  for (const r of matchRows) {
    if (!r.attended) continue;
    if (r.team_assignment !== 'A' && r.team_assignment !== 'B') continue;
    if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, []);
    byMatch.get(r.match_id).push(r);
    if (!playerIndex.has(r.player_id)) playerIndex.set(r.player_id, playerIndex.size);
  }

  const n = playerIndex.size;
  const skillMap = {};
  if (n === 0) return { skillMap, playerIds: [] };

  // Build the observation set: per match → { aIdx[], bIdx[], y, weight }.
  const obs = [];
  for (const rows of byMatch.values()) {
    const aIdx = [];
    const bIdx = [];
    let goalsA = 0, goalsB = 0;
    let outcome = null;  // 'w' (A won) | 'l' (B won) | 'd'
    let matchId = null;
    for (const r of rows) {
      matchId = r.match_id;
      if (r.team_assignment === 'A') {
        aIdx.push(playerIndex.get(r.player_id));
        goalsA += r.goals || 0;
        // result is from THIS row's perspective; an A player's 'w' ⇒ A won.
        if (r.result === 'w') outcome = 'w';
        else if (r.result === 'l') outcome = 'l';
        else if (r.result === 'd') outcome = 'd';
      } else {
        bIdx.push(playerIndex.get(r.player_id));
        goalsB += r.goals || 0;
      }
    }
    if (aIdx.length === 0 || bIdx.length === 0) continue;  // need both sides
    if (outcome === null) continue;                         // no decided result
    const y = outcome === 'w' ? 1 : outcome === 'l' ? 0 : 0.5;

    let weight = 1;
    if (exactMatchIdSet.has(matchId)) {
      const margin = Math.abs(goalsA - goalsB);
      weight = 1 + MARGIN_WEIGHT_SCALE * Math.min(margin, MARGIN_CAP);
    }
    obs.push({ aIdx, bIdx, y, weight });
  }

  // Damped diagonal-Newton on the concave penalised log-likelihood. θ starts at 0
  // (⇒ everyone at squad average) and each step is θ_i += ∇_i / (H_ii + λ), which
  // is scale-invariant (no learning-rate tuning) and stable (denominator ≥ λ > 0).
  const theta = new Float64Array(n);
  for (let iter = 0; iter < BT_ITERATIONS; iter++) {
    const grad = new Float64Array(n);
    const hess = new Float64Array(n);   // diagonal of the (negated) data Hessian
    for (const o of obs) {
      const sA = mean(o.aIdx.map(i => theta[i]));
      const sB = mean(o.bIdx.map(i => theta[i]));
      const d = sA - sB;
      const p = logistic(d);
      const g = o.weight * (o.y - p);        // ∂logL/∂d
      const h = o.weight * p * (1 - p);      // -∂²logL/∂d²  (≥ 0)
      const invA = 1 / o.aIdx.length;
      const invB = 1 / o.bIdx.length;
      for (const i of o.aIdx) { grad[i] += g * invA; hess[i] += h * invA * invA; }
      for (const i of o.bIdx) { grad[i] -= g * invB; hess[i] += h * invB * invB; }
    }
    for (let i = 0; i < n; i++) {
      const fullGrad = grad[i] - RIDGE_LAMBDA * theta[i];
      const denom = hess[i] + RIDGE_LAMBDA;
      theta[i] += BT_STEP_DAMPING * (fullGrad / denom);
    }
  }

  for (const [playerId, idx] of playerIndex.entries()) {
    skillMap[playerId] = logistic(theta[idx]);
  }
  return { skillMap, playerIds: [...playerIndex.keys()] };
}

// ── Public entry ──────────────────────────────────────────────────────────────
export function computePlayerRatings(tableData, opts = {}) {
  const players = tableData?.players ?? [];
  const matchRows = tableData?.matchRows ?? [];
  const exactMatchIdSet = new Set(tableData?.exactMatchIds ?? []);
  const teamGames = opts.teamGames ?? 0;

  const { skillMap } = solveSkill(matchRows, exactMatchIdSet);

  // Per-player raw evidence for goals/potm/form, from the aggregates + raw rows.
  // Goals reuse the exact-score gate (never divide by zero — a player with no
  // exact games attended shrinks fully to the prior).
  const goalsByPlayer = {};   // { id: { sum, n } }  n = exact games attended
  for (const r of matchRows) {
    if (!r.attended) continue;
    if (!exactMatchIdSet.has(r.match_id)) continue;
    const e = goalsByPlayer[r.player_id] ?? (goalsByPlayer[r.player_id] = { sum: 0, n: 0 });
    e.sum += r.goals || 0;
    e.n += 1;
  }

  // Per-player rates before shrinkage.
  const goalRate = {};   // goals / exact game
  const potmRate = {};   // potm / played
  const formRate = {};   // (wins + 0.5·draws) / len(form)
  const goalN = {}, potmN = {}, formN = {};
  for (const p of players) {
    const id = p.playerId;
    const g = goalsByPlayer[id] ?? { sum: 0, n: 0 };
    goalN[id] = g.n;
    goalRate[id] = g.n > 0 ? g.sum / g.n : null;

    const played = p.played ?? 0;
    potmN[id] = played;
    potmRate[id] = played > 0 ? (p.potm ?? 0) / played : null;

    const form = Array.isArray(p.form) ? p.form : [];
    formN[id] = form.length;
    if (form.length > 0) {
      const w = form.filter(r => r === 'W').length;
      const d = form.filter(r => r === 'D').length;
      formRate[id] = (w + 0.5 * d) / form.length;
    } else {
      formRate[id] = null;
    }
  }

  // Squad means over players who HAVE the signal (ranked-first, else anyone).
  const squadMean = (rate) => {
    const vals = players.map(p => rate[p.playerId]).filter(v => v !== null && v !== undefined);
    return vals.length > 0 ? mean(vals) : 0;
  };
  const goalMean = squadMean(goalRate);
  const potmMean = squadMean(potmRate);
  const formMean = squadMean(formRate);

  // Shrink each per-player rate toward its squad mean.
  const goalShrunk = {}, potmShrunk = {}, formShrunk = {};
  for (const p of players) {
    const id = p.playerId;
    goalShrunk[id] = shrink((goalRate[id] ?? 0) * goalN[id], goalN[id], K_GOALS, goalMean);
    potmShrunk[id] = shrink((potmRate[id] ?? 0) * potmN[id], potmN[id], K_POTM, potmMean);
    formShrunk[id] = shrink((formRate[id] ?? 0) * formN[id], formN[id], K_FORM, formMean);
  }

  // Standardise each shrunk value to a squad-relative 0–1 score. The centre is
  // the PRIOR mean (the squad-average raw rate, i.e. the exact value a 0-evidence
  // player shrinks to) — NOT the mean of the shrunk vector, which drifts from the
  // prior when players have unequal game counts. Centring on the prior makes
  // "0.5 = squad average" exact and guarantees a 0-game player lands on exactly
  // 0.5 on every axis (done-check), for any mix of game counts. Spread (sigma) is
  // measured around that same prior centre.
  const spread = (shrunk, priorMu) => {
    const vals = players.map(p => shrunk[p.playerId]);
    return { mu: priorMu, sigma: stddev(vals, priorMu) };
  };
  const gS = spread(goalShrunk, goalMean);
  const pS = spread(potmShrunk, potmMean);
  const fS = spread(formShrunk, formMean);

  // Adaptive weights — same for every player this reshuffle (depends on teamGames).
  const skillTrust = teamGames / (teamGames + SKILL_TRUST_PRIOR);
  const lerp = (a, b) => a + skillTrust * (b - a);
  const weights = {
    skill: lerp(W_EARLY.skill, W_MATURE.skill),
    form:  lerp(W_EARLY.form,  W_MATURE.form),
    goals: lerp(W_EARLY.goals, W_MATURE.goals),
    potm:  lerp(W_EARLY.potm,  W_MATURE.potm),
  };

  const ratingMap = {};
  const outSkill = {};
  const breakdown = {};
  for (const p of players) {
    const id = p.playerId;
    const skill = skillMap[id] ?? 0.5;                              // 0.5 if never played
    const goals = relativeScore(goalShrunk[id], gS.mu, gS.sigma);
    const potm  = relativeScore(potmShrunk[id], pS.mu, pS.sigma);
    const form  = relativeScore(formShrunk[id], fS.mu, fS.sigma);
    const composite =
      weights.skill * skill +
      weights.goals * goals +
      weights.potm  * potm +
      weights.form  * form;
    ratingMap[id] = composite;
    outSkill[id] = skill;
    breakdown[id] = { skill, goals, potm, form, weights };
  }

  return { ratingMap, skillMap: outSkill, breakdown };
}
