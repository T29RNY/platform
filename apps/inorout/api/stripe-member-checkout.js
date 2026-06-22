// POST /api/stripe-member-checkout — creates a Stripe Checkout session for
// member enrolment on a venue's connected account.
//
// DORMANT until STRIPE_SECRET_KEY is set (returns 503).
// Called from MembershipSignup.jsx StepEnrol when: tier is paid + venue has an
// active Stripe connected account (club.stripe_connected = true).
//
// Auth: Authorization: Bearer <supabase_access_token> (member must be signed in).
// Body: { inviteCode, tierId, period, forProfileId? }
// Returns: { checkout_url } → client redirects window.location.href there.
//
// After successful payment Stripe redirects to:
//   success_url = /q/{inviteCode}?checkout=done
// which MembershipSignup detects on mount and shows the "done" state.
// The checkout.session.completed webhook then fires stripe_complete_member_enrolment
// to create the venue_memberships row.

const { createClient } = require("@supabase/supabase-js");
const { stripe, isConfigured } = require("./_stripe");

const PERIOD_INTERVALS = {
  monthly:   { interval: "month" },
  quarterly: { interval: "month", interval_count: 3 },
  annual:    { interval: "year" },
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "stripe_not_configured" });
  }

  // Auth: verify the member's Supabase JWT
  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return res.status(401).json({ error: "missing_token" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: "invalid_token" });
  const uid = user.id;

  const { inviteCode, tierId, period, forProfileId, returnCode } = req.body || {};
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

  // Resolve Stripe connected account
  const { data: stripeInt } = await supabase
    .from("venue_integrations")
    .select("account_id")
    .eq("venue_id", venueId)
    .eq("provider", "stripe")
    .eq("status", "connected")
    .maybeSingle();
  if (!stripeInt?.account_id) return res.status(400).json({ error: "stripe_not_connected" });
  const accountId = stripeInt.account_id;

  // Resolve caller's member profile
  const { data: callerProfile } = await supabase
    .from("member_profiles")
    .select("id, first_name, last_name, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!callerProfile) return res.status(400).json({ error: "profile_not_found" });

  let memberProfileId = callerProfile.id;
  let memberEmail = callerProfile.email;
  let memberName = [callerProfile.first_name, callerProfile.last_name].filter(Boolean).join(" ");

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
      memberName = [childProfile.first_name, childProfile.last_name].filter(Boolean).join(" ");
    }
    // Guardian's email is used for the Stripe Customer
  }

  // Resolve tier name + price
  const { data: tier } = await supabase
    .from("venue_membership_tiers")
    .select("name, pricing_model, season_start, season_end, proration_basis, joining_fee_pence")
    .eq("id", tierId)
    .eq("venue_id", venueId)
    .eq("active", true)
    .maybeSingle();
  if (!tier) return res.status(404).json({ error: "tier_not_found" });

  const { data: priceRow } = await supabase
    .from("venue_tier_prices")
    .select("price_pence")
    .eq("tier_id", tierId)
    .eq("period", period)
    .eq("active", true)
    .maybeSingle();
  if (!priceRow) return res.status(400).json({ error: "price_not_set" });

  // First charge for a season plan = joining fee + the prorated season fee for a
  // late joiner. Computed by the same SQL helper the enrol RPCs use, so the
  // Stripe charge, the webhook record and the on-screen breakdown all agree.
  // Recurring (subscription) plans are unaffected — they bill the full rate.
  let chargePence = priceRow.price_pence;
  if (period === "season" && tier.pricing_model === "season") {
    const { data: prorated, error: prErr } = await supabase.rpc("_prorated_first_charge", {
      p_full_pence: priceRow.price_pence,
      p_basis:      tier.proration_basis || "none",
      p_today:      new Date().toISOString().slice(0, 10),
      p_start:      tier.season_start,
      p_end:        tier.season_end,
    });
    if (!prErr && prorated != null) chargePence = (tier.joining_fee_pence || 0) + prorated;
  }

  try {
    // Create Stripe Customer on the venue's connected account
    const customer = await stripe.customers.create(
      {
        email:    memberEmail  || undefined,
        name:     memberName   || undefined,
        metadata: { member_profile_id: memberProfileId, venue_id: venueId },
      },
      { stripeAccount: accountId }
    );

    const isSeason  = period === "season";
    const recurring = PERIOD_INTERVALS[period] ?? null;
    const appUrl    = process.env.INOROUT_APP_URL || "https://app.in-or-out.com";
    // returnCode (club-team join, Phase 3) sends the payer back to the club-team
    // join screen so it can land them on the team; falls back to the venue landing.
    const landCode  = returnCode || inviteCode;
    const successUrl = `${appUrl}/q/${encodeURIComponent(landCode)}?checkout=done`;
    const cancelUrl  = `${appUrl}/q/${encodeURIComponent(landCode)}`;

    const session = await stripe.checkout.sessions.create(
      {
        customer: customer.id,
        mode:     isSeason ? "payment" : "subscription",
        line_items: [
          {
            quantity:   1,
            price_data: isSeason
              ? {
                  currency:     "gbp",
                  unit_amount:  chargePence,
                  product_data: { name: tier.name },
                }
              : {
                  currency:     "gbp",
                  unit_amount:  priceRow.price_pence,
                  recurring,
                  product_data: { name: tier.name },
                },
          },
        ],
        success_url: successUrl,
        cancel_url:  cancelUrl,
        metadata: {
          invite_code:       inviteCode,
          tier_id:           tierId,
          period,
          member_profile_id: memberProfileId,
          amount_pence:      String(chargePence),
        },
      },
      { stripeAccount: accountId }
    );

    return res.status(200).json({ checkout_url: session.url });
  } catch (e) {
    console.error("[stripe-member-checkout] failed", e?.message);
    return res.status(500).json({ error: "stripe_error", detail: e?.message });
  }
};
