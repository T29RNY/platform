-- 393_membership_proration.sql
--
-- Club org/team epic, Phase 5 — pro-rating (club-configurable) of memberships.
--
-- Pro-rating applies to SEASON memberships only (pricing_model='season'):
-- a late joiner pays for the slice of the season that is left, plus an optional
-- one-off joining fee. RECURRING (gym) plans are untouched — they bill their
-- standard rate from the join date with no first-charge maths.
--
-- Rule (operator-confirmed 2026-06-22, "Option A"): count the join period as a
-- whole (round up, member's favour). Final pence rounded to the nearest penny,
-- clamped to [0, full price]. Joining fee is added on top of the prorated amount.
--
-- Additive only: new columns default to the no-proration path, so every existing
-- tier (and the venue-landing wizard + Phase 3 club-team join that read these
-- functions) behaves byte-identically until a club opts in.

-- ── 1. Per-tier config (additive, byte-identical defaults) ───────────────────
ALTER TABLE public.venue_membership_tiers
  ADD COLUMN IF NOT EXISTS proration_basis   text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS joining_fee_pence  int NOT NULL DEFAULT 0;

ALTER TABLE public.venue_membership_tiers
  ADD CONSTRAINT vmt_proration_basis_check CHECK (proration_basis IN ('none','monthly','weekly','daily')),
  ADD CONSTRAINT vmt_joining_fee_nonneg    CHECK (joining_fee_pence >= 0);

-- ── 2. Shared first-charge helper — single source of truth ───────────────────
-- Pure date maths (IMMUTABLE). Returns the prorated portion of p_full_pence for
-- the season window [p_start, p_end] given a join date p_today, at the requested
-- granularity. Joining fee is NOT included here — callers add it.
--
-- "Never undercharge on bad data": basis='none', missing/invalid season window,
-- joining on/before the season start, or joining after the season end → full price.
CREATE OR REPLACE FUNCTION public._prorated_first_charge(
  p_full_pence int,
  p_basis      text,
  p_today      date,
  p_start      date,
  p_end        date
)
RETURNS int LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_total     numeric;
  v_remaining numeric;
  v_prorated  int;
BEGIN
  IF p_full_pence IS NULL THEN RETURN 0; END IF;

  IF p_basis IS NULL OR p_basis = 'none'
     OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start
     OR p_today <= p_start     -- whole season still ahead
     OR p_today >  p_end THEN  -- season already over → safe fallback to full
    RETURN p_full_pence;
  END IF;

  IF p_basis = 'daily' THEN
    v_total     := (p_end - p_start) + 1;
    v_remaining := (p_end - p_today) + 1;
  ELSIF p_basis = 'weekly' THEN
    v_total     := ceil(((p_end - p_start) + 1) / 7.0);
    v_remaining := ceil(((p_end - p_today) + 1) / 7.0);
  ELSIF p_basis = 'monthly' THEN
    -- inclusive calendar-month span: counts both the join month and the end
    -- month as whole months (Option A — round the part-month up, member's favour)
    v_total     := (extract(year FROM p_end)*12 + extract(month FROM p_end))
                 - (extract(year FROM p_start)*12 + extract(month FROM p_start)) + 1;
    v_remaining := (extract(year FROM p_end)*12 + extract(month FROM p_end))
                 - (extract(year FROM p_today)*12 + extract(month FROM p_today)) + 1;
  ELSE
    RETURN p_full_pence;
  END IF;

  IF v_total <= 0 THEN RETURN p_full_pence; END IF;
  IF v_remaining > v_total THEN v_remaining := v_total; END IF;
  IF v_remaining < 0 THEN v_remaining := 0; END IF;

  v_prorated := round(p_full_pence * v_remaining / v_total);  -- nearest penny
  IF v_prorated < 0 THEN v_prorated := 0; END IF;
  IF v_prorated > p_full_pence THEN v_prorated := p_full_pence; END IF;
  RETURN v_prorated;
END;
$fn$;
REVOKE ALL ON FUNCTION public._prorated_first_charge(int,text,date,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._prorated_first_charge(int,text,date,date,date) TO anon, authenticated, service_role;

-- ── 3. venue_create_membership_tier — gains proration basis + joining fee ─────
-- Param count 8 → 10: DROP the old overload first (RPC PARAMETER TYPE/COUNT rule).
DROP FUNCTION IF EXISTS public.venue_create_membership_tier(text,text,jsonb,jsonb,text,text,date,date);
CREATE OR REPLACE FUNCTION public.venue_create_membership_tier(
  p_venue_token     text,
  p_name            text,
  p_benefits        jsonb    DEFAULT '{}'::jsonb,
  p_prices          jsonb    DEFAULT '[]'::jsonb,
  p_audience        text     DEFAULT 'all',
  p_pricing_model   text     DEFAULT 'recurring',
  p_season_start    date     DEFAULT NULL,
  p_season_end      date     DEFAULT NULL,
  p_proration_basis text     DEFAULT 'none',
  p_joining_fee_pence int    DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
  v_name text := NULLIF(btrim(p_name), '');
  v_tier uuid;
  v_pr   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001'; END IF;
  IF p_audience NOT IN ('all','adult','junior','child') THEN
    RAISE EXCEPTION 'invalid_audience' USING ERRCODE = 'P0001';
  END IF;
  IF p_pricing_model NOT IN ('recurring','season') THEN
    RAISE EXCEPTION 'invalid_pricing_model' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_proration_basis,'none') NOT IN ('none','monthly','weekly','daily') THEN
    RAISE EXCEPTION 'invalid_proration_basis' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_joining_fee_pence,0) < 0 THEN
    RAISE EXCEPTION 'invalid_joining_fee' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.venue_membership_tiers
    (venue_id, name, benefits, audience, pricing_model, season_start, season_end,
     proration_basis, joining_fee_pence)
  VALUES
    (v_venue_id, v_name, COALESCE(p_benefits, '{}'::jsonb),
     p_audience, p_pricing_model, p_season_start, p_season_end,
     COALESCE(p_proration_basis,'none'), COALESCE(p_joining_fee_pence,0))
  RETURNING id INTO v_tier;

  FOR v_pr IN SELECT * FROM jsonb_array_elements(COALESCE(p_prices, '[]'::jsonb)) LOOP
    IF (v_pr->>'period') NOT IN ('monthly','quarterly','annual','season') THEN
      RAISE EXCEPTION 'invalid_period' USING ERRCODE = 'P0001', DETAIL = (v_pr->>'period');
    END IF;
    INSERT INTO public.venue_tier_prices (tier_id, period, price_pence, price_type)
    VALUES (
      v_tier,
      v_pr->>'period',
      (v_pr->>'price_pence')::int,
      COALESCE(v_pr->>'price_type', 'standard')
    );
  END LOOP;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_tier_created', 'venue_membership_tier', v_tier::text,
          jsonb_build_object('venue_id', v_venue_id, 'name', v_name,
                             'audience', p_audience, 'pricing_model', p_pricing_model,
                             'proration_basis', COALESCE(p_proration_basis,'none'),
                             'joining_fee_pence', COALESCE(p_joining_fee_pence,0),
                             'prices', COALESCE(p_prices, '[]'::jsonb)));
  RETURN jsonb_build_object('ok', true, 'tier_id', v_tier);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_create_membership_tier(text,text,jsonb,jsonb,text,text,date,date,text,int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_create_membership_tier(text,text,jsonb,jsonb,text,text,date,date,text,int) TO anon, authenticated;

-- ── 4. venue_update_membership_tier — gains proration basis + joining fee ─────
-- Param count 10 → 12: DROP the old overload first.
DROP FUNCTION IF EXISTS public.venue_update_membership_tier(text,uuid,text,jsonb,boolean,jsonb,text,text,date,date);
CREATE OR REPLACE FUNCTION public.venue_update_membership_tier(
  p_venue_token     text,
  p_tier_id         uuid,
  p_name            text     DEFAULT NULL,
  p_benefits        jsonb    DEFAULT NULL,
  p_active          boolean  DEFAULT NULL,
  p_prices          jsonb    DEFAULT NULL,
  p_audience        text     DEFAULT NULL,
  p_pricing_model   text     DEFAULT NULL,
  p_season_start    date     DEFAULT NULL,
  p_season_end      date     DEFAULT NULL,
  p_proration_basis text     DEFAULT NULL,
  p_joining_fee_pence int    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
  v_id uuid;
  v_pr jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF p_audience IS NOT NULL AND p_audience NOT IN ('all','adult','junior','child') THEN
    RAISE EXCEPTION 'invalid_audience' USING ERRCODE = 'P0001';
  END IF;
  IF p_pricing_model IS NOT NULL AND p_pricing_model NOT IN ('recurring','season') THEN
    RAISE EXCEPTION 'invalid_pricing_model' USING ERRCODE = 'P0001';
  END IF;
  IF p_proration_basis IS NOT NULL AND p_proration_basis NOT IN ('none','monthly','weekly','daily') THEN
    RAISE EXCEPTION 'invalid_proration_basis' USING ERRCODE = 'P0001';
  END IF;
  IF p_joining_fee_pence IS NOT NULL AND p_joining_fee_pence < 0 THEN
    RAISE EXCEPTION 'invalid_joining_fee' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.venue_membership_tiers SET
    name              = COALESCE(NULLIF(btrim(p_name), ''), name),
    benefits          = COALESCE(p_benefits, benefits),
    active            = COALESCE(p_active, active),
    audience          = COALESCE(p_audience, audience),
    pricing_model     = COALESCE(p_pricing_model, pricing_model),
    season_start      = CASE WHEN p_pricing_model = 'season' THEN p_season_start ELSE season_start END,
    season_end        = CASE WHEN p_pricing_model = 'season' THEN p_season_end   ELSE season_end   END,
    proration_basis   = COALESCE(p_proration_basis, proration_basis),
    joining_fee_pence = COALESCE(p_joining_fee_pence, joining_fee_pence),
    updated_at        = now()
  WHERE id = p_tier_id AND venue_id = v_venue_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE = 'P0001'; END IF;

  IF p_prices IS NOT NULL THEN
    FOR v_pr IN SELECT * FROM jsonb_array_elements(p_prices) LOOP
      IF (v_pr->>'period') NOT IN ('monthly','quarterly','annual','season') THEN
        RAISE EXCEPTION 'invalid_period' USING ERRCODE = 'P0001', DETAIL = (v_pr->>'period');
      END IF;
      INSERT INTO public.venue_tier_prices (tier_id, period, price_pence, price_type)
      VALUES (
        v_id,
        v_pr->>'period',
        (v_pr->>'price_pence')::int,
        COALESCE(v_pr->>'price_type', 'standard')
      )
      ON CONFLICT (tier_id, period, price_type)
        DO UPDATE SET price_pence = EXCLUDED.price_pence, active = true;
    END LOOP;
  END IF;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_tier_updated', 'venue_membership_tier', v_id::text,
          jsonb_build_object('venue_id', v_venue_id,
                             'proration_basis', p_proration_basis,
                             'joining_fee_pence', p_joining_fee_pence));
  RETURN jsonb_build_object('ok', true, 'tier_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_update_membership_tier(text,uuid,text,jsonb,boolean,jsonb,text,text,date,date,text,int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_update_membership_tier(text,uuid,text,jsonb,boolean,jsonb,text,text,date,date,text,int) TO anon, authenticated;

-- ── 5. get_venue_signup_tiers — surface first-charge breakdown at checkout ────
-- Adds proration_basis + joining_fee_pence to each tier, and first_charge_pence
-- to the season price row (= joining_fee + prorated season fee for today). NULL
-- on rows where no proration/fee applies, so existing display is unchanged.
CREATE OR REPLACE FUNCTION public.get_venue_signup_tiers(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_link          record;
  v_venue_id      text;
  v_club_id       text;
  v_club_name     text;
  v_club_mandate  boolean;
  v_club_sg       jsonb;
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

  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv
  WHERE cv.venue_id = v_venue_id
  LIMIT 1;

  IF v_club_id IS NOT NULL THEN
    SELECT name, id_mandate, safeguarding_config INTO v_club_name, v_club_mandate, v_club_sg
    FROM public.clubs WHERE id = v_club_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.venue_integrations vi
    WHERE vi.venue_id = v_venue_id AND vi.provider = 'stripe' AND vi.status = 'connected'
  ) INTO v_stripe_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tier_id',           t.id,
    'name',              t.name,
    'audience',          t.audience,
    'pricing_model',     t.pricing_model,
    'season_start',      t.season_start,
    'season_end',        t.season_end,
    'proration_basis',   COALESCE(t.proration_basis, 'none'),
    'joining_fee_pence', COALESCE(t.joining_fee_pence, 0),
    'benefits',          t.benefits,
    'is_free',           COALESCE((t.benefits->>'is_free')::boolean, false),
    'prices',            COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'period',           p.period,
        'price_pence',      p.price_pence,
        'price_type',       p.price_type,
        -- first charge for a late joiner: only on the season price of a season
        -- tier that opted into proration and/or a joining fee. NULL otherwise.
        'first_charge_pence',
          CASE WHEN t.pricing_model = 'season' AND p.period = 'season'
                 AND (COALESCE(t.proration_basis,'none') <> 'none' OR COALESCE(t.joining_fee_pence,0) > 0)
               THEN COALESCE(t.joining_fee_pence,0)
                  + public._prorated_first_charge(p.price_pence, t.proration_basis,
                                                  current_date, t.season_start, t.season_end)
               ELSE NULL END
      ) ORDER BY p.price_pence)
       FROM public.venue_tier_prices p WHERE p.tier_id = t.id AND p.active),
      '[]'::jsonb
    )
  ) ORDER BY t.name), '[]'::jsonb)
  INTO v_tiers
  FROM public.venue_membership_tiers t
  WHERE t.venue_id = v_venue_id AND t.active
    AND COALESCE((t.benefits->>'self_signup')::boolean, false) = true;

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
    -- scalar club vars (not a `record`) so a club-less venue-landing code no
    -- longer raises "record not assigned yet" on this RETURN. (latent pre-393 bug.)
    'club',     CASE WHEN v_club_id IS NOT NULL THEN jsonb_build_object(
      'id',                  v_club_id,
      'name',                v_club_name,
      'id_mandate',          v_club_mandate,
      'safeguarding_config', v_club_sg,
      'stripe_connected',    v_stripe_active
    ) ELSE NULL END,
    'documents', v_docs,
    'tiers',     v_tiers
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_venue_signup_tiers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_venue_signup_tiers(text) TO anon, authenticated;

-- ── 6. member_enrol_membership — apply first-charge to the season write ───────
-- Signature unchanged. For season tiers, amount_pence = joining_fee + prorated
-- season fee. Recurring tiers: amount_pence = full price (byte-identical).
CREATE OR REPLACE FUNCTION public.member_enrol_membership(
  p_invite_code    text,
  p_tier_id        uuid,
  p_period         text,
  p_for_profile_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_uid            uuid := auth.uid();
  v_link           record;
  v_venue_id       text;
  v_payer_profile  uuid;
  v_member_profile uuid;
  v_tier           record;
  v_price          int;
  v_amount         int;
  v_club_id        text;
  v_mid            uuid;
  v_renews         date;
  v_pass_token     text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;

  SELECT entity_id, active INTO v_link
  FROM public.invite_links
  WHERE code = btrim(p_invite_code)
    AND entity_type = 'venue'
    AND action = 'venue_landing';
  IF NOT FOUND OR NOT v_link.active THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_link.entity_id;

  IF p_period NOT IN ('monthly','quarterly','annual','season') THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_payer_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_payer_profile IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001';
  END IF;

  IF p_for_profile_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
      WHERE child_profile_id    = p_for_profile_id
        AND guardian_profile_id = v_payer_profile
        AND invite_state        = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_member_profile := p_for_profile_id;
  ELSE
    v_member_profile := v_payer_profile;
  END IF;

  SELECT id, season_start, season_end, pricing_model, proration_basis, joining_fee_pence
    INTO v_tier
  FROM public.venue_membership_tiers
  WHERE id = p_tier_id AND venue_id = v_venue_id AND active
    AND COALESCE((benefits->>'self_signup')::boolean, false) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE='P0001'; END IF;

  SELECT price_pence INTO v_price
  FROM public.venue_tier_prices
  WHERE tier_id = p_tier_id AND period = p_period AND active;
  IF v_price IS NULL THEN RAISE EXCEPTION 'price_not_set' USING ERRCODE='P0001'; END IF;

  -- First charge: season → joining fee + prorated season fee; recurring → full.
  IF v_tier.pricing_model = 'season' THEN
    v_amount := COALESCE(v_tier.joining_fee_pence, 0)
              + public._prorated_first_charge(v_price, COALESCE(v_tier.proration_basis,'none'),
                                              current_date, v_tier.season_start, v_tier.season_end);
  ELSE
    v_amount := v_price;
  END IF;

  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv WHERE cv.venue_id = v_venue_id LIMIT 1;

  IF p_period = 'season' THEN
    v_renews := COALESCE(v_tier.season_end, '9999-12-31'::date);
  ELSE
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  -- venue_memberships.pricing_model vocabulary is recurring|term (mig 285);
  -- map the tier's recurring|season onto it (season → term).
  INSERT INTO public.venue_memberships (
    venue_id, tier_id, period, amount_pence, status, renews_at,
    club_id, member_profile_id, payer_profile_id, pricing_model
  ) VALUES (
    v_venue_id, p_tier_id, p_period, v_amount, 'active', v_renews,
    v_club_id, v_member_profile, v_payer_profile,
    CASE WHEN v_tier.pricing_model = 'season' THEN 'term' ELSE COALESCE(v_tier.pricing_model,'recurring') END
  )
  RETURNING id, pass_token INTO v_mid, v_pass_token;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue_id, v_uid, 'player', 'member_self_enrolled',
    'venue_membership', v_mid::text,
    jsonb_build_object(
      'tier_id',           p_tier_id,
      'period',            p_period,
      'member_profile_id', v_member_profile,
      'payer_profile_id',  v_payer_profile,
      'club_id',           v_club_id,
      'full_price_pence',  v_price,
      'amount_pence',      v_amount,
      'proration_basis',   COALESCE(v_tier.proration_basis,'none'),
      'joining_fee_pence', COALESCE(v_tier.joining_fee_pence,0)
    )
  );

  RETURN jsonb_build_object(
    'ok',            true,
    'membership_id', v_mid,
    'amount_pence',  v_amount,
    'pass_token',    v_pass_token
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_enrol_membership(text,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_enrol_membership(text,uuid,text,uuid) TO authenticated;

-- ── 7. stripe_complete_member_enrolment — same first-charge on fallback ───────
-- Signature unchanged. Prefers the Stripe-confirmed amount (the checkout endpoint
-- sends the prorated season amount); on fallback computes it the same way.
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
  IF p_subscription_id IS NOT NULL THEN
    SELECT id, pass_token INTO v_mid, v_pass
    FROM public.venue_memberships
    WHERE stripe_subscription_id = p_subscription_id;
    IF v_mid IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'membership_id', v_mid,
                                'pass_token', v_pass, 'already_enrolled', true);
    END IF;
  END IF;

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

  SELECT id, season_start, season_end, pricing_model, proration_basis, joining_fee_pence
    INTO v_tier
  FROM public.venue_membership_tiers
  WHERE id = p_tier_id AND venue_id = v_venue_id AND active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tier_not_found');
  END IF;

  -- Amount: prefer Stripe-confirmed value; else our price table, applying the
  -- season first-charge (joining fee + prorated) so a fallback never overcharges.
  IF p_amount_pence IS NOT NULL THEN
    v_price := p_amount_pence;
  ELSE
    SELECT price_pence INTO v_price
    FROM public.venue_tier_prices
    WHERE tier_id = p_tier_id AND period = p_period AND active;
    IF v_tier.pricing_model = 'season' THEN
      v_price := COALESCE(v_tier.joining_fee_pence, 0)
               + public._prorated_first_charge(v_price, COALESCE(v_tier.proration_basis,'none'),
                                               current_date, v_tier.season_start, v_tier.season_end);
    END IF;
  END IF;

  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv WHERE cv.venue_id = v_venue_id LIMIT 1;

  IF p_period = 'season' THEN
    v_renews := COALESCE(v_tier.season_end, '9999-12-31'::date);
  ELSE
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  -- map tier recurring|season → membership recurring|term (mig 285 vocabulary)
  INSERT INTO public.venue_memberships (
    venue_id, tier_id, period, amount_pence, status, renews_at,
    club_id, member_profile_id, pricing_model,
    stripe_subscription_id, stripe_customer_id, stripe_price_id, payment_state
  ) VALUES (
    v_venue_id, p_tier_id, p_period, v_price, 'active', v_renews,
    v_club_id, p_member_profile_id,
    CASE WHEN v_tier.pricing_model = 'season' THEN 'term' ELSE COALESCE(v_tier.pricing_model,'recurring') END,
    p_subscription_id, p_stripe_customer_id, p_stripe_price_id, 'current'
  )
  RETURNING id, pass_token INTO v_mid, v_pass;

  SELECT auth_user_id INTO v_actor_uid
  FROM public.member_profiles WHERE id = p_member_profile_id;

  IF v_actor_uid IS NOT NULL THEN
    INSERT INTO public.audit_events (
      team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
    ) VALUES (
      v_venue_id, v_actor_uid, 'player', 'stripe_member_enrolled',
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

SELECT pg_notify('pgrst', 'reload schema');
