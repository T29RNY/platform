// /api/gocardless-mandate — GoCardless Direct Debit mandate for member enrolment.
//
// DORMANT until GC_CLIENT_ID is set (returns 503).
// Auth: Authorization: Bearer <supabase_access_token> (member must be signed in).
//
// POST { inviteCode, tierId, period, forProfileId? }
//   → creates a GC redirect flow on the venue's account
//   → returns { redirect_url } — member browser redirects there to authorise mandate
//
// GET ?redirect_flow_id=...&invite_code=...
//   → mandate callback: complete the redirect flow → enrol member → redirect to pass
//
// After mandate is authorised GoCardless redirects to:
//   success_redirect_url = /api/gocardless-mandate?redirect_flow_id=RD...&invite_code=...
// which completes the flow and creates the venue_memberships row.

const { createClient } = require("@supabase/supabase-js");
const { isGcConfigured, gcClient } = require("./_gocardless");

const APP_URL = process.env.INOROUT_APP_URL || "https://app.in-or-out.com";

module.exports = async function handler(req, res) {
  if (!isGcConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "gc_not_configured" });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ── POST: create redirect flow ─────────────────────────────────────────
  if (req.method === "POST") {
    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) return res.status(401).json({ error: "missing_token" });

    const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
    if (authErr || !user) return res.status(401).json({ error: "invalid_token" });
    const uid = user.id;

    const { inviteCode, tierId, period, forProfileId } = req.body || {};
    if (!inviteCode || !tierId || !period) {
      return res.status(400).json({ error: "missing_params" });
    }
    if (!["monthly", "quarterly", "annual", "season"].includes(period)) {
      return res.status(400).json({ error: "invalid_period" });
    }

    // Resolve venue from invite code
    const { data: link } = await supabase
      .from("invite_links")
      .select("entity_id, active")
      .eq("code", inviteCode.trim())
      .eq("entity_type", "venue")
      .eq("action", "venue_landing")
      .maybeSingle();
    if (!link?.active) return res.status(404).json({ error: "invalid_code" });
    const venueId = link.entity_id;

    // Resolve GC connected account + access token for this venue
    const { data: gcInt } = await supabase
      .from("venue_integrations")
      .select("account_id, access_token")
      .eq("venue_id", venueId)
      .eq("provider", "gocardless")
      .eq("status", "connected")
      .maybeSingle();
    if (!gcInt?.access_token) return res.status(400).json({ error: "gc_not_connected" });

    // Resolve caller's member profile
    const { data: callerProfile } = await supabase
      .from("member_profiles")
      .select("id, first_name, last_name, email")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (!callerProfile) return res.status(400).json({ error: "profile_not_found" });

    let memberProfileId = callerProfile.id;
    let memberEmail     = callerProfile.email;
    let memberGivenName = callerProfile.first_name || "";
    let memberFamilyName= callerProfile.last_name  || "";

    // Child enrolment: verify guardian relationship
    if (forProfileId) {
      const { data: guardianship } = await supabase
        .from("member_guardians")
        .select("id")
        .eq("child_profile_id", forProfileId)
        .eq("guardian_profile_id", callerProfile.id)
        .eq("invite_state", "accepted")
        .maybeSingle();
      if (!guardianship) return res.status(403).json({ error: "not_guardian" });

      const { data: childProfile } = await supabase
        .from("member_profiles")
        .select("first_name, last_name")
        .eq("id", forProfileId)
        .maybeSingle();
      memberProfileId = forProfileId;
      if (childProfile) {
        memberGivenName  = childProfile.first_name || "";
        memberFamilyName = childProfile.last_name  || "";
      }
    }

    // Resolve tier name for redirect flow description
    const { data: tier } = await supabase
      .from("venue_membership_tiers")
      .select("name")
      .eq("id", tierId)
      .eq("venue_id", venueId)
      .eq("active", true)
      .maybeSingle();
    if (!tier) return res.status(404).json({ error: "tier_not_found" });

    // Build the success callback URL — GC appends ?redirect_flow_id=RD...
    const successUrl = `${APP_URL}/api/gocardless-mandate?invite_code=${encodeURIComponent(inviteCode)}&tier_id=${tierId}&period=${period}&member_profile_id=${memberProfileId}`;

    try {
      const gc  = gcClient(gcInt.access_token);
      const flow = await gc.post("/redirect_flows", {
        redirect_flows: {
          description:          tier.name,
          session_token:        `${uid}-${tierId}`,
          success_redirect_url: successUrl,
          prefilled_customer: {
            given_name:   memberGivenName  || undefined,
            family_name:  memberFamilyName || undefined,
            email:        memberEmail      || undefined,
          },
        },
      });

      return res.status(200).json({ redirect_url: flow.redirect_flows.redirect_url });
    } catch (e) {
      console.error("[gocardless-mandate] create redirect flow failed", e?.message);
      return res.status(500).json({ error: "gc_error", detail: e?.message });
    }
  }

  // ── GET: mandate callback (success_redirect_url) ───────────────────────
  if (req.method === "GET") {
    const { redirect_flow_id, invite_code, tier_id, period, member_profile_id } = req.query || {};

    if (!redirect_flow_id || !invite_code) {
      return res.redirect(302, `${APP_URL}/q/${encodeURIComponent(invite_code || "")}?gc=error`);
    }

    try {
      // Resolve venue + access token
      const { data: link } = await supabase
        .from("invite_links")
        .select("entity_id, active")
        .eq("code", invite_code.trim())
        .eq("entity_type", "venue")
        .eq("action", "venue_landing")
        .maybeSingle();
      if (!link?.active) throw new Error("invalid_code");

      const { data: gcInt } = await supabase
        .from("venue_integrations")
        .select("access_token")
        .eq("venue_id", link.entity_id)
        .eq("provider", "gocardless")
        .eq("status", "connected")
        .maybeSingle();
      if (!gcInt?.access_token) throw new Error("gc_not_connected");

      const gc = gcClient(gcInt.access_token);

      // Complete the redirect flow — this confirms the mandate
      const completed = await gc.post(`/redirect_flows/${redirect_flow_id}/actions/complete`, {
        data: { session_token: `_-${tier_id}` },
      });
      const mandateId  = completed.redirect_flows.links.mandate;
      const customerId = completed.redirect_flows.links.customer;

      // Resolve price for the audit record
      const { data: priceRow } = await supabase
        .from("venue_tier_prices")
        .select("price_pence")
        .eq("tier_id", tier_id)
        .eq("period", period)
        .eq("active", true)
        .maybeSingle();

      // Create membership row
      const { data: enrolResult } = await supabase.rpc("gc_complete_member_enrolment", {
        p_invite_code:       invite_code,
        p_mandate_id:        mandateId,
        p_customer_id:       customerId,
        p_tier_id:           tier_id,
        p_period:            period,
        p_member_profile_id: member_profile_id,
        p_amount_pence:      priceRow?.price_pence ?? null,
      });

      if (!enrolResult?.ok) throw new Error(enrolResult?.reason || "enrol_failed");

      // Redirect to member pass
      const passToken = enrolResult.pass_token;
      const dest = passToken
        ? `${APP_URL}/q/${encodeURIComponent(invite_code)}?gc=done`
        : `${APP_URL}/q/${encodeURIComponent(invite_code)}?gc=done`;

      return res.redirect(302, dest);
    } catch (e) {
      console.error("[gocardless-mandate] callback failed", e?.message);
      return res.redirect(302, `${APP_URL}/q/${encodeURIComponent(invite_code)}?gc=error`);
    }
  }

  return res.status(405).json({ error: "method_not_allowed" });
};
