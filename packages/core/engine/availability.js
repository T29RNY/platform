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

// Stable sort by reservePriorityOrder (admin-set bench queue).
// NULL/undefined orders sort to the back. Reserves with the same priority
// (shouldn't happen post-trigger, but defensive) keep their input order.
export function sortByReservePriority(players) {
  return [...players].sort((a, b) => {
    const ao = a.reservePriorityOrder;
    const bo = b.reservePriorityOrder;
    if (ao == null && bo == null) return 0;
    if (ao == null) return 1;
    if (bo == null) return -1;
    return ao - bo;
  });
}

// Persistent-guests (S1): a guest reset to status='none' on rollover is
// "dormant" — kept on the team (history + returning-guest picker) but hidden
// from the weekly board. A guest with any active status still renders normally.
export function isDormantGuest(p) {
  return p?.isGuest === true && p?.status === STATUS.NONE;
}

export function groupByStatus(players) {
  const visible = players.filter(p => !isDormantGuest(p));
  return {
    in:      visible.filter(p => p.status === STATUS.IN      && !p.disabled),
    maybe:   visible.filter(p => p.status === STATUS.MAYBE   && !p.disabled),
    out:     visible.filter(p => p.status === STATUS.OUT     && !p.disabled),
    none:    visible.filter(p => p.status === STATUS.NONE    && !p.disabled),
    reserve: sortByReservePriority(
      visible.filter(p => p.status === STATUS.RESERVE && !p.disabled)
    ),
  };
}

export function isSquadFull(players, squadSize) {
  return players.filter(p => p.status === STATUS.IN && !p.disabled).length >= squadSize;
}

export function getConfirmedCount(players) {
  return players.filter(p => p.status === STATUS.IN && !p.disabled).length;
}

export function getNonResponders(players) {
  return players.filter(p => p.status === STATUS.NONE && !p.disabled && !isDormantGuest(p));
}

export function getMaybes(players) {
  return players.filter(p => p.status === STATUS.MAYBE && !p.disabled);
}
