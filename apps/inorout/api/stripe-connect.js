// POST /api/stripe-connect — venue Stripe Connect onboarding for memberships.
//
// DORMANT until STRIPE_SECRET_KEY is set (returns 503). Authorises the caller by
// venue token (must hold `manage_memberships`), then:
//   action 'onboard' → create the venue's Express connected account if absent +
//                      return a Stripe onboarding URL (account link).
//   action 'refresh' → re-pull the account from Stripe + cache its state.
//
// Money never touches us — the account belongs to the venue. We only orchestrate.
// Live wiring + redirect URLs must be validated under TEST keys first (DECISIONS gate).

const { createClient } = require("@supabase/supabase-js");
const { stripe, isConfigured } = require("./_stripe");

// Mirrors _venue_has_cap (mig 237) for the endpoint-side authorisation gate.
function hasCap(caller, cap) {
  if (!caller) return false;
  if (caller.role === "owner") return true;
  const deny = caller.caps_deny || [];
  const grant = caller.caps_grant || [];
  if (deny.includes(cap)) return false;
  if (grant.includes(cap)) return true;
  return caller.role === "manager";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "stripe_not_configured" });
  }

  const { venueToken, action = "onboard" } = req.body || {};
  if (!venueToken) return res.status(400).json({ error: "missing_token" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // authorise: resolve the venue + capability (service role can call the resolver)
  const { data: rows, error: rErr } = await supabase.rpc("resolve_venue_caller", { p_token: venueToken });
  const caller = Array.isArray(rows) ? rows[0] : rows;
  if (rErr || !caller?.venue_id) return res.status(401).json({ error: "invalid_venue_token" });
  if (!hasCap(caller, "manage_memberships")) return res.status(403).json({ error: "insufficient_role" });
  const venueId = caller.venue_id;

  // current state
  const { data: venue } = await supabase
    .from("venues").select("id, name, contact_email").eq("id", venueId).maybeSingle();
  if (!venue) return res.status(404).json({ error: "venue_not_found" });

  const { data: stripeInt } = await supabase
    .from("venue_integrations").select("account_id").eq("venue_id", venueId).eq("provider", "stripe").maybeSingle();

  const RETURN_URL = process.env.STRIPE_CONNECT_RETURN_URL || "https://platform-venue.vercel.app/?connect=done";
  const REFRESH_URL = process.env.STRIPE_CONNECT_REFRESH_URL || "https://platform-venue.vercel.app/?connect=refresh";

  try {
    let accountId = stripeInt?.account_id ?? null;

    if (action === "refresh") {
      if (!accountId) return res.status(200).json({ ok: true, status: "none" });
      const acct = await stripe.accounts.retrieve(accountId);
      const status = acct.charges_enabled ? "active" : (acct.details_submitted ? "restricted" : "onboarding");
      await supabase.rpc("set_venue_connect_state", {
        p_venue_id: venueId, p_account_id: accountId, p_status: status,
        p_charges_enabled: !!acct.charges_enabled, p_details_submitted: !!acct.details_submitted,
      });
      return res.status(200).json({ ok: true, status, charges_enabled: !!acct.charges_enabled });
    }

    // action 'onboard' — create the account if needed, then an onboarding link
    if (!accountId) {
      const acct = await stripe.accounts.create({
        type: "express",
        email: venue.contact_email || undefined,
        business_profile: { name: venue.name || undefined },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { venue_id: venueId },
      });
      accountId = acct.id;
      await supabase.rpc("set_venue_connect_state", {
        p_venue_id: venueId, p_account_id: accountId, p_status: "onboarding",
        p_charges_enabled: false, p_details_submitted: false,
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: REFRESH_URL,
      return_url: RETURN_URL,
      type: "account_onboarding",
    });
    return res.status(200).json({ ok: true, url: link.url, account_id: accountId });
  } catch (e) {
    console.error("[stripe-connect] failed", action, e?.message);
    return res.status(500).json({ error: "stripe_error", detail: e?.message });
  }
};
