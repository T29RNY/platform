// Availability engine — shared across all products
// Handles in/out/maybe logic, late dropouts, notes

export const STATUS = {
  IN:      "in",
  OUT:     "out",
  MAYBE:   "maybe",
  NONE:    "none",
  RESERVE: "reserve",
};

export function isLateDropout(previousStatus, newStatus, gameDateTime) {
  if (previousStatus !== STATUS.IN) return false;
  if (newStatus === STATUS.IN) return false;
  if (!gameDateTime) return false;
  const hoursUntilGame = (new Date(gameDateTime) - new Date()) / 3600000;
  return hoursUntilGame < 24;
}

export function groupByStatus(players) {
  return {
    in:      players.filter(p => p.status === STATUS.IN      && !p.disabled),
    maybe:   players.filter(p => p.status === STATUS.MAYBE   && !p.disabled),
    out:     players.filter(p => p.status === STATUS.OUT     && !p.disabled),
    none:    players.filter(p => p.status === STATUS.NONE    && !p.disabled),
    reserve: players.filter(p => p.status === STATUS.RESERVE && !p.disabled),
  };
}

export function isSquadFull(players, squadSize) {
  return players.filter(p => p.status === STATUS.IN && !p.disabled).length >= squadSize;
}

export function getConfirmedCount(players) {
  return players.filter(p => p.status === STATUS.IN && !p.disabled).length;
}

export function getNonResponders(players) {
  return players.filter(p => p.status === STATUS.NONE && !p.disabled);
}

export function getMaybes(players) {
  return players.filter(p => p.status === STATUS.MAYBE && !p.disabled);
}
