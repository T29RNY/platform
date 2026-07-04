export function hasGoalData(scoreType) {
  return !scoreType || scoreType === 'exact';
}

export function resolveDominantType(matches, opts = {}) {
  if (!matches || matches.length === 0) return 'exact';

  const { window = 20, threshold = 0.7 } = opts;

  const scored = matches
    .filter(m => m.cancelled !== true && m.score_a != null);

  if (scored.length === 0) return 'exact';

  const sorted = [...scored].sort((a, b) =>
    (b.match_date || '') < (a.match_date || '') ? -1 :
    (b.match_date || '') > (a.match_date || '') ?  1 : 0
  );

  const recent = sorted.slice(0, window);
  const counts = {};
  for (const m of recent) {
    const key = m.score_type || 'exact';
    counts[key] = (counts[key] || 0) + 1;
  }

  const total = recent.length;
  for (const [type, count] of Object.entries(counts)) {
    if (count / total >= threshold) return type;
  }

  return 'exact';
}

// Per-player match counters derived from the match list (player_match source of
// truth, surfaced on each match's teamA/teamB/scorers/motm/winner). Mirrors the
// core loop of App.jsx's computeStatsFromHistory — used as a fallback so a view
// can guarantee a populated matchStats block even on routes where the server /
// App stats block is absent (e.g. an admin-token route with no auth session, so
// is_self never resolves). Score-type agnostic: `goals` come from the scorers map,
// which is only populated for exact-score matches.
export function computePlayerMatchStats(player, matches) {
  const empty = { games: 0, attended: 0, wins: 0, losses: 0, draws: 0, goals: 0, motm: 0, bibs: 0 };
  if (!player || !matches) return empty;

  const playerId = player.id;
  const names = new Set([player.name?.toLowerCase()].filter(Boolean));
  if (player.nickname) names.add(player.nickname.toLowerCase());
  const isMe = (v) => v === playerId || (v != null && names.has(String(v).toLowerCase()));

  let wins = 0, draws = 0, losses = 0, goals = 0, motm = 0;
  for (const m of matches) {
    if (m.cancelled || !m.winner) continue;
    const inA = (m.teamA || []).some(isMe);
    const inB = (m.teamB || []).some(isMe);
    if (!inA && !inB) continue;

    if (m.winner === 'D') draws++;
    else if ((m.winner === 'A' && inA) || (m.winner === 'B' && inB)) wins++;
    else losses++;

    for (const [key, g] of Object.entries(m.scorers || {})) {
      if (isMe(key)) goals += (g || 0);
    }
    if (m.motm && isMe(m.motm)) motm++;
  }

  const attended = wins + draws + losses;
  return { games: attended, attended, wins, losses, draws, goals, motm, bibs: 0 };
}

export function periodCutoff(period) {
  const now = new Date();
  if (period === 'month')  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  if (period === 'season') return `${now.getFullYear()}-01-01`;
  return null;
}
