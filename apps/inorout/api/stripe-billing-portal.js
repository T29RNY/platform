// POST /api/stripe-billing-portal — Stripe Billing Portal session for a signed-in member
// to self-serve their saved card / cancel their subscription (Stripe Phase 5, scope #11).
//
// DORMANT until STRIPE_SECRET_KEY is set (returns 503). TEST keys only until Phase 7.
//
// The member's reused Stripe customer (venue_memberships.stripe_customer_id, one per payer +
// connected account — mig 403) lives on the venue's connected account. We mint a portal session
// for that customer on that account and hand back the hosted URL. A cancel/pause done there fires
// customer.subscription.updated/deleted, which the webhook ALREADY routes to
// apply_membership_subscription_status — so there is no new server state here.
//
// Auth: Authorization: Bearer <supabase access token>. The caller must be the membership's
// member OR its payer (a guardian paying for a child is the payer) — verified server-side.
// Body: { membershipId, returnPath? }   Returns: { portal_url }

const { createClient } = require("@supabase/supabase-js");
const { stripe, isConfigured } = require("./_stripe");

// A connected (Express) account has no default portal configuration, so a bare
// sessions.create errors with "No configuration provided". Reuse an active one if present,
// else create a minimal card-update + cancel config. Idempotent enough (one per account).
async function ensurePortalConfig(accountId) {
  const existing = await stripe.billingPortal.configurations.list(
    { active: true, limit: 1 }, { stripeAccount: accountId }
  );
  if (existing.data[0]) return existing.data[0].id;
  const cfg = await stripe.billingPortal.configurations.create(
    {
      business_profile: { headline: "Manage your membership" },
      features: {
        customer_update:       { enabled: true, allowed_updates: ["email", "address", "phone"] },
        invoice_history:       { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel:   { enabled: true, mode: "at_period_end" },
      },
    },
    { stripeAccount: accountId }
  );
  return cfg.id;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "stripe_not_configured" });
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return res.status(401).json({ error: "missing_token" });

  const { membershipId, returnPath } = req.body || {};
  if (!membershipId) return res.status(400).json({ error: "missing_params" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: "invalid_token" });

  // The caller's member profile.
  const { data: callerProfile } = await supabase
    .from("member_profiles").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!callerProfile) return res.status(400).json({ error: "profile_not_found" });

  // The membership + its reused customer + venue.
  const { data: m } = await supabase
    .from("venue_memberships")
    .select("id, venue_id, member_profile_id, payer_profile_id, stripe_customer_id")
    .eq("id", membershipId).maybeSingle();
  if (!m) return res.status(404).json({ error: "membership_not_found" });

  // Authorise: the caller must be the member or the payer (covers a guardian).
  if (callerProfile.id !== m.member_profile_id && callerProfile.id !== m.payer_profile_id) {
    return res.status(403).json({ error: "not_authorized" });
  }
  if (!m.stripe_customer_id) return res.status(400).json({ error: "no_stripe_customer" });

  // Connected account for this venue.
  const { data: stripeInt } = await supabase
    .from("venue_integrations").select("account_id")
    .eq("venue_id", m.venue_id).eq("provider", "stripe").eq("status", "connected").maybeSingle();
  if (!stripeInt?.account_id) return res.status(400).json({ error: "stripe_not_connected" });
  const accountId = stripeInt.account_id;

  try {
    const appUrl     = process.env.INOROUT_APP_URL || "https://app.in-or-out.com";
    const safePath   = typeof returnPath === "string" && returnPath.startsWith("/") ? returnPath : "/";
    const configId   = await ensurePortalConfig(accountId);
    const session = await stripe.billingPortal.sessions.create(
      { customer: m.stripe_customer_id, configuration: configId, return_url: `${appUrl}${safePath}` },
      { stripeAccount: accountId }
    );
    return res.status(200).json({ portal_url: session.url });
  } catch (e) {
    console.error("[stripe-billing-portal] failed", e?.message);
    return res.status(500).json({ error: "stripe_error", detail: e?.message });
  }
};
