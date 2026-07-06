// POST /api/stripe-connect — venue Stripe Connect onboarding for memberships.
//
// Called cross-origin from apps/venue (platform-venue.vercel.app). CORS is locked
// to that origin via STRIPE_CONNECT_ALLOWED_ORIGIN env var.
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

const CORS_ORIGIN = process.env.STRIPE_CONNECT_ALLOWED_ORIGIN || "https://platform-venue.vercel.app";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

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
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "stripe_not_configured" });
  }

  const { venueToken, action = "onboard", surface = "integrations" } = req.body || {};
  if (!venueToken) return res.status(400).json({ error: "missing_token" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Authorise — two paths (a service-role client can't populate auth.uid(), so
  // resolve_venue_caller Stage-1b never fires here; that's the self-serve blocker):
  //   (A) Self-serve owner: an `Authorization: Bearer <jwt>` is present. Verify the
  //       JWT (getUser — the same pattern as stripe-member-checkout), then look up
  //       their venue_admins row for venueToken (= the venue_id). This IS Stage-1b,
  //       done endpoint-side with the trusted uid.
  //   (B) Legacy shared master token: no JWT → resolve_venue_caller(venueToken)
  //       matches the venue_admin_token (Stage-1a). Keeps existing venues working.
  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  let caller = null;
  if (accessToken) {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
    if (authErr || !user) return res.status(401).json({ error: "invalid_token" });
    const { data: adminRow } = await supabase
      .from("venue_admins")
      .select("role, caps_grant, caps_deny")
      .eq("user_id", user.id).eq("venue_id", venueToken)
      .eq("status", "active").is("revoked_at", null).maybeSingle();
    if (adminRow) {
      caller = { venue_id: venueToken, role: adminRow.role, caps_grant: adminRow.caps_grant, caps_deny: adminRow.caps_deny };
    }
  }
  if (!caller) {
    const { data: rows } = await supabase.rpc("resolve_venue_caller", { p_token: venueToken });
    const c = Array.isArray(rows) ? rows[0] : rows;
    if (c?.venue_id) caller = c;
  }
  if (!caller?.venue_id) return res.status(401).json({ error: "invalid_venue_token" });
  if (!hasCap(caller, "manage_memberships")) return res.status(403).json({ error: "insufficient_role" });
  const venueId = caller.venue_id;

  // current state
  const { data: venue } = await supabase
    .from("venues").select("id, name, contact_email").eq("id", venueId).maybeSingle();
  if (!venue) return res.status(404).json({ error: "venue_not_found" });

  const { data: stripeInt } = await supabase
    .from("venue_integrations").select("account_id").eq("venue_id", venueId).eq("provider", "stripe").maybeSingle();

  // Return/refresh URLs are SERVER-constructed from a known origin + a validated
  // `surface` (never a client-supplied URL — no open-redirect). The setup-hub
  // surface lands the owner back on the hub (?setup=1); integrations keeps the
  // existing default so the venue-console flow is unchanged.
  const ORIGIN = (() => {
    try { return new URL(process.env.STRIPE_CONNECT_RETURN_URL || "https://platform-venue.vercel.app").origin; }
    catch { return "https://platform-venue.vercel.app"; }
  })();
  const RETURN_URL = surface === "setup"
    ? `${ORIGIN}/?setup=1&connect=done`
    : (process.env.STRIPE_CONNECT_RETURN_URL || `${ORIGIN}/?connect=done`);
  const REFRESH_URL = surface === "setup"
    ? `${ORIGIN}/?setup=1&connect=refresh`
    : (process.env.STRIPE_CONNECT_REFRESH_URL || `${ORIGIN}/?connect=refresh`);

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
      // Stripe account links are single-use + expire in minutes; if the owner isn't
      // done, re-mint one so they can resume onboarding (this is exactly what the
      // refresh_url redirect means).
      if (!acct.charges_enabled) {
        const link = await stripe.accountLinks.create({
          account: accountId, refresh_url: REFRESH_URL, return_url: RETURN_URL, type: "account_onboarding",
        });
        return res.status(200).json({ ok: true, status, charges_enabled: false, url: link.url });
      }
      return res.status(200).json({ ok: true, status, charges_enabled: true });
    }

    // action 'onboard' — create the account if needed, then an onboarding link
    if (!accountId) {
      // Static per-venue idempotency key: collapses a rapid double-submit (double-tap
      // / retry / two tabs) to ONE Express account instead of orphaning a duplicate
      // live Connect account (Stripe returns the same account for the 24h window).
      const acct = await stripe.accounts.create({
        type: "express",
        email: venue.contact_email || undefined,
        business_profile: { name: venue.name || undefined },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { venue_id: venueId },
      }, { idempotencyKey: `venue-connect-${venueId}` });
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
    // Log the detail server-side; return a generic error to the browser (a money
    // endpoint shouldn't leak raw Stripe error strings / internal request detail).
    console.error("[stripe-connect] failed", action, e?.message);
    return res.status(500).json({ error: "stripe_error" });
  }
};
