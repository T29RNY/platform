// Payment engine — shared across all products
import { supabase } from "../storage/supabase.js";
import { createLedgerEntry } from "../storage/supabase.js";

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

// ─── Payment handlers ─────────────────────────────────────────────────────────

/** Player confirms they've paid cash. */
export async function handleCashPayment(token) {
  const { error } = await supabase.rpc('set_player_paid', { p_token: token });
  if (error) throw error;
}

/** Host confirms cash payment for a guest. */
export async function handleGuestCashPayment(hostToken, guestId, paidBy = 'host') {
  const { error } = await supabase.rpc('set_guest_payment', {
    p_host_token: hostToken,
    p_guest_id:   guestId,
    p_paid_by:    paidBy,
  });
  if (error) throw error;
}

/** Admin confirms a player has paid. */
export async function handleMarkPaid(adminToken, playerId, matchId = null) {
  const { error } = await supabase.rpc('admin_confirm_payment', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_match_id:    matchId || null,
  });
  if (error) throw error;
  return { paid: true };
}

/** Resets all payment flags for a player. */
export async function handleResetPayment(adminToken, playerId, matchId = null) {
  const { error } = await supabase.rpc('admin_reset_payment', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_match_id:    matchId || null,
  });
  if (error) throw error;
  return { paid: false, selfPaid: false, paidBy: null, paidAt: null };
}

/** Admin waives a player's debt. */
export async function handleWaiveDebt(adminToken, playerId, note = null) {
  const { error } = await supabase.rpc('admin_waive_debt', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_note:        note || null,
  });
  if (error) throw error;
  return { owes: 0 };
}

