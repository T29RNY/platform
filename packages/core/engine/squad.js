// Squad engine — shared across all products

export function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

export function randomSplitTeams(players) {
  const shuffled = shuffle(players);
  const half     = Math.ceil(shuffled.length / 2);
  return shuffled.map((p, i) => ({ ...p, team: i < half ? "A" : "B" }));
}

export function areTeamsSet(players) {
  const inPlayers = players.filter(p => p.status === "in" && !p.disabled);
  return inPlayers.length > 0 && inPlayers.every(p => p.team);
}

export function getTeamPlayers(players, team) {
  return [...players.filter(p => p.status === "in" && !p.disabled && p.team === team)]
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function newPlayer(name, type = "regular", options = {}) {
  return {
    id:           "p" + Date.now(),
    name:         name.trim(),
    type,
    disabled:     false,
    priority:     options.priority || false,
    isViceCaptain: options.isViceCaptain || false,
    status:       "none",
    paid:         false,
    owes:         0,
    goals:        0,
    motm:         0,
    attended:     0,
    total:        0,
    bibCount:     0,
    team:         null,
    w:            0,
    l:            0,
    d:            0,
    payCount:     0,
    lateDropouts: 0,
    note:         "",
    selfPaid:     false,
  };
}

export function newMatch(options = {}) {
  return {
    id:           "m" + Date.now(),
    matchDate:    new Date().toISOString().split('T')[0],
    teamA:        options.teamA    || [],
    teamB:        options.teamB    || [],
    winner:       options.winner   || null,
    scoreA:       options.scoreA   || 0,
    scoreB:       options.scoreB   || 0,
    scorers:      options.scorers  || {},
    motm:         options.motm     || null,
    bibHolder:    options.bibHolder|| "",
    payments:     options.payments || {},
    cancelled:      options.cancelled || false,
    cancelReason:   options.cancelReason || "",
    scoreType:      options.scoreType || null,
    lastGoalScorer: options.lastGoalScorer || null,
  };
}

export function nextWeekDateTime(currentDateTime) {
  const d = new Date(currentDateTime || Date.now());
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

// Resolve a matches.motm value (now a player_id) to a display name.
// Falls back to the raw value for legacy name strings or departed players.
export function resolveMotm(motmValue, players) {
  if (!motmValue) return motmValue;
  const match = (players || []).find(p => p.id === motmValue);
  if (match) return match.nickname || match.name;
  return motmValue;
}
