// Deeper IO Intelligence — pure client-side computation from match history.
// All metrics derived from matches[] (teamA/teamB name arrays + winner)
// and squad[] (id + name + nickname). No DB calls.

const MIN_PAIR_GAMES = 3;       // nemesis / best partnership eligibility
const MIN_RELIABILITY_GAMES = 3; // reliability ranking eligibility

function buildNameToId(squad) {
  const map = {};
  for (const p of squad || []) {
    if (p?.name)     map[p.name.toLowerCase()]     = p.id;
    if (p?.nickname) map[p.nickname.toLowerCase()] = p.id;
  }
  return map;
}

function playedIds(names, nameToId) {
  const ids = new Set();
  for (const n of names || []) {
    const id = nameToId[n?.toLowerCase()];
    if (id) ids.add(id);
  }
  return ids;
}

export function computeDeeperIntel(playerId, squad, matches) {
  if (!playerId || !squad?.length || !matches?.length) {
    return {
      mostPlayedWith: [],
      mostFacedOpponent: [],
      nemesis: [],
      bestPartnership: [],
      impact: null,
      reliabilityRanking: [],
    };
  }

  const nameToId = buildNameToId(squad);
  const byId = Object.fromEntries(squad.map(p => [p.id, p]));

  // Per-pair counters: { [otherId]: { withGames, withWins, vsGames, vsLosses } }
  const pair = {};
  const ensure = (id) => (pair[id] ||= { withGames: 0, withWins: 0, vsGames: 0, vsLosses: 0 });

  // Per-squad-member attendance for reliability ranking
  const attend = {}; // { [id]: { attended, total } }
  const totalNonCancelled = matches.filter(m => !m.cancelled).length;

  // Impact: team win rate WITH you vs WITHOUT you (across played matches)
  let teamGamesWithYou = 0, teamWinsWithYou = 0;
  let teamGamesWithoutYou = 0, teamWinsWithoutYou = 0;

  for (const m of matches) {
    if (m.cancelled || !m.winner) continue;

    const aIds = playedIds(m.teamA, nameToId);
    const bIds = playedIds(m.teamB, nameToId);

    // attendance tally for every squad member who appeared
    for (const id of [...aIds, ...bIds]) {
      if (!attend[id]) attend[id] = { attended: 0, total: totalNonCancelled };
      attend[id].attended += 1;
    }

    const youInA = aIds.has(playerId);
    const youInB = bIds.has(playerId);

    if (!youInA && !youInB) {
      // You missed — count both teams for impact (without-you sample)
      teamGamesWithoutYou += 2;
      if (m.winner === "A") teamWinsWithoutYou += 1;
      else if (m.winner === "B") teamWinsWithoutYou += 1;
      else if (m.winner === "D") teamWinsWithoutYou += 1; // draws count as 0.5 each side
      // (kept simple: half-credit handled implicitly by counting both teams once)
      continue;
    }

    // You played
    const yourTeam = youInA ? "A" : "B";
    const teammates = youInA ? aIds : bIds;
    const opponents = youInA ? bIds : aIds;

    const youWon  = m.winner === yourTeam;
    const youLost = m.winner !== "D" && m.winner !== yourTeam;

    teamGamesWithYou += 1;
    if (youWon) teamWinsWithYou += 1;

    for (const id of teammates) {
      if (id === playerId) continue;
      const p = ensure(id);
      p.withGames += 1;
      if (youWon) p.withWins += 1;
    }
    for (const id of opponents) {
      const p = ensure(id);
      p.vsGames += 1;
      if (youLost) p.vsLosses += 1;
    }
  }

  const decorate = (id) => {
    const p = byId[id] || {};
    return { playerId: id, name: p.name, nickname: p.nickname };
  };

  // Most played with — by withGames desc
  const mostPlayedWith = Object.entries(pair)
    .filter(([, v]) => v.withGames > 0)
    .map(([id, v]) => ({
      ...decorate(id),
      games: v.withGames,
      winRate: Math.round((v.withWins / v.withGames) * 100),
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 5);

  // Most faced opponent — by vsGames desc
  const mostFacedOpponent = Object.entries(pair)
    .filter(([, v]) => v.vsGames > 0)
    .map(([id, v]) => ({
      ...decorate(id),
      games: v.vsGames,
      lossRate: Math.round((v.vsLosses / v.vsGames) * 100),
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 5);

  // Best partnership — winRate desc among teammates with ≥ MIN_PAIR_GAMES together
  const bestPartnership = Object.entries(pair)
    .filter(([, v]) => v.withGames >= MIN_PAIR_GAMES)
    .map(([id, v]) => ({
      ...decorate(id),
      games: v.withGames,
      winRate: Math.round((v.withWins / v.withGames) * 100),
    }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
    .slice(0, 5);

  // Nemesis — lossRate desc among opponents you've faced ≥ MIN_PAIR_GAMES times
  const nemesis = Object.entries(pair)
    .filter(([, v]) => v.vsGames >= MIN_PAIR_GAMES)
    .map(([id, v]) => ({
      ...decorate(id),
      games: v.vsGames,
      lossRate: Math.round((v.vsLosses / v.vsGames) * 100),
    }))
    .sort((a, b) => b.lossRate - a.lossRate || b.games - a.games)
    .slice(0, 5);

  // Impact — team win rate with you vs without (need samples on both sides)
  let impact = null;
  if (teamGamesWithYou >= 1) {
    const withRate = Math.round((teamWinsWithYou / teamGamesWithYou) * 100);
    if (teamGamesWithoutYou >= 2) {
      const withoutRate = Math.round((teamWinsWithoutYou / teamGamesWithoutYou) * 100);
      impact = { withRate, withoutRate, diff: withRate - withoutRate };
    } else {
      impact = { withRate, withoutRate: null, diff: null };
    }
  }

  // Reliability ranking — attended/total desc, min MIN_RELIABILITY_GAMES total exposure
  const reliabilityRanking = squad
    .map(p => {
      const a = attend[p.id]?.attended ?? 0;
      const t = totalNonCancelled;
      if (t < MIN_RELIABILITY_GAMES) return null;
      return {
        playerId: p.id,
        name: p.name,
        nickname: p.nickname,
        attended: a,
        total: t,
        reliability: Math.round((a / t) * 100),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.reliability - a.reliability || b.attended - a.attended);

  return {
    mostPlayedWith,
    mostFacedOpponent,
    nemesis,
    bestPartnership,
    impact,
    reliabilityRanking,
  };
}
