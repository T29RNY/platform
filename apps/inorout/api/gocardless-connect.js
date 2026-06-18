// /api/gocardless-connect — venue GoCardless OAuth connect for memberships.
//
// Called cross-origin from apps/venue. CORS locked to GC_CONNECT_ALLOWED_ORIGIN.
// DORMANT until GC_CLIENT_ID + GC_CLIENT_SECRET are set (returns 503).
//
// POST { venueToken, action: 'initiate' }
//   → returns { url } — redirect venue admin to GoCardless OAuth consent
//
// GET ?code=...&state=...&venue_token=...
//   → OAuth callback: exchange code → store access_token → redirect to venue app

const { createClient } = require("@supabase/supabase-js");
const {
  isGcConfigured, buildOAuthUrl, exchangeOAuthCode, GC_ENV,
} = require("./_gocardless");

const CORS_ORIGIN = process.env.GC_CONNECT_ALLOWED_ORIGIN || "https://platform-venue.vercel.app";
const REDIRECT_URI = process.env.GC_CONNECT_REDIRECT_URI || "https://app.in-or-out.com/api/gocardless-connect";
const VENUE_APP_URL = process.env.GC_CONNECT_RETURN_URL   || "https://platform-venue.vercel.app/?gc_connect=done";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

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
  if (!isGcConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "gc_not_configured" });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ── POST: initiate OAuth ───────────────────────────────────────────────
  if (req.method === "POST") {
    const { venueToken } = req.body || {};
    if (!venueToken) return res.status(400).json({ error: "missing_token" });

    const { data: rows, error: rErr } = await supabase.rpc("resolve_venue_caller", { p_token: venueToken });
    const caller = Array.isArray(rows) ? rows[0] : rows;
    if (rErr || !caller?.venue_id) return res.status(401).json({ error: "invalid_venue_token" });
    if (!hasCap(caller, "manage_memberships")) return res.status(403).json({ error: "insufficient_role" });

    // state = venueToken so the callback can re-resolve the venue
    const url = buildOAuthUrl(REDIRECT_URI, venueToken);
    return res.status(200).json({ ok: true, url, environment: GC_ENV });
  }

  // ── GET: OAuth callback ────────────────────────────────────────────────
  if (req.method === "GET") {
    const { code, state: venueToken, error: oauthError } = req.query || {};

    if (oauthError) {
      return res.redirect(302, `${VENUE_APP_URL.replace("done", "error")}&reason=${oauthError}`);
    }
    if (!code || !venueToken) {
      return res.redirect(302, `${VENUE_APP_URL.replace("done", "error")}&reason=missing_params`);
    }

    try {
      const { data: rows, error: rErr } = await supabase.rpc("resolve_venue_caller", { p_token: venueToken });
      const caller = Array.isArray(rows) ? rows[0] : rows;
      if (rErr || !caller?.venue_id) {
        return res.redirect(302, `${VENUE_APP_URL.replace("done", "error")}&reason=invalid_token`);
      }

      const { access_token, organisation_id } = await exchangeOAuthCode(code, REDIRECT_URI);

      await supabase.rpc("set_venue_gc_connect_state", {
        p_venue_id:     caller.venue_id,
        p_account_id:   organisation_id,
        p_access_token: access_token,
        p_status:       "connected",
      });

      return res.redirect(302, VENUE_APP_URL);
    } catch (e) {
      console.error("[gocardless-connect] callback failed", e?.message);
      return res.redirect(302, `${VENUE_APP_URL.replace("done", "error")}&reason=connect_failed`);
    }
  }

  return res.status(405).json({ error: "method_not_allowed" });
};
