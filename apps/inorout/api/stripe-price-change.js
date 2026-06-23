// POST /api/stripe-price-change — push a new recurring price onto Stripe subscription members
// after a bulk price change (Stripe Phase 5, scope #12 + pro-rated #20).
//
// DORMANT until STRIPE_SECRET_KEY is set (returns 503). TEST keys only until Phase 7.
//
// Flow: the client first calls venue_bulk_price_change_commit (mig 407), which updates the CASH
// members' ledger amount and returns the Stripe sub members as stripe_targets. The client passes
// those membership ids here. For each, we create a NEW Stripe Price (Prices are immutable) for
// the new amount — reusing the sub's existing product + billing interval — and swap the
// subscription's item to it.
//
// OPERATOR DECISION (session 186, "Option A"): a price change applies at the NEXT renewal, never
// a surprise mid-cycle top-up (member's favour). So proration_behavior:'none' — no Stripe
// mid-cycle proration. On success we sync our record via stripe_set_membership_price so
// amount_pence + stripe_price_id never run ahead of Stripe.
//
// Season-schedule members (stripe_schedule_id set) are NOT in scope this phase and are skipped
// defensively even if passed.
//
// Auth mirrors stripe-bulk-invoices.js (service-role client; venue auth re-derived here). venueId
// is derived from the memberships (all must share one venue).
// Body: { membershipIds: uuid[], newPricePence, venueToken }
// Returns: { ok, pushed, skipped, errors }

const { createClient } = require("@supabase/supabase-js");
const { stripe, isConfigured } = require("./_stripe");

async function authorizeVenue(supabase, req, venueToken, venueId) {
  const { data: byToken } = await supabase
    .from("venues").select("id").eq("id", venueId).eq("venue_admin_token", venueToken).eq("active", true).maybeSingle();
  if (byToken?.id) return true;
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

  const { membershipIds, newPricePence, venueToken } = req.body || {};
  if (!Array.isArray(membershipIds) || !membershipIds.length || !venueToken) {
    return res.status(400).json({ error: "missing_params" });
  }
  const newPrice = parseInt(newPricePence, 10);
  if (!Number.isFinite(newPrice) || newPrice < 0) return res.status(400).json({ error: "invalid_amount" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Resolve the memberships server-side; they must all belong to one venue (no cross-venue mix).
  const { data: rows = [] } = await supabase
    .from("venue_memberships")
    .select("id, venue_id, stripe_subscription_id, stripe_schedule_id")
    .in("id", membershipIds);
  if (!rows.length) return res.status(404).json({ error: "no_memberships" });
  const venueId = rows[0].venue_id;
  if (rows.some((r) => r.venue_id !== venueId)) return res.status(400).json({ error: "mixed_venue" });

  if (!(await authorizeVenue(supabase, req, venueToken, venueId))) {
    return res.status(403).json({ error: "not_authorized" });
  }

  const { data: stripeInt } = await supabase
    .from("venue_integrations").select("account_id")
    .eq("venue_id", venueId).eq("provider", "stripe").eq("status", "connected").maybeSingle();
  if (!stripeInt?.account_id) return res.status(400).json({ error: "stripe_not_connected" });
  const accountId = stripeInt.account_id;

  const pushed = [];
  const skipped = [];
  const errors = [];

  for (const m of rows) {
    if (!m.stripe_subscription_id || m.stripe_schedule_id) {
      skipped.push({ membership_id: m.id, reason: m.stripe_schedule_id ? "season_schedule" : "no_subscription" });
      continue;
    }
    try {
      const sub = await stripe.subscriptions.retrieve(m.stripe_subscription_id, { stripeAccount: accountId });
      const item = sub.items?.data?.[0];
      if (!item) { errors.push({ membership_id: m.id, error: "no_sub_item" }); continue; }

      // Reuse the existing price's product + interval; only the amount changes.
      const cur = await stripe.prices.retrieve(item.price.id, { stripeAccount: accountId });
      const newStripePrice = await stripe.prices.create(
        {
          currency: "gbp",
          unit_amount: newPrice,
          recurring: { interval: cur.recurring.interval, interval_count: cur.recurring.interval_count || 1 },
          product: cur.product,
        },
        { stripeAccount: accountId, idempotencyKey: `price_${m.id}_${newPrice}` }
      );

      // Apply at next renewal — no mid-cycle proration (Option A, member's favour).
      await stripe.subscriptions.update(
        m.stripe_subscription_id,
        { items: [{ id: item.id, price: newStripePrice.id }], proration_behavior: "none" },
        { stripeAccount: accountId, idempotencyKey: `subprice_${m.id}_${newPrice}` }
      );

      // Sync our record only now Stripe has accepted it.
      await supabase.rpc("stripe_set_membership_price", {
        p_membership_id: m.id, p_amount_pence: newPrice, p_stripe_price_id: newStripePrice.id,
      });
      pushed.push({ membership_id: m.id, price_id: newStripePrice.id });
    } catch (e) {
      console.error("[stripe-price-change] member failed", m.id, e?.message);
      errors.push({ membership_id: m.id, error: e?.message });
    }
  }

  return res.status(200).json({ ok: true, pushed: pushed.length, skipped, errors, details: pushed });
};
