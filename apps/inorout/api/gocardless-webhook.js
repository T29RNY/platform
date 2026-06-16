// /api/gocardless-webhook — GoCardless event handler (persist-then-process).
//
// DORMANT until GC_WEBHOOK_SECRET is set (returns 503).
// GoCardless sends batched events as JSON. We:
//   1. Verify signature (HMAC-SHA256)
//   2. For each event: record_gc_event (idempotent INSERT ON CONFLICT DO NOTHING)
//   3. Dispatch to apply_gc_payment_status for relevant event types
//   4. Mark each event processed or failed
//
// This handler must return 200 quickly — GC retries on non-2xx.
// Service role key required to call server-side RPCs.

const { createClient } = require("@supabase/supabase-js");
const { isWebhookConfigured, verifyWebhookSignature } = require("./_gocardless");

// Event types that drive payment_state transitions via apply_gc_payment_status
const PAYMENT_STATE_EVENTS = new Set([
  "payments.confirmed",
  "payments.paid_out",
  "payments.failed",
  "payments.charged_back",
  "mandates.cancelled",
  "mandates.expired",
  "mandates.failed",
]);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  if (!isWebhookConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "gc_not_configured" });
  }

  const signature = req.headers["webhook-signature"];
  if (!signature) return res.status(401).json({ error: "missing_signature" });

  let events;
  try {
    // rawBody is available when Vercel is configured with body-parser disabled for this route.
    // req.body is the parsed object (fallback when raw not available).
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    events = verifyWebhookSignature(rawBody, signature);
  } catch (e) {
    console.error("[gocardless-webhook] signature verification failed", e?.message);
    return res.status(401).json({ error: "invalid_signature" });
  }

  if (!Array.isArray(events) || events.length === 0) {
    return res.status(200).json({ ok: true, processed: 0 });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let processed = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const event of events) {
    const gcEventId  = event.id;
    const eventType  = `${event.resource_type}.${event.action}`; // e.g. "payments.confirmed"
    const entityType = event.resource_type;
    const entityId   = event.links?.[event.resource_type.slice(0, -1)] // "payments" → "payment"
                    || event.links?.[event.resource_type]
                    || null;
    const amountPence = event.details?.amount ?? null;

    try {
      // Step 1: persist (idempotent — returns inserted:false if duplicate)
      const { data: recorded, error: recErr } = await supabase.rpc("record_gc_event", {
        p_gc_event_id: gcEventId,
        p_entity_type: entityType,
        p_entity_id:   entityId,
        p_event_type:  eventType,
        p_amount_pence:amountPence,
        p_payload:     event,
      });

      if (recErr) {
        console.error("[gocardless-webhook] record_gc_event error", gcEventId, recErr.message);
        failed++;
        continue;
      }

      if (!recorded?.inserted) {
        // Duplicate — already processed in a prior delivery
        skipped++;
        continue;
      }

      // Step 2: dispatch state transition for relevant event types
      if (PAYMENT_STATE_EVENTS.has(eventType)) {
        // We need the mandate_id for this entity.
        // For mandate events the entity IS the mandate. For payment events we look it up.
        let mandateId = null;

        if (entityType === "mandates") {
          mandateId = entityId;
        } else if (entityType === "payments") {
          // Resolve via payments table if we have it, or from event links
          mandateId = event.links?.mandate || null;
        }

        if (mandateId) {
          const { error: stateErr } = await supabase.rpc("apply_gc_payment_status", {
            p_mandate_id:     mandateId,
            p_gc_event_type:  eventType,
          });

          if (stateErr) {
            console.error("[gocardless-webhook] apply_gc_payment_status error", gcEventId, stateErr.message);
            await supabase.rpc("mark_gc_event_processed", {
              p_gc_event_id: gcEventId,
              p_status:      "failed",
              p_note:        stateErr.message,
            });
            failed++;
            continue;
          }
        }
      }

      // Step 3: mark processed
      await supabase.rpc("mark_gc_event_processed", {
        p_gc_event_id: gcEventId,
        p_status:      "processed",
        p_note:        null,
      });

      processed++;
    } catch (e) {
      console.error("[gocardless-webhook] unhandled error for event", gcEventId, e?.message);
      // Attempt to mark failed — best effort, don't throw
      try {
        await supabase.rpc("mark_gc_event_processed", {
          p_gc_event_id: gcEventId,
          p_status:      "failed",
          p_note:        e?.message,
        });
      } catch (_) { /* ignore */ }
      failed++;
    }
  }

  // Always 200 — GC stops retrying on 2xx regardless of individual event failures
  return res.status(200).json({ ok: true, processed, skipped, failed });
};
