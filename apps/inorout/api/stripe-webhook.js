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
      break;
    }
    case "account.updated": {
      const acct = await stripe.accounts.retrieve(obj.id);
      const status = acct.charges_enabled ? "active" : (acct.details_submitted ? "restricted" : "onboarding");
      // Resolve the venue that owns this connected account (service role bypasses RLS).
      const { data: vrow } = await supabase
        .from("venues").select("id").eq("stripe_connect_account_id", acct.id).limit(1).maybeSingle();
      if (vrow?.id) {
        await supabase.rpc("set_venue_connect_state", {
          p_venue_id: vrow.id,
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
