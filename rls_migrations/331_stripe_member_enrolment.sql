-- 331_stripe_member_enrolment.sql
--
-- Payment Infrastructure Phase 3: Stripe member enrolment + webhooks.
-- Adds stripe_customer_id to venue_memberships, upgrades the mig-279 partial
-- index to a UNIQUE index for idempotent ON CONFLICT, extends
-- get_venue_signup_tiers + get_member_pass return shapes, and adds
-- stripe_complete_member_enrolment (service_role only — called by the
-- checkout.session.completed webhook arm in api/stripe-webhook.js).

-- 1. stripe_customer_id on venue_memberships — the Stripe Customer created on
--    the venue's connected account at checkout time (distinct from
--    venue_customers.stripe_customer_id which is the mig-279 V1 customer model).
ALTER TABLE public.venue_memberships
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- 2. Upgrade the mig-279 non-unique partial index to a UNIQUE index so
--    ON CONFLICT (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL
--    is valid for idempotent INSERT in stripe_complete_member_enrolment.
DROP INDEX IF EXISTS public.venue_memberships_stripe_sub_idx;
CREATE UNIQUE INDEX IF NOT EXISTS venue_memberships_stripe_sub_uniq
  ON public.venue_memberships (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- 3. get_venue_signup_tiers extended: adds stripe_connected boolean to the
--    club object so MembershipSignup.jsx can fork to Stripe Checkout for
--    paid tiers on venues with an active Stripe connected account.
CREATE OR REPLACE FUNCTION public.get_venue_signup_tiers(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_link          record;
  v_venue_id      text;
  v_club_id       text;
  v_club          record;
  v_tiers         jsonb;
  v_docs          jsonb;
  v_stripe_active boolean;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  SELECT entity_id, entity_type, action, active INTO v_link
  FROM public.invite_links WHERE code = btrim(p_code);

  IF NOT FOUND OR v_link.entity_type <> 'venue' OR v_link.action <> 'venue_landing' OR NOT v_link.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  v_venue_id := v_link.entity_id;

  -- First club for this venue (pilot: one club per venue)
  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv
  WHERE cv.venue_id = v_venue_id
  LIMIT 1;

  IF v_club_id IS NOT NULL THEN
    SELECT id, name, id_mandate, safeguarding_config INTO v_club
    FROM public.clubs WHERE id = v_club_id;
  END IF;

  -- Stripe: venue has an active connected account (charges_enabled)
  SELECT EXISTS (
    SELECT 1 FROM public.venue_integrations vi
    WHERE vi.venue_id = v_venue_id AND vi.provider = 'stripe' AND vi.status = 'connected'
  ) INTO v_stripe_active;

  -- Tiers with audience + price_type per price row
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tier_id',       t.id,
    'name',          t.name,
    'audience',      t.audience,
    'pricing_model', t.pricing_model,
    'season_start',  t.season_start,
    'season_end',    t.season_end,
    'benefits',      t.benefits,
    'is_free',       COALESCE((t.benefits->>'is_free')::boolean, false),
    'prices',        COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'period',      p.period,
        'price_pence', p.price_pence,
        'price_type',  p.price_type
      ) ORDER BY p.price_pence)
       FROM public.venue_tier_prices p WHERE p.tier_id = t.id AND p.active),
      '[]'::jsonb
    )
  ) ORDER BY t.name), '[]'::jsonb)
  INTO v_tiers
  FROM public.venue_membership_tiers t
  WHERE t.venue_id = v_venue_id AND t.active
    AND COALESCE((t.benefits->>'self_signup')::boolean, false) = true;

  -- Current policy documents for the club
  IF v_club_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'document_id', pd.id,
      'title',       pd.title,
      'body',        pd.body,
      'version',     pd.version
    ) ORDER BY pd.title), '[]'::jsonb)
    INTO v_docs
    FROM public.policy_documents pd
    WHERE pd.club_id = v_club_id AND pd.is_current;
  ELSE
    v_docs := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'ok',       true,
    'venue_id', v_venue_id,
    'club',     CASE WHEN v_club.id IS NOT NULL THEN jsonb_build_object(
      'id',                  v_club.id,
      'name',                v_club.name,
      'id_mandate',          v_club.id_mandate,
      'safeguarding_config', v_club.safeguarding_config,
      'stripe_connected',    v_stripe_active
    ) ELSE NULL END,
    'documents', v_docs,
    'tiers',     v_tiers
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_venue_signup_tiers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_venue_signup_tiers(text) TO anon, authenticated;

-- 4. get_member_pass extended: adds payment_state so MemberPass.jsx can show
--    PaymentStateBanner for past_due / suspended memberships.
CREATE OR REPLACE FUNCTION public.get_member_pass(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_m      record;
  v_offers jsonb;
  v        jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT m.id, m.venue_id, m.club_id, m.tier_id, m.member_profile_id
    INTO v_m
    FROM public.venue_memberships m
   WHERE m.pass_token = p_token AND m.status <> 'cancelled';
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'offer_id',     o.id,
      'partner_name', pn.name,
      'title',        o.title,
      'description',  o.description,
      'code',         o.code
    ) ORDER BY o.created_at), '[]'::jsonb)
    INTO v_offers
    FROM public.partner_offers o
    JOIN public.venue_partners pn ON pn.id = o.partner_id
   WHERE o.venue_id = v_m.venue_id AND o.active AND pn.active
     AND (o.tier_ids IS NULL OR array_length(o.tier_ids,1) IS NULL OR v_m.tier_id = ANY(o.tier_ids));

  SELECT jsonb_build_object(
    'ok',               true,
    'member_profile_id', m.member_profile_id,
    'first_name',       COALESCE(c.first_name, mp.first_name),
    'last_name',        COALESCE(c.last_name,  mp.last_name),
    'tier_name',        t.name,
    'benefits',         t.benefits,
    'period',           m.period,
    'amount_pence',     m.amount_pence,
    'status',           m.status,
    'payment_state',    m.payment_state,
    'started_at',       m.started_at,
    'renews_at',        m.renews_at,
    'frozen_until',     m.frozen_until,
    'venue_name',       vn.name,
    'venue_logo',       vn.logo_url,
    'primary_colour',   vn.primary_colour,
    'secondary_colour', vn.secondary_colour,
    'check_in_code',    m.pass_token,
    'offers',           v_offers,
    'valid_venues',     COALESCE(
      CASE WHEN m.club_id IS NOT NULL THEN
        (SELECT jsonb_agg(jsonb_build_object('venue_id', v2.id, 'venue_name', v2.name)
                          ORDER BY v2.name)
           FROM public.club_venues cv2
           JOIN public.venues v2 ON v2.id = cv2.venue_id
          WHERE cv2.club_id = m.club_id)
      END,
      jsonb_build_array(jsonb_build_object('venue_id', vn.id, 'venue_name', vn.name))
    )
  ) INTO v
  FROM public.venue_memberships m
  LEFT JOIN public.venue_customers c    ON c.id  = m.customer_id
  LEFT JOIN public.member_profiles mp   ON mp.id = m.member_profile_id
  JOIN  public.venue_membership_tiers t  ON t.id  = m.tier_id
  JOIN  public.venues vn                ON vn.id  = m.venue_id
  WHERE m.id = v_m.id;

  IF v IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN v;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_member_pass(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_pass(text) TO anon, authenticated;

-- 5. stripe_complete_member_enrolment — service_role only.
--    Called by api/stripe-webhook.js after checkout.session.completed.
--    Idempotent on stripe_subscription_id via UNIQUE partial index (step 2).
--    For season (one-time payment), p_subscription_id is NULL — Stripe guarantees
--    checkout.session.completed fires at most once per session.
CREATE OR REPLACE FUNCTION public.stripe_complete_member_enrolment(
  p_invite_code        text,
  p_subscription_id    text,
  p_stripe_customer_id text,
  p_stripe_price_id    text,
  p_tier_id            uuid,
  p_period             text,
  p_member_profile_id  uuid,
  p_amount_pence       int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_link      record;
  v_venue_id  text;
  v_club_id   text;
  v_tier      record;
  v_price     int;
  v_renews    date;
  v_mid       uuid;
  v_pass      text;
  v_actor_uid uuid;
BEGIN
  -- Idempotency: if this subscription is already enrolled, short-circuit.
  IF p_subscription_id IS NOT NULL THEN
    SELECT id, pass_token INTO v_mid, v_pass
    FROM public.venue_memberships
    WHERE stripe_subscription_id = p_subscription_id;
    IF v_mid IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'membership_id', v_mid,
                                'pass_token', v_pass, 'already_enrolled', true);
    END IF;
  END IF;

  -- Resolve venue from invite code.
  SELECT entity_id, active INTO v_link
  FROM public.invite_links
  WHERE code = btrim(p_invite_code)
    AND entity_type = 'venue'
    AND action = 'venue_landing';
  IF NOT FOUND OR NOT v_link.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  v_venue_id := v_link.entity_id;

  IF p_period NOT IN ('monthly','quarterly','annual','season') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_period');
  END IF;

  -- Validate tier belongs to this venue.
  SELECT id, season_end, pricing_model INTO v_tier
  FROM public.venue_membership_tiers
  WHERE id = p_tier_id AND venue_id = v_venue_id AND active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tier_not_found');
  END IF;

  -- Amount: prefer Stripe-confirmed value; fall back to our price table.
  IF p_amount_pence IS NOT NULL THEN
    v_price := p_amount_pence;
  ELSE
    SELECT price_pence INTO v_price
    FROM public.venue_tier_prices
    WHERE tier_id = p_tier_id AND period = p_period AND active;
  END IF;

  -- Club for this venue (pilot: first club).
  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv WHERE cv.venue_id = v_venue_id LIMIT 1;

  -- Renews at.
  IF p_period = 'season' THEN
    v_renews := COALESCE(v_tier.season_end, '9999-12-31'::date);
  ELSE
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  INSERT INTO public.venue_memberships (
    venue_id, tier_id, period, amount_pence, status, renews_at,
    club_id, member_profile_id, pricing_model,
    stripe_subscription_id, stripe_customer_id, stripe_price_id, payment_state
  ) VALUES (
    v_venue_id, p_tier_id, p_period, v_price, 'active', v_renews,
    v_club_id, p_member_profile_id, v_tier.pricing_model,
    p_subscription_id, p_stripe_customer_id, p_stripe_price_id, 'current'
  )
  RETURNING id, pass_token INTO v_mid, v_pass;

  -- Audit: look up the member's auth_user_id. Children (guardian-registered)
  -- may have no auth account; billing_events is the primary audit trail for
  -- webhook-triggered actions, so we INSERT to audit_events only when possible.
  SELECT auth_user_id INTO v_actor_uid
  FROM public.member_profiles WHERE id = p_member_profile_id;

  IF v_actor_uid IS NOT NULL THEN
    INSERT INTO public.audit_events (
      team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
    ) VALUES (
      v_venue_id, v_actor_uid, 'member', 'stripe_member_enrolled',
      'venue_membership', v_mid::text,
      jsonb_build_object(
        'tier_id',                p_tier_id,
        'period',                 p_period,
        'member_profile_id',      p_member_profile_id,
        'club_id',                v_club_id,
        'amount_pence',           v_price,
        'stripe_subscription_id', p_subscription_id,
        'stripe_customer_id',     p_stripe_customer_id
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'membership_id', v_mid, 'pass_token', v_pass);
END;
$fn$;
REVOKE ALL ON FUNCTION public.stripe_complete_member_enrolment(text,text,text,text,uuid,text,uuid,int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_complete_member_enrolment(text,text,text,text,uuid,text,uuid,int)
  TO service_role;
