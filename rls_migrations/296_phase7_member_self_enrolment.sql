-- Migration 296 — Phase 7: member self-enrolment infrastructure
-- (1) Make customer_id nullable so v2 memberships need no v1 customer row.
-- (2) member_self_create_profile — authenticated member creates their own profile.
-- (3) get_venue_signup_tiers — extended to return audience, price_type, venue_id,
--     club (id_mandate, safeguarding_config), and current policy documents.
-- (4) member_enrol_membership — authenticated enrolment for self or child.

-- ─── 1. Relax customer_id NOT NULL ───────────────────────────────────────────

ALTER TABLE public.venue_memberships ALTER COLUMN customer_id DROP NOT NULL;

-- ─── 2. member_self_create_profile ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_self_create_profile(
  p_first_name text,
  p_last_name  text DEFAULT NULL,
  p_email      text DEFAULT NULL,
  p_dob        date DEFAULT NULL,
  p_phone      text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF p_first_name IS NULL OR btrim(p_first_name) = '' THEN
    RAISE EXCEPTION 'first_name_required' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_profiles WHERE auth_user_id = v_uid) THEN
    RAISE EXCEPTION 'profile_exists' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.member_profiles (first_name, last_name, email, dob, phone, auth_user_id)
  VALUES (
    btrim(p_first_name),
    NULLIF(btrim(COALESCE(p_last_name,'')), ''),
    NULLIF(btrim(COALESCE(p_email,'')), ''),
    p_dob,
    NULLIF(btrim(COALESCE(p_phone,'')), ''),
    v_uid
  )
  RETURNING id INTO v_profile_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', v_uid, 'member', 'member_profile_self_created',
    'member_profile', v_profile_id::text,
    jsonb_build_object('source', 'q_signup')
  );

  RETURN jsonb_build_object('ok', true, 'profile_id', v_profile_id);
END;
$$;
REVOKE ALL ON FUNCTION public.member_self_create_profile(text,text,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_self_create_profile(text,text,text,date,text) TO authenticated;

-- ─── 3. get_venue_signup_tiers (extended) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_venue_signup_tiers(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_link     record;
  v_venue_id text;
  v_club_id  text;
  v_club     record;
  v_tiers    jsonb;
  v_docs     jsonb;
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
      'safeguarding_config', v_club.safeguarding_config
    ) ELSE NULL END,
    'documents', v_docs,
    'tiers',     v_tiers
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_venue_signup_tiers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_venue_signup_tiers(text) TO anon, authenticated;

-- ─── 4. member_enrol_membership ───────────────────────────────────────────────

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
  v_club_id        text;
  v_mid            uuid;
  v_renews         date;
  v_pass_token     text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;

  -- Resolve venue from invite code
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

  -- Payer = caller's member_profile
  SELECT id INTO v_payer_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_payer_profile IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001';
  END IF;

  -- Member = self or child (guardian check)
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

  -- Validate tier: belongs to venue, active, self-signup enabled
  SELECT id, season_end, pricing_model INTO v_tier
  FROM public.venue_membership_tiers
  WHERE id = p_tier_id AND venue_id = v_venue_id AND active
    AND COALESCE((benefits->>'self_signup')::boolean, false) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE='P0001'; END IF;

  -- Price for period
  SELECT price_pence INTO v_price
  FROM public.venue_tier_prices
  WHERE tier_id = p_tier_id AND period = p_period AND active;
  IF v_price IS NULL THEN RAISE EXCEPTION 'price_not_set' USING ERRCODE='P0001'; END IF;

  -- Club for this venue (pilot: first club)
  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv WHERE cv.venue_id = v_venue_id LIMIT 1;

  -- Renews at
  IF p_period = 'season' THEN
    v_renews := COALESCE(v_tier.season_end, '9999-12-31'::date);
  ELSE
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  INSERT INTO public.venue_memberships (
    venue_id, tier_id, period, amount_pence, status, renews_at,
    club_id, member_profile_id, payer_profile_id, pricing_model
  ) VALUES (
    v_venue_id, p_tier_id, p_period, v_price, 'active', v_renews,
    v_club_id, v_member_profile, v_payer_profile, v_tier.pricing_model
  )
  RETURNING id, pass_token INTO v_mid, v_pass_token;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue_id, v_uid, 'member', 'member_self_enrolled',
    'venue_membership', v_mid::text,
    jsonb_build_object(
      'tier_id',           p_tier_id,
      'period',            p_period,
      'member_profile_id', v_member_profile,
      'payer_profile_id',  v_payer_profile,
      'club_id',           v_club_id,
      'amount_pence',      v_price
    )
  );

  RETURN jsonb_build_object(
    'ok',            true,
    'membership_id', v_mid,
    'pass_token',    v_pass_token
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_enrol_membership(text,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_enrol_membership(text,uuid,text,uuid) TO authenticated;
