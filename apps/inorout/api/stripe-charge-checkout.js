// POST /api/stripe-charge-checkout — member-initiated "Pay now" for ONE outstanding
// venue_charges row (membership OR class). Mints (or reuses) a Stripe hosted Invoice on
// the venue's connected account, billed to the PAYER's reused Stripe customer, returns its
// hosted_invoice_url. The client opens that URL.
//
// This deliberately reuses the EXACT mechanism stripe-bulk-invoices.js uses per charge, so:
//   • reconciliation = the existing invoice.paid webhook branch → stripe_record_charge_payment
//     (writes venue_payments) — NO new webhook branch, NO new reconcile RPC;
//   • the payment lands in the same desktop finance ledger (PaymentsView / CustomersView);
//   • the URL is persisted via stripe_set_charge_pay_url so get_my_money surfaces it too.
//
// DORMANT until STRIPE_SECRET_KEY is set (returns 503). TEST keys only until Phase 7.
//
// Auth: Authorization: Bearer <supabase access token>. The caller must be the charge's
// member, its payer, OR (for a child's charge) an accepted guardian of the member.
// Body: { chargeId }   Returns: { pay_url }

const { createClient } = require("@supabase/supabase-js");
const { stripe, isConfigured } = require("./_stripe");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "stripe_not_configured" });
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return res.status(401).json({ error: "missing_token" });

  const { chargeId } = req.body || {};
  if (!chargeId) return res.status(400).json({ error: "missing_params" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: "invalid_token" });

  // Caller's member profile.
  const { data: caller } = await supabase
    .from("member_profiles").select("id, email, first_name, last_name").eq("auth_user_id", user.id).maybeSingle();
  if (!caller) return res.status(400).json({ error: "profile_not_found" });

  // The charge.
  const { data: charge } = await supabase
    .from("venue_charges")
    .select("id, venue_id, source_type, source_id, amount_due_pence, status, pay_url")
    .eq("id", chargeId).maybeSingle();
  if (!charge) return res.status(404).json({ error: "charge_not_found" });
  if (!["unpaid", "partial"].includes(charge.status)) {
    return res.status(400).json({ error: "charge_not_payable", status: charge.status });
  }

  // Resolve the charge's MEMBER (who it's for) + a human-readable label, per source type.
  let memberProfileId = null;
  let label = "Payment due";
  if (charge.source_type === "membership") {
    const membershipId = String(charge.source_id).split(":")[0];
    const { data: m } = await supabase
      .from("venue_memberships").select("member_profile_id, payer_profile_id").eq("id", membershipId).maybeSingle();
    if (!m) return res.status(404).json({ error: "membership_not_found" });
    memberProfileId = m.member_profile_id;
    // Authorise: caller is the member or the payer.
    if (caller.id !== m.member_profile_id && caller.id !== m.payer_profile_id) {
      // else allow if caller is an accepted guardian of the member (checked below)
    }
    label = "Membership payment";
  } else if (charge.source_type === "class") {
    const { data: bk } = await supabase
      .from("venue_class_bookings")
      .select("member_profile_id, session_id").eq("id", charge.source_id).maybeSingle();
    if (!bk) return res.status(404).json({ error: "booking_not_found" });
    memberProfileId = bk.member_profile_id;
    const { data: sess } = await supabase
      .from("venue_class_sessions").select("class_type_id").eq("id", bk.session_id).maybeSingle();
    if (sess?.class_type_id) {
      const { data: ct } = await supabase
        .from("venue_class_types").select("name").eq("id", sess.class_type_id).maybeSingle();
      if (ct?.name) label = ct.name;
    }
  } else {
    return res.status(400).json({ error: "unsupported_charge_type", source_type: charge.source_type });
  }

  // Authorisation: caller is the member, or an accepted guardian of the member.
  let authorised = caller.id === memberProfileId;
  if (!authorised && charge.source_type === "membership") {
    const membershipId = String(charge.source_id).split(":")[0];
    const { data: m } = await supabase
      .from("venue_memberships").select("payer_profile_id").eq("id", membershipId).maybeSingle();
    if (m?.payer_profile_id === caller.id) authorised = true;
  }
  if (!authorised && memberProfileId) {
    const { data: g } = await supabase
      .from("member_guardians").select("id")
      .eq("guardian_profile_id", caller.id).eq("child_profile_id", memberProfileId)
      .eq("invite_state", "accepted").maybeSingle();
    if (g) authorised = true;
  }
  if (!authorised) return res.status(403).json({ error: "not_authorized" });

  // Already has a live hosted invoice → reuse it (idempotent, no duplicate invoice).
  if (charge.pay_url) return res.status(200).json({ pay_url: charge.pay_url });

  // Connected account for this venue.
  const { data: stripeInt } = await supabase
    .from("venue_integrations").select("account_id")
    .eq("venue_id", charge.venue_id).eq("provider", "stripe").eq("status", "connected").maybeSingle();
  if (!stripeInt?.account_id) return res.status(400).json({ error: "stripe_not_connected" });
  const accountId = stripeInt.account_id;

  try {
    // The PAYER is the signed-in caller (a guardian paying for a child is the payer), so the
    // saved card / billing email belong to them. Reuse their customer on this account.
    const payerName = [caller.first_name, caller.last_name].filter(Boolean).join(" ");
    let customerId;
    const { data: existing } = await supabase.rpc("get_or_link_stripe_customer", {
      p_payer_profile_id: caller.id, p_account_id: accountId, p_venue_id: charge.venue_id, p_new_customer_id: null,
    });
    if (existing?.stripe_customer_id) {
      customerId = existing.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create(
        { email: caller.email || undefined, name: payerName || undefined,
          metadata: { payer_profile_id: caller.id, venue_id: charge.venue_id } },
        { stripeAccount: accountId }
      );
      const { data: linked } = await supabase.rpc("get_or_link_stripe_customer", {
        p_payer_profile_id: caller.id, p_account_id: accountId, p_venue_id: charge.venue_id, p_new_customer_id: customer.id,
      });
      customerId = linked?.stripe_customer_id || customer.id;
    }

    const idem = `charge_${charge.id}`;
    // Empty draft invoice (exclude unrelated pending items), then one line, then finalize + send.
    const invoice = await stripe.invoices.create(
      { customer: customerId, collection_method: "send_invoice", days_until_due: 14,
        auto_advance: false, pending_invoice_items_behavior: "exclude",
        metadata: { iorout_charge_id: charge.id } },
      { stripeAccount: accountId, idempotencyKey: `${idem}_inv` }
    );
    await stripe.invoiceItems.create(
      { customer: customerId, invoice: invoice.id, amount: charge.amount_due_pence, currency: "gbp",
        description: label },
      { stripeAccount: accountId, idempotencyKey: `${idem}_item` }
    );
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, { stripeAccount: accountId });
    await stripe.invoices.sendInvoice(invoice.id, { stripeAccount: accountId });

    const payUrl = finalized?.hosted_invoice_url || null;
    if (payUrl) {
      await supabase.rpc("stripe_set_charge_pay_url", { p_charge_id: charge.id, p_pay_url: payUrl });
    }
    if (!payUrl) return res.status(500).json({ error: "no_pay_url" });
    return res.status(200).json({ pay_url: payUrl });
  } catch (e) {
    console.error("[stripe-charge-checkout] failed", e?.message);
    return res.status(500).json({ error: "stripe_error", detail: e?.message });
  }
};
