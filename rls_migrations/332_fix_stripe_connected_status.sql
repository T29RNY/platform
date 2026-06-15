-- 332_fix_stripe_connected_status.sql
--
-- Bug fix: mig 331's get_venue_signup_tiers checked vi.status = 'active'
-- but venue_integrations.status constraint only allows
-- 'pending' | 'connected' | 'disconnected'. Correct check is 'connected'.
-- Same mismatch existed in api/stripe-member-checkout.js (fixed in JS).

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

  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv
  WHERE cv.venue_id = v_venue_id
  LIMIT 1;

  IF v_club_id IS NOT NULL THEN
    SELECT id, name, id_mandate, safeguarding_config INTO v_club
    FROM public.clubs WHERE id = v_club_id;
  END IF;

  -- Fixed: was 'active', correct value is 'connected'
  SELECT EXISTS (
    SELECT 1 FROM public.venue_integrations vi
    WHERE vi.venue_id = v_venue_id AND vi.provider = 'stripe' AND vi.status = 'connected'
  ) INTO v_stripe_active;

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
