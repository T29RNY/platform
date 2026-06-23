// POST /api/stripe-refund — operator-initiated Stripe refund of a Stripe-collected charge
// (Stripe Phase 5, scope #13 + pro-rated #21).
//
// DORMANT until STRIPE_SECRET_KEY is set (returns 503). TEST keys only until Phase 7.
//
// Today only a manual ledger VOID exists (venue_void_charge) — no money moves. This endpoint
// issues a REAL Stripe refund on the connected account against the original charge. The
// resulting charge.refunded event is ALREADY reconciled into the ledger by stripe_record_refund
// (mig 403, idempotent on the refund id) — so this endpoint NEVER writes the ledger itself;
// it only moves the money. Amounts are recomputed SERVER-SIDE (never trust the client):
//   mode 'full'     → everything still refundable (paid − already-refunded)
//   mode 'prorated' → the unused season slice via _prorated_first_charge (mig 393, member's
//                     favour rounding) — same engine as the joining charge, so the numbers agree
//   mode 'amount'   → an explicit partial, capped at refundable
//
// Auth mirrors stripe-bulk-invoices.js (service-role client → auth.uid() is null, so venue auth
// is re-derived here, not via the venue-token RPCs). venueId is derived from the charge.
// Body: { chargeId, mode: 'full'|'prorated'|'amount', amountPence?, venueToken }
// Returns: { ok, refund_id, amount_pence }

const { createClient } = require("@supabase/supabase-js");
const { stripe, isConfigured } = require("./_stripe");

async function authorizeVenue(supabase, req, venueToken, venueId) {
  // Stage 1: shared venue_admin_token for this venue.
  const { data: byToken } = await supabase
    .from("venues").select("id").eq("id", venueId).eq("venue_admin_token", venueToken).eq("active", true).maybeSingle();
  if (byToken?.id) return true;

  // Stage 2: signed-in venue staff acting on their venue (token slot carries the venue_id).
  if (venueToken !== venueId) return false;
  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return false;
  const { data: { user } = {} } = await supabase.auth.getUser(accessToken);
  if (!user) return false;
  const { data: admin } = await supabase
    .from("venue_admins").select("id, role, caps_grant, caps_deny")
    .eq("user_id", user.id).eq("venue_id", venueId).eq("status", "active").is("revoked_at", null).maybeSingle();
  if (!admin) return false;
  const grant = admin.caps_grant || [];
  const deny  = admin.caps_deny  || [];
  return admin.role === "owner" || (grant.includes("manage_memberships") && !deny.includes("manage_memberships"));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "stripe_not_configured" });
  }

  const { chargeId, mode = "full", amountPence, venueToken } = req.body || {};
  if (!chargeId || !venueToken) return res.status(400).json({ error: "missing_params" });
  if (!["full", "prorated", "amount"].includes(mode)) return res.status(400).json({ error: "invalid_mode" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // The charge → its venue (self-derived) → authorise against THAT venue.
  const { data: charge } = await supabase
    .from("venue_charges").select("id, venue_id, source_type, source_id").eq("id", chargeId).maybeSingle();
  if (!charge) return res.status(404).json({ error: "charge_not_found" });
  if (!(await authorizeVenue(supabase, req, venueToken, charge.venue_id))) {
    return res.status(403).json({ error: "not_authorized" });
  }

  // Server-side amounts. The Stripe charge id = external_ref of the latest non-voided 'stripe'
  // payment; refundable = collected − already-refunded.
  const { data: pays = [] } = await supabase
    .from("venue_payments").select("kind, amount_pence, method, external_ref, voided_at, taken_at")
    .eq("charge_id", chargeId);
  const stripePays = pays
    .filter((p) => p.kind === "payment" && p.method === "stripe" && !p.voided_at)
    .sort((a, b) => new Date(b.taken_at) - new Date(a.taken_at));
  const chargeRef = stripePays[0]?.external_ref || null;
  if (!chargeRef) return res.status(400).json({ error: "no_stripe_payment" });
  const paid     = stripePays.reduce((s, p) => s + (p.amount_pence || 0), 0);
  const refunded = pays.filter((p) => p.kind === "refund").reduce((s, p) => s + (p.amount_pence || 0), 0);
  const refundable = Math.max(paid - refunded, 0);
  if (refundable <= 0) return res.status(400).json({ error: "nothing_refundable" });

  // Resolve the amount for the chosen mode.
  let amount;
  if (mode === "full") {
    amount = refundable;
  } else if (mode === "amount") {
    const req_amt = parseInt(amountPence, 10);
    if (!Number.isFinite(req_amt) || req_amt <= 0) return res.status(400).json({ error: "invalid_amount" });
    amount = Math.min(req_amt, refundable);
  } else {
    // prorated: the unused season slice, via the one proration engine.
    if (charge.source_type !== "membership") return res.status(400).json({ error: "not_proratable" });
    const membershipId = String(charge.source_id).split(":")[0];
    const { data: m } = await supabase
      .from("venue_memberships").select("tier_id, pricing_model").eq("id", membershipId).maybeSingle();
    const { data: tier } = m?.tier_id
      ? await supabase.from("venue_membership_tiers")
          .select("season_start, season_end, proration_basis, pricing_model").eq("id", m.tier_id).maybeSingle()
      : { data: null };
    const isSeason = m && (m.pricing_model === "term" || tier?.pricing_model === "season");
    if (!isSeason || !tier?.season_start || !tier?.season_end) return res.status(400).json({ error: "not_proratable" });
    const { data: unused, error: prErr } = await supabase.rpc("_prorated_first_charge", {
      p_full_pence: refundable, p_basis: tier.proration_basis || "none",
      p_today: new Date().toISOString().slice(0, 10), p_start: tier.season_start, p_end: tier.season_end,
    });
    if (prErr || unused == null) return res.status(400).json({ error: "proration_failed", detail: prErr?.message });
    amount = Math.min(unused, refundable);
    if (amount <= 0) return res.status(400).json({ error: "nothing_to_prorate" });
  }

  // Connected account for this venue.
  const { data: stripeInt } = await supabase
    .from("venue_integrations").select("account_id")
    .eq("venue_id", charge.venue_id).eq("provider", "stripe").eq("status", "connected").maybeSingle();
  if (!stripeInt?.account_id) return res.status(400).json({ error: "stripe_not_connected" });
  const accountId = stripeInt.account_id;

  try {
    // Idempotency keyed on (charge, amount, mode) → a double-tap can't double-refund. The
    // charge.refunded webhook lands it in the ledger (stripe_record_refund), so we don't here.
    const refund = await stripe.refunds.create(
      { charge: chargeRef, amount },
      { stripeAccount: accountId, idempotencyKey: `refund_${chargeId}_${mode}_${amount}` }
    );
    return res.status(200).json({ ok: true, refund_id: refund.id, amount_pence: amount });
  } catch (e) {
    console.error("[stripe-refund] failed", chargeId, e?.message);
    return res.status(500).json({ error: "stripe_error", detail: e?.message });
  }
};
