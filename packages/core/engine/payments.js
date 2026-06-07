// Payment engine — shared across all products
// Raw supabase.rpc() calls live in the storage layer (supabase.js), never here —
// these handlers delegate to the named wrappers (mig 211 / hygiene rule [6]).
import {
  setPlayerPaid, setGuestPayment, confirmPayment, resetPayment, waiveDebt,
} from "../storage/supabase.js";

// ─── Payment state ────────────────────────────────────────────────────────────

/**
 * Returns the canonical payment state for a player.
 * cashPending — caller-supplied local UI flag (set when player taps "Will Pay Cash"
 * but hasn't yet confirmed; never persisted to DB).
 */
export function getPaymentState(player, cashPending = false) {
  if (cashPending === true) return 'cash_pending';
  // Check both camelCase (JS objects via dbToPlayer) and snake_case (raw DB rows).
  // paid = admin-CONFIRMED. self_paid = the player's pending CLAIM, awaiting
  // confirmation — still outstanding (owes isn't cleared until an admin confirms).
  // See mig 211 (self-pay = pending claim).
  if (player.paid === true) return 'paid';
  if (player.selfPaid === true || player.self_paid === true) return 'claimed';
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

// ─── Payment handlers ─────────────────────────────────────────────────────────

/** Player self-declares cash payment (pending claim — mig 211). */
export async function handleCashPayment(token) {
  await setPlayerPaid(token);
}

/** Host/guest declares a guest's cash payment. */
export async function handleGuestCashPayment(hostToken, guestId, paidBy = 'host') {
  await setGuestPayment(hostToken, guestId, paidBy);
}

/** Admin confirms a player has paid (settles the debt — mig 211). */
export async function handleMarkPaid(adminToken, playerId, matchId = null) {
  await confirmPayment(adminToken, playerId, matchId || null);
  return { paid: true };
}

/** Resets all payment flags for a player (restores owes if it was confirmed). */
export async function handleResetPayment(adminToken, playerId, matchId = null) {
  await resetPayment(adminToken, playerId, matchId || null);
  return { paid: false, selfPaid: false, paidBy: null, paidAt: null };
}

/** Admin waives a player's debt. */
export async function handleWaiveDebt(adminToken, playerId, note = null) {
  await waiveDebt(adminToken, playerId, note || null);
  return { owes: 0 };
}

