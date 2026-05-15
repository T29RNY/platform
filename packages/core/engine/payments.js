// Payment engine — shared across all products
import { supabase } from "../storage/supabase.js";
import { createLedgerEntry, updateLedgerEntry, getLedgerForPlayer, findMatchLedgerEntry } from "../storage/supabase.js";

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
export async function handleCashPayment(playerId, teamId, paidBy = 'self', matchId = null, amount = 0) {
  try {
    const paidAt = new Date().toISOString();
    const { error } = await supabase
      .from("players")
      .update({ self_paid: true, paid_by: paidBy, paid_at: paidAt })
      .eq("id", playerId);
    if (error) throw error;
    const existing = await findMatchLedgerEntry(playerId, teamId, matchId, 'game_fee');
    if (existing) {
      await updateLedgerEntry(existing.id, {
        status: 'paid',
        method: paidBy === 'stripe' ? 'stripe' : 'cash',
        paidBy,
        paidAt,
      });
    } else {
      await createLedgerEntry({
        teamId, playerId, matchId: matchId || null, amount: amount || 0,
        type: 'game_fee', status: 'paid',
        method: paidBy === 'stripe' ? 'stripe' : 'cash',
        paidBy, paidAt, note: null,
      });
    }
    return { selfPaid: true, paidBy, paidAt };
  } catch (error) {
    console.error('handleCashPayment error:', error);
    throw error;
  }
}

/** Host or admin confirms cash payment for a guest. */
export async function handleGuestCashPayment(guestId, teamId, paidBy = 'host', matchId = null, amount = 0, guestName = null) {
  const paidAt = new Date().toISOString();
  const { error } = await supabase
    .from("players")
    .update({ self_paid: true, paid_by: paidBy, paid_at: paidAt })
    .eq("id", guestId);
  if (error) throw error;
  await createLedgerEntry({
    teamId, playerId: guestId, matchId: matchId || null, amount: amount || 0,
    type: 'guest_fee', status: 'paid', method: 'cash',
    paidBy, paidAt, note: guestName ? `Guest: ${guestName}` : null,
  });
  return { selfPaid: true, paidBy, paidAt };
}

/** Admin or player clears a prior-game debt. Sets owes = 0 in DB. */
export async function handleClearDebt(playerId, teamId, amount = 0) {
  const paidAt = new Date().toISOString();
  const { error } = await supabase
    .from("players")
    .update({ owes: 0 })
    .eq("id", playerId);
  if (error) throw error;
  await createLedgerEntry({
    teamId, playerId, matchId: null, amount: amount || 0,
    type: 'debt_payment', status: 'paid', method: 'cash',
    paidBy: 'self', paidAt, note: null,
  });
  return { owes: 0 };
}

/**
 * Stripe integration point.
 * Call after Stripe confirms payment server-side; writes paid=true to players + ledger.
 */
export async function handleStripePayment(playerId, teamId, amount, matchId = null) {
  const paidAt = new Date().toISOString();
  const { error } = await supabase
    .from("players")
    .update({ paid: true, paid_by: 'stripe', paid_at: paidAt })
    .eq("id", playerId);
  if (error) throw error;
  await createLedgerEntry({
    teamId, playerId, matchId: matchId || null, amount: amount || 0,
    type: 'game_fee', status: 'paid', method: 'stripe',
    paidBy: 'stripe', paidAt, note: null,
  });
  return { success: true, paid: true, paidAt };
}

/** Admin confirms a player has paid (e.g. Stripe). Sets paid = true in DB. */
export async function handleMarkPaid(playerId, teamId, matchId = null, amount = 0) {
  const paidAt = new Date().toISOString();
  const { error } = await supabase
    .from("players")
    .update({ paid: true, paid_at: paidAt })
    .eq("id", playerId);
  if (error) throw error;
  const existing = await findMatchLedgerEntry(playerId, teamId, matchId, 'game_fee');
  // Cross-path: if lineup lock now exists but player self-paid earlier (matchId was null then),
  // find that null-matchId entry and promote it rather than creating a duplicate.
  const existingNull = (!existing && matchId)
    ? await findMatchLedgerEntry(playerId, teamId, null, 'game_fee')
    : null;
  if (existing) {
    await updateLedgerEntry(existing.id, { status: 'paid', method: 'admin', paidBy: 'admin', paidAt });
  } else if (existingNull) {
    await updateLedgerEntry(existingNull.id, { status: 'paid', method: 'admin', paidBy: 'admin', paidAt, matchId });
  } else {
    await createLedgerEntry({
      teamId, playerId, matchId: matchId || null, amount: amount || 0,
      type: 'game_fee', status: 'paid', method: 'admin',
      paidBy: 'admin', paidAt, note: null, upsert: true,
    });
  }
  return { paid: true, paidAt };
}

/** Resets all payment flags for a player. */
export async function handleResetPayment(playerId, teamId, matchId = null) {
  const { error } = await supabase
    .from("players")
    .update({ paid: false, self_paid: false, paid_by: null, paid_at: null })
    .eq("id", playerId);
  if (error) throw error;
  // Always reset ledger — findMatchLedgerEntry handles null matchId via IS NULL
  const existing = await findMatchLedgerEntry(playerId, teamId, matchId, 'game_fee');
  if (existing) await updateLedgerEntry(existing.id, { status: 'unpaid', paidAt: null });
  if (matchId) {
    await supabase.from("player_match")
      .update({ paid: false, paid_at: null })
      .eq("match_id", matchId)
      .eq("player_id", playerId);
  }
  return { paid: false, selfPaid: false, paidBy: null, paidAt: null };
}

/** Admin waives a player's debt. Sets owes = 0, creates a waiver ledger entry. */
export async function handleWaiveDebt(playerId, teamId, amount = 0, note = null) {
  const { data: playerData } = await supabase
    .from("players")
    .select("owes")
    .eq("id", playerId)
    .single();
  const owedAmount = amount || playerData?.owes || 0;
  const { error } = await supabase
    .from("players")
    .update({ owes: 0 })
    .eq("id", playerId);
  if (error) throw error;
  await createLedgerEntry({
    teamId, playerId, matchId: null, amount: owedAmount,
    type: 'waiver', status: 'waived', method: 'waived',
    paidBy: 'admin', paidAt: new Date().toISOString(), note: note || null,
  });
  return { owes: 0 };
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
