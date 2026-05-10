// Payment engine — shared across all products

export function carryForwardDebts(players, pricePerPlayer) {
  return players.map(p => ({
    ...p,
    owes:   p.paid ? 0 : (p.owes || 0) + (p.status === "in" ? pricePerPlayer : 0),
    paid:   false,
    selfPaid: false,
    status: "none",
    team:   null,
  }));
}

export function getUnpaidPlayers(players, payments) {
  return players.filter(p => p.status === "in" && !p.disabled && !payments[p.id]);
}

export function getSelfPaidPending(players) {
  return players.filter(p => p.selfPaid && !p.paid);
}

export function generateMatchReport(match, groupName) {
  if (match.cancelled) {
    return `${groupName}\n${match.date}\n\n❌ CANCELLED\n${match.cancelReason || ""}`;
  }
  const result  = match.winner === "D" ? "DRAW" : `TEAM ${match.winner} WIN`;
  const scorerLines = Object.entries(match.scorers || {})
    .filter(([, g]) => g > 0)
    .map(([n, g]) => `  ${n} ${"⚽".repeat(g)}`)
    .join("\n");
  return [
    groupName,
    match.date,
    "",
    result,
    `Team A ${match.scoreA} — ${match.scoreB} Team B`,
    "",
    "Scorers:",
    scorerLines || "  None recorded",
    "",
    `MOTM: ${match.motm || "—"}`,
    "",
    "via in-or-out.com",
  ].join("\n");
}
