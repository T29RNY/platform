// /api/_stripe.js — Stripe Connect helper for the membership money flow (Phase 7).
//
// DORMANT until env is set. Loads safely with the SDK absent or keys unset, so
// importing it from cron.js / webhook never crashes the handler. Money flows
// member → the venue's OWN connected account; we orchestrate via the platform
// secret key + the `stripeAccount` request option. We never custody funds.
//
// Required env (none present yet — operator provides at go-live):
//   STRIPE_SECRET_KEY       — platform secret (sk_test_… first, sk_live_… last)
//   STRIPE_WEBHOOK_SECRET   — webhook signing secret (whsec_…)
//   STRIPE_CONNECT_RETURN_URL / STRIPE_CONNECT_REFRESH_URL — onboarding redirects

let Stripe = null;
try { Stripe = require("stripe"); } catch (e) { /* sdk not installed yet */ }

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Single shared client (null until both the SDK and key exist).
const stripe = SECRET_KEY && Stripe ? new Stripe(SECRET_KEY, { apiVersion: "2024-06-20" }) : null;

function isConfigured() {
  return !!stripe;
}

// Verify a webhook signature against the raw body. Returns the parsed event or
// throws. Caller must pass the RAW request body (Buffer/string), never the parsed
// JSON — signature verification depends on the exact bytes.
function constructEvent(rawBody, signatureHeader) {
  if (!stripe) throw new Error("stripe_not_configured");
  if (!WEBHOOK_SECRET) throw new Error("webhook_secret_unset");
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, WEBHOOK_SECRET);
}

module.exports = { stripe, isConfigured, constructEvent, WEBHOOK_SECRET, SECRET_KEY };
