// POST /api/stripe-webhook — Stripe Connect webhook for the membership money flow.
//
// DORMANT until STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET are set (returns 503).
// Resilience model (plan Phase 7 §resilience):
//   1. Verify the signature against the RAW body (bodyParser disabled below).
//   2. record_stripe_event — PERSIST-THEN-PROCESS, idempotent on the event id
//      (UNIQUE billing_events.stripe_event_id). A replay returns inserted=false
//      and we early-out if it was already processed.
//   3. Fetch-fresh: re-retrieve the object from Stripe rather than trusting the
//      payload (defends against out-of-order / stale webhooks).
//   4. Act via the SECURITY DEFINER state-machine RPCs.
//   5. mark_stripe_event_processed (processed | failed | ignored). Transient
//      errors return 500 so Stripe retries; truly unprocessable events are marked
//      and 200'd so Stripe stops hammering. The reconciliation cron is the net.
//
// NOTE: end-to-end signature verification + event shapes MUST be validated under
// Stripe TEST keys + a test clock before any live key (see DECISIONS money-flow gate).

const { createClient } = require("@supabase/supabase-js");
const { stripe, isConfigured, constructEvent } = require("./_stripe");

// Vercel must NOT pre-parse the body — signature verification needs the raw bytes.
module.exports.config = { api: { bodyParser: false } };

async function readRawBody(req) {
  // If a framework already buffered it, prefer that; else read the stream.
  if (req.body && (Buffer.isBuffer(req.body) || typeof req.body === "string")) {
    return Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "stripe_not_configured" });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. verify signature
  let event;
  try {
    const raw = await readRawBody(req);
    event = constructEvent(raw, req.headers["stripe-signature"]);
  } catch (e) {
    console.error("[stripe-webhook] signature verify failed", e?.message);
    return res.status(400).json({ error: "bad_signature" });
  }

  // 2. persist-then-process + idempotency
  const accountId = event.account || null; // Connect events carry the connected account
  const entityId = accountId || "platform";
  const amount = event?.data?.object?.amount_paid ?? event?.data?.object?.amount ?? null;
  let rec;
  try {
    const { data, error } = await supabase.rpc("record_stripe_event", {
      p_stripe_event_id: event.id,
      p_entity_type: "membership",
      p_entity_id: entityId,
      p_event_type: event.type,
      p_amount_pence: amount,
      p_payload: event,
    });
    if (error) throw error;
    rec = data;
  } catch (e) {
    console.error("[stripe-webhook] record_stripe_event failed", e?.message);
    return res.status(500).json({ error: "record_failed" }); // transient → let Stripe retry
  }
  if (!rec?.inserted && rec?.status === "processed") {
    return res.status(200).json({ ok: true, deduped: true }); // already handled
  }

  // 3 + 4. fetch-fresh + act
  try {
    await dispatch(event, accountId, supabase);
    await supabase.rpc("mark_stripe_event_processed", { p_stripe_event_id: event.id, p_status: "processed", p_note: event.type });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[stripe-webhook] dispatch failed", event.type, e?.message);
    // transient vs terminal is hard to tell here; mark failed + 500 so Stripe retries.
    // The reconciliation cron repairs anything that stays failed.
    await supabase.rpc("mark_stripe_event_processed", { p_stripe_event_id: event.id, p_status: "failed", p_note: e?.message || "dispatch_error" }).catch(() => {});
    return res.status(500).json({ error: "dispatch_failed" });
  }
};

// Route an event to the right state-machine RPC. Subscription events re-fetch the
// subscription from Stripe (fetch-fresh) before applying its status.
async function dispatch(event, accountId, supabase) {
  const obj = event.data?.object || {};
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const fresh = await stripe.subscriptions.retrieve(obj.id, accountId ? { stripeAccount: accountId } : undefined);
      await supabase.rpc("apply_membership_subscription_status", { p_subscription_id: fresh.id, p_stripe_status: fresh.status });
      break;
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      if (obj.subscription) {
        const fresh = await stripe.subscriptions.retrieve(obj.subscription, accountId ? { stripeAccount: accountId } : undefined);
        await supabase.rpc("apply_membership_subscription_status", { p_subscription_id: fresh.id, p_stripe_status: fresh.status });
      }
      // On a PAID subscription invoice, record the payment into the venue ledger. The
      // renewal cron skips Stripe subs (mig 403), so this is the sole ledger source for a
      // Stripe member's recurring payments — nothing is silently lost. Idempotent per invoice.
      if (event.type === "invoice.paid" && obj.subscription) {
        const inv = await stripe.invoices.retrieve(obj.id, accountId ? { stripeAccount: accountId } : undefined);
        await supabase.rpc("stripe_record_invoice_payment", {
          p_subscription_id: inv.subscription,
          p_invoice_id:      inv.id,
          p_charge_ref:      inv.charge || null,
          p_amount_pence:    inv.amount_paid ?? null,
          p_paid_at:         inv.status_transitions?.paid_at
                               ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
                               : new Date().toISOString(),
        });
      }
      // A one-off mass-invoicing Invoice (mig 405) has no subscription; it carries the ledger
      // charge id in metadata.iorout_charge_id. Reconcile it against that pre-existing charge
      // (stripe_record_invoice_payment is subscription-keyed and can't match this one).
      if (event.type === "invoice.paid" && !obj.subscription) {
        const inv = await stripe.invoices.retrieve(obj.id, accountId ? { stripeAccount: accountId } : undefined);
        const chargeId = inv.metadata?.iorout_charge_id || null;
        if (chargeId) {
          await supabase.rpc("stripe_record_charge_payment", {
            p_charge_id:    chargeId,
            p_invoice_id:   inv.id,
            p_charge_ref:   inv.charge || null,
            p_amount_pence: inv.amount_paid ?? null,
            p_paid_at:      inv.status_transitions?.paid_at
                              ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
                              : new Date().toISOString(),
          });
        }
      }
      break;
    }
    case "charge.refunded": {
      // Mirror the refund into the ledger against the original 'stripe' payment (found by
      // charge id). One ledger 'refund' row per Stripe refund, idempotent on the refund id —
      // so partials and charge.refunded re-fires are safe.
      const ch = await stripe.charges.retrieve(obj.id, { expand: ["refunds"] }, accountId ? { stripeAccount: accountId } : undefined);
      for (const r of (ch.refunds?.data || [])) {
        await supabase.rpc("stripe_record_refund", {
          p_charge_ref:   ch.id,
          p_amount_pence: r.amount ?? null,
          p_refund_id:    r.id,
        });
      }
      break;
    }
    case "checkout.session.completed": {
      const meta = obj.metadata || {};
      const { invite_code, tier_id, period, member_profile_id, payer_profile_id, amount_pence } = meta;
      // Only process sessions we originated (membership checkout has these keys)
      if (!invite_code || !tier_id || !period || !member_profile_id) break;
      const subscriptionId = obj.subscription || null;
      const customerId     = obj.customer     || null;
      // For subscription sessions, fetch the subscription to get the price_id
      let stripePriceId = null;
      if (subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(
          subscriptionId,
          accountId ? { stripeAccount: accountId } : undefined
        );
        stripePriceId = sub.items?.data?.[0]?.price?.id || null;
      }
      await supabase.rpc("stripe_complete_member_enrolment", {
        p_invite_code:        invite_code,
        p_subscription_id:    subscriptionId,
        p_stripe_customer_id: customerId,
        p_stripe_price_id:    stripePriceId,
        p_tier_id:            tier_id,
        p_period:             period,
        p_member_profile_id:  member_profile_id,
        p_amount_pence:       amount_pence ? parseInt(amount_pence, 10) : null,
        p_payer_profile_id:   payer_profile_id || null,
      });
      break;
    }
    case "account.updated": {
      const acct = await stripe.accounts.retrieve(obj.id);
      const status = acct.charges_enabled ? "active" : (acct.details_submitted ? "restricted" : "onboarding");
      // Resolve the venue that owns this connected account via venue_integrations.
      const { data: vrow } = await supabase
        .from("venue_integrations").select("venue_id").eq("provider", "stripe").eq("account_id", acct.id).limit(1).maybeSingle();
      if (vrow?.venue_id) {
        await supabase.rpc("set_venue_connect_state", {
          p_venue_id: vrow.venue_id,
          p_account_id: acct.id,
          p_status: status,
          p_charges_enabled: !!acct.charges_enabled,
          p_details_submitted: !!acct.details_submitted,
        });
      }
      break;
    }
    default:
      // Not a membership-relevant event — record-only, mark ignored upstream.
      break;
  }
}
