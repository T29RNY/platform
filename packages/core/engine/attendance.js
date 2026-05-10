// Attendance and stats engine — shared across all products

export function calcStreaks(players, matchHistory) {
  const streaks = {};
  players.forEach(p => {
    let winStreak = 0, attendStreak = 0;
    for (const m of matchHistory) {
      if (m.cancelled) continue;
      const allPlayers = [...(m.teamA || []), ...(m.teamB || [])];
      if (!allPlayers.includes(p.name)) { attendStreak = 0; break; }
      attendStreak++;
      const onA = m.teamA.includes(p.name);
      const won = (onA && m.winner === "A") || (!onA && m.winner === "B");
      if (won) winStreak++; else break;
    }
    streaks[p.id] = { winStreak, attendStreak };
  });
  return streaks;
}

export function biggestWins(matchHistory) {
  return [...matchHistory]
    .filter(m => !m.cancelled && m.winner !== "D")
    .map(m => ({ ...m, diff: Math.abs((m.scoreA || 0) - (m.scoreB || 0)) }))
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);
}

export function topSingleGame(matchHistory) {
  let best = { name: "", goals: 0, date: "" };
  matchHistory.filter(m => !m.cancelled).forEach(m => {
    Object.entries(m.scorers || {}).forEach(([name, goals]) => {
      if (goals > best.goals) best = { name, goals, date: m.dateShort };
    });
  });
  return best;
}

export function payRate(player) {
  return player.total > 0 ? Math.round((player.payCount || 0) / player.total * 100) : 100;
}

export function getHatTricks(matchHistory) {
  return matchHistory
    .filter(m => !m.cancelled)
    .flatMap(m =>
      Object.entries(m.scorers || {})
        .filter(([, g]) => g >= 3)
        .map(([name, goals]) => ({ name, goals, date: m.dateShort, id: m.id + name }))
    )
    .sort((a, b) => b.goals - a.goals);
}

export function updatePlayerRecords(players, match, scorers, motmVote, payments) {
  const teamAPlayers = match.teamA || [];
  const teamBPlayers = match.teamB || [];
  const allPlayers   = [...teamAPlayers, ...teamBPlayers];

  return players.map(p => {
    if (!allPlayers.includes(p.name)) return p;
    const onA  = teamAPlayers.includes(p.name);
    const won  = (onA && match.winner === "A") || (!onA && match.winner === "B");
    const drew = match.winner === "D";
    return {
      ...p,
      w:        (p.w || 0) + (won ? 1 : 0),
      l:        (p.l || 0) + (!won && !drew ? 1 : 0),
      d:        (p.d || 0) + (drew ? 1 : 0),
      goals:    (p.goals || 0) + (scorers[p.id] || 0),
      motm:     (p.motm || 0) + (motmVote === p.name ? 1 : 0),
      attended: (p.attended || 0) + 1,
      total:    (p.total || 0) + 1,
      payCount: (p.payCount || 0) + (payments[p.name] ? 1 : 0),
      team:     null,
      status:   "none",
      paid:     false,
    };
  });
}
