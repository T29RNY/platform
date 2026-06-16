// /api/_gocardless.js — GoCardless for Platforms helper (Phases 5–8).
//
// DORMANT until env is set. Loads safely with the SDK absent or keys unset.
// Each venue has their OWN access token stored in venue_integrations.access_token —
// we never hold funds; money flows member → venue's own GC account.
//
// Required env (operator provides at go-live):
//   GC_CLIENT_ID       — Partner OAuth client ID
//   GC_CLIENT_SECRET   — Partner OAuth client secret
//   GC_WEBHOOK_SECRET  — Webhook endpoint signing secret
//   GC_ENVIRONMENT     — 'sandbox' or 'live' (default: 'sandbox')

const crypto = require("crypto");

const GC_CLIENT_ID     = process.env.GC_CLIENT_ID;
const GC_CLIENT_SECRET = process.env.GC_CLIENT_SECRET;
const WEBHOOK_SECRET   = process.env.GC_WEBHOOK_SECRET;
const GC_ENV           = process.env.GC_ENVIRONMENT || "sandbox";

const GC_BASE = GC_ENV === "live"
  ? "https://api.gocardless.com"
  : "https://api-sandbox.gocardless.com";

const GC_OAUTH_BASE = "https://connect.gocardless.com";

function isGcConfigured() {
  return !!(GC_CLIENT_ID && GC_CLIENT_SECRET);
}

function isWebhookConfigured() {
  return !!WEBHOOK_SECRET;
}

// Build a GoCardless API client scoped to a venue's access token.
// Returns an object with get/post helpers that set the correct headers.
function gcClient(accessToken) {
  async function request(method, path, body) {
    const res = await fetch(`${GC_BASE}${path}`, {
      method,
      headers: {
        "Authorization":     `Bearer ${accessToken}`,
        "GoCardless-Version": "2015-07-06",
        "Content-Type":      "application/json",
        "Accept":            "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || `gc_api_error_${res.status}`;
      throw new Error(msg);
    }
    return json;
  }
  return {
    get:  (path)        => request("GET",  path),
    post: (path, body)  => request("POST", path, body),
  };
}

// Build the OAuth authorisation URL to redirect the venue admin to.
function buildOAuthUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id:    GC_CLIENT_ID,
    redirect_uri: redirectUri,
    scope:        "read_write",
    response_type:"code",
    state,
  });
  return `${GC_OAUTH_BASE}/oauth/authorize?${params}`;
}

// Exchange an OAuth code for a venue access token.
// Returns { access_token, organisation_id }.
async function exchangeOAuthCode(code, redirectUri) {
  const res = await fetch(`${GC_OAUTH_BASE}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     GC_CLIENT_ID,
      client_secret: GC_CLIENT_SECRET,
      code,
      grant_type:    "authorization_code",
      redirect_uri:  redirectUri,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || "gc_oauth_exchange_failed");
  return { access_token: json.access_token, organisation_id: json.organisation_id };
}

// Verify a GoCardless webhook signature.
// GC uses HMAC-SHA256 of the raw body with the webhook secret.
// Returns the parsed events array or throws on bad signature.
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) throw new Error("gc_webhook_secret_unset");
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  if (signatureHeader !== expected) throw new Error("gc_webhook_signature_mismatch");
  const payload = JSON.parse(rawBody.toString());
  return payload.events || [];
}

module.exports = {
  isGcConfigured,
  isWebhookConfigured,
  gcClient,
  buildOAuthUrl,
  exchangeOAuthCode,
  verifyWebhookSignature,
  GC_ENV,
};
