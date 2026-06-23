// POST /api/stripe-bulk-invoices — issue Stripe Invoices for a committed mass-invoicing
// run whose charges are "pay online" (mig 405, Stripe Phase 3).
//
// DORMANT until STRIPE_SECRET_KEY is set (returns 503). TEST keys only until Phase 7.
//
// Flow: venue_bulk_charge_commit (SQL) has already minted one venue_charges row per included
// member. This endpoint creates one Stripe INVOICE per still-unpaid charge on the venue's
// connected account, billed to the PAYER's reused Stripe customer (guardian routes to the
// guardian), with metadata.iorout_charge_id so the invoice.paid webhook reconciles it back
// to that exact ledger charge via stripe_record_charge_payment. Idempotent per (run, charge).
//
// Auth mirrors resolve_venue_caller's two stages:
//   • body.venueToken === venues.venue_admin_token  → shared-token / owner (dev/demo + pilot).
//   • else body.venueToken is a venue_id + Authorization Bearer <jwt> whose uid is an active
//     venue_admins row for that venue (manage_memberships).
// Body: { runId, venueToken }
// Returns: { ok, invoiced, skipped, errors }

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

  const { runId, venueToken } = req.body || {};
  if (!runId || !venueToken) return res.status(400).json({ error: "missing_params" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Resolve the run + its venue.
  const { data: run } = await supabase
    .from("venue_billing_runs").select("id, venue_id, label, pay_online, status").eq("id", runId).maybeSingle();
  if (!run) return res.status(404).json({ error: "run_not_found" });
  if (run.status === "voided") return res.status(400).json({ error: "run_voided" });
  if (!run.pay_online) return res.status(400).json({ error: "run_not_pay_online" });

  if (!(await authorizeVenue(supabase, req, venueToken, run.venue_id))) {
    return res.status(403).json({ error: "not_authorized" });
  }

  // Connected account for this venue.
  const { data: stripeInt } = await supabase
    .from("venue_integrations").select("account_id")
    .eq("venue_id", run.venue_id).eq("provider", "stripe").eq("status", "connected").maybeSingle();
  if (!stripeInt?.account_id) return res.status(400).json({ error: "stripe_not_connected" });
  const accountId = stripeInt.account_id;

  // Still-collectible charges in this run. The membership (and so the payer) is resolved
  // per-row below: source_id is text ('<membership_id>:run:<run_id>'), not a PostgREST FK.
  const { data: rows = [] } = await supabase
    .from("venue_charges").select("id, amount_due_pence, status, source_id")
    .eq("billing_run_id", runId).in("status", ["unpaid", "partial"]);

  const invoiced = [];
  const skipped = [];
  const errors = [];

  for (const c of rows) {
    try {
      const membershipId = String(c.source_id).split(":")[0];
      const { data: m } = await supabase
        .from("venue_memberships").select("payer_profile_id, member_profile_id").eq("id", membershipId).maybeSingle();
      const payerId = m?.payer_profile_id || m?.member_profile_id;
      if (!payerId) { skipped.push({ charge_id: c.id, reason: "no_payer" }); continue; }

      const { data: payer } = await supabase
        .from("member_profiles").select("email, first_name, last_name").eq("id", payerId).maybeSingle();
      const payerName = [payer?.first_name, payer?.last_name].filter(Boolean).join(" ");

      // Reuse the payer's Stripe customer on this account; create + persist if absent.
      let customerId;
      const { data: existing } = await supabase.rpc("get_or_link_stripe_customer", {
        p_payer_profile_id: payerId, p_account_id: accountId, p_venue_id: run.venue_id, p_new_customer_id: null,
      });
      if (existing?.stripe_customer_id) {
        customerId = existing.stripe_customer_id;
      } else {
        const customer = await stripe.customers.create(
          { email: payer?.email || undefined, name: payerName || undefined,
            metadata: { payer_profile_id: payerId, venue_id: run.venue_id } },
          { stripeAccount: accountId }
        );
        const { data: linked } = await supabase.rpc("get_or_link_stripe_customer", {
          p_payer_profile_id: payerId, p_account_id: accountId, p_venue_id: run.venue_id, p_new_customer_id: customer.id,
        });
        customerId = linked?.stripe_customer_id || customer.id;
      }

      const idem = `run_${runId}_charge_${c.id}`;
      // Empty draft invoice (exclude unrelated pending items), then a single line, then finalize.
      const invoice = await stripe.invoices.create(
        { customer: customerId, collection_method: "send_invoice", days_until_due: 14,
          auto_advance: false, pending_invoice_items_behavior: "exclude",
          metadata: { iorout_charge_id: c.id, iorout_run_id: runId } },
        { stripeAccount: accountId, idempotencyKey: `${idem}_inv` }
      );
      await stripe.invoiceItems.create(
        { customer: customerId, invoice: invoice.id, amount: c.amount_due_pence, currency: "gbp",
          description: run.label },
        { stripeAccount: accountId, idempotencyKey: `${idem}_item` }
      );
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id, { stripeAccount: accountId });
      await stripe.invoices.sendInvoice(invoice.id, { stripeAccount: accountId });
      // Phase 6 #16: persist the Stripe hosted-invoice URL on the ledger charge so the #4
      // chase reminder + the member's in-app "My money" pill can offer a Pay-now link.
      // (This charge then drops out of the cron payment_due reminder — Stripe dunns it.)
      if (finalized?.hosted_invoice_url) {
        await supabase.rpc("stripe_set_charge_pay_url", {
          p_charge_id: c.id, p_pay_url: finalized.hosted_invoice_url,
        });
      }
      invoiced.push({ charge_id: c.id, invoice_id: invoice.id });
    } catch (e) {
      console.error("[stripe-bulk-invoices] charge failed", c.id, e?.message);
      errors.push({ charge_id: c.id, error: e?.message });
    }
  }

  return res.status(200).json({ ok: true, invoiced: invoiced.length, skipped, errors, details: invoiced });
};
