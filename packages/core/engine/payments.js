// Payment engine — shared across all products
import { supabase } from "../storage/supabase.js";

// ─── Payment state ────────────────────────────────────────────────────────────

/**
 * Returns the canonical payment state for a player.
 * cashPending — caller-supplied local UI flag (set when player taps "Will Pay Cash"
 * but hasn't yet confirmed; never persisted to DB).
 */
export function getPaymentState(player, cashPending = false) {
  if (cashPending === true) return 'cash_pending';
  // Check both camelCase (JS objects via dbToPlayer) and snake_case (raw DB rows)
  if (player.paid === true || player.selfPaid === true || player.self_paid === true) return 'paid';
  if (player.owes > 0)      return 'debt';
  return 'unpaid';
}

/**
 * Returns the payment state for a guest player.
 * guestCashPending — caller-supplied UI flag while host is confirming.
 * Returns: 'cash_pending' | 'paid_stripe' | 'paid_cash' | 'unpaid'
 */
export function getGuestPaymentState(guest, guestCashPending = false) {
  if (guestCashPending === true) return 'cash_pending';
  if (guest.paid === true) return 'paid_stripe';
  if (guest.self_paid === true || guest.selfPaid === true) return 'paid_cash';
  if (guest.guest_of || guest.guestOf) return 'unpaid';
  return 'unpaid';
}

/**
 * Returns the active payment mode.
 * Reads schedule.payment_mode when the column exists; defaults to 'both'.
 * When Stripe Connect is live, admin sets schedule.payment_mode = 'stripe_only'.
 */
export function getPaymentMode(schedule) {
  return schedule?.payment_mode || 'both';
}

// ─── Payment handlers ─────────────────────────────────────────────────────────

/** Player confirms they've paid cash. Sets self_paid = true and paid_by in DB. */
export async function handleCashPayment(playerId, teamId, paidBy = 'self') {
  const { error } = await supabase
    .from("players")
    .update({ self_paid: true, paid_by: paidBy })
    .eq("id", playerId);
  if (error) throw error;
  return { selfPaid: true, paidBy };
}

/** Host or admin confirms cash payment for a guest. */
export async function handleGuestCashPayment(guestId, teamId, paidBy = 'host') {
  const { error } = await supabase
    .from("players")
    .update({ self_paid: true, paid_by: paidBy })
    .eq("id", guestId);
  if (error) throw error;
  return { selfPaid: true, paidBy };
}

/** Admin or player clears a prior-game debt. Sets owes = 0 in DB. */
export async function handleClearDebt(playerId, teamId) {
  const { error } = await supabase
    .from("players")
    .update({ owes: 0 })
    .eq("id", playerId);
  if (error) throw error;
  return { owes: 0 };
}

/**
 * Stripe integration point — stub only.
 * When live: writes paid=true, paid_by='stripe' to players table.
 */
export async function handleStripePayment(playerId, teamId, amount) {
  console.log('[ioo] Stripe payment triggered — not yet live', { playerId, teamId, amount });
  return { success: false, reason: 'stripe_not_configured' };
}

/** Admin confirms a player has paid (e.g. Stripe). Sets paid = true in DB. */
export async function handleMarkPaid(playerId, teamId) {
  const { error } = await supabase
    .from("players")
    .update({ paid: true })
    .eq("id", playerId);
  if (error) throw error;
  return { paid: true };
}

/** Resets all payment flags for a player. */
export async function handleResetPayment(playerId, teamId) {
  const { error } = await supabase
    .from("players")
    .update({ paid: false, self_paid: false, paid_by: null })
    .eq("id", playerId);
  if (error) throw error;
  return { paid: false, selfPaid: false, paidBy: null };
}

// ─── Existing functions ───────────────────────────────────────────────────────

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
  const dateStr = match.matchDate
    ? new Date(match.matchDate).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })
    : "";
  if (match.cancelled) {
    return `${groupName}\n${dateStr}\n\n❌ CANCELLED\n${match.cancelReason || ""}`;
  }
  const result  = match.winner === "D" ? "DRAW" : `TEAM ${match.winner} WIN`;
  const scorerLines = Object.entries(match.scorers || {})
    .filter(([, g]) => g > 0)
    .map(([n, g]) => `  ${n} ${"⚽".repeat(g)}`)
    .join("\n");
  return [
    groupName,
    dateStr,
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
