-- Phase 4: membership builder rework (mig 291, session 96)
-- Adds: audience, pricing_model, season dates on venue_membership_tiers;
--       price_type (standard/family/sibling) + season period on venue_tier_prices;
--       updates create/update/list tier RPCs;
--       fixes venue_list_clubs (token auth + safeguarding_config);
--       adds venue_update_club_settings RPC.

-- ── 1. venue_membership_tiers: audience, pricing model, season dates ─────────
ALTER TABLE public.venue_membership_tiers
  ADD COLUMN IF NOT EXISTS audience      text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS pricing_model text NOT NULL DEFAULT 'recurring',
  ADD COLUMN IF NOT EXISTS season_start  date,
  ADD COLUMN IF NOT EXISTS season_end    date;

ALTER TABLE public.venue_membership_tiers
  ADD CONSTRAINT vmt_audience_check      CHECK (audience      IN ('all','adult','junior','child')),
  ADD CONSTRAINT vmt_pricing_model_check CHECK (pricing_model IN ('recurring','season'));

-- ── 2. venue_tier_prices: price_type + updated constraints ───────────────────
ALTER TABLE public.venue_tier_prices
  ADD COLUMN IF NOT EXISTS price_type text NOT NULL DEFAULT 'standard';

ALTER TABLE public.venue_tier_prices
  ADD CONSTRAINT vtp_price_type_check CHECK (price_type IN ('standard','family','sibling'));

-- Expand period check to include 'season', replace unique constraint
ALTER TABLE public.venue_tier_prices
  DROP CONSTRAINT IF EXISTS venue_tier_prices_period_check,
  DROP CONSTRAINT IF EXISTS venue_tier_prices_tier_id_period_key;

ALTER TABLE public.venue_tier_prices
  ADD CONSTRAINT venue_tier_prices_period_check
    CHECK (period IN ('monthly','quarterly','annual','season')),
  ADD CONSTRAINT venue_tier_prices_tier_id_period_price_type_key
    UNIQUE (tier_id, period, price_type);

-- ── 3. Drop old RPC overloads before recreating with new signatures ───────────
DROP FUNCTION IF EXISTS public.venue_create_membership_tier(text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.venue_update_membership_tier(text, uuid, text, jsonb, boolean, jsonb);
DROP FUNCTION IF EXISTS public.venue_list_clubs(text);

-- ── 4. venue_create_membership_tier ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_membership_tier(
  p_venue_token   text,
  p_name          text,
  p_benefits      jsonb    DEFAULT '{}'::jsonb,
  p_prices        jsonb    DEFAULT '[]'::jsonb,
  p_audience      text     DEFAULT 'all',
  p_pricing_model text     DEFAULT 'recurring',
  p_season_start  date     DEFAULT NULL,
  p_season_end    date     DEFAULT NULL
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

  INSERT INTO public.venue_membership_tiers
    (venue_id, name, benefits, audience, pricing_model, season_start, season_end)
  VALUES
    (v_venue_id, v_name, COALESCE(p_benefits, '{}'::jsonb),
     p_audience, p_pricing_model, p_season_start, p_season_end)
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
                             'prices', COALESCE(p_prices, '[]'::jsonb)));
  RETURN jsonb_build_object('ok', true, 'tier_id', v_tier);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_create_membership_tier(text,text,jsonb,jsonb,text,text,date,date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_create_membership_tier(text,text,jsonb,jsonb,text,text,date,date) TO anon, authenticated;

-- ── 5. venue_update_membership_tier ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_update_membership_tier(
  p_venue_token   text,
  p_tier_id       uuid,
  p_name          text     DEFAULT NULL,
  p_benefits      jsonb    DEFAULT NULL,
  p_active        boolean  DEFAULT NULL,
  p_prices        jsonb    DEFAULT NULL,
  p_audience      text     DEFAULT NULL,
  p_pricing_model text     DEFAULT NULL,
  p_season_start  date     DEFAULT NULL,
  p_season_end    date     DEFAULT NULL
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

  UPDATE public.venue_membership_tiers SET
    name          = COALESCE(NULLIF(btrim(p_name), ''), name),
    benefits      = COALESCE(p_benefits, benefits),
    active        = COALESCE(p_active, active),
    audience      = COALESCE(p_audience, audience),
    pricing_model = COALESCE(p_pricing_model, pricing_model),
    season_start  = CASE WHEN p_pricing_model = 'season' THEN p_season_start ELSE season_start END,
    season_end    = CASE WHEN p_pricing_model = 'season' THEN p_season_end   ELSE season_end   END,
    updated_at    = now()
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
          jsonb_build_object('venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true, 'tier_id', v_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_update_membership_tier(text,uuid,text,jsonb,boolean,jsonb,text,text,date,date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_update_membership_tier(text,uuid,text,jsonb,boolean,jsonb,text,text,date,date) TO anon, authenticated;

-- ── 6. venue_list_membership_tiers (enrich return shape) ─────────────────────
-- Returns {ok, tiers: [...]} to match existing wrapper shape.
CREATE OR REPLACE FUNCTION public.venue_list_membership_tiers(
  p_venue_token      text,
  p_include_inactive boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_rows     jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'tier_id',       t.id,
      'name',          t.name,
      'benefits',      t.benefits,
      'active',        t.active,
      'audience',      t.audience,
      'pricing_model', t.pricing_model,
      'season_start',  t.season_start,
      'season_end',    t.season_end,
      'prices', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'period',      p.period,
          'price_pence', p.price_pence,
          'price_type',  p.price_type
        ) ORDER BY p.period, p.price_type)
        FROM public.venue_tier_prices p
        WHERE p.tier_id = t.id AND p.active
      ), '[]'::jsonb)
    ) ORDER BY t.created_at
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.venue_membership_tiers t
  WHERE t.venue_id = v_venue_id
    AND (p_include_inactive OR t.active);

  RETURN jsonb_build_object('ok', true, 'tiers', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_list_membership_tiers(text, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_list_membership_tiers(text, boolean) TO anon, authenticated;

-- ── 7. venue_list_clubs (fix token auth + add safeguarding_config) ────────────
CREATE OR REPLACE FUNCTION public.venue_list_clubs(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                  c.id,
        'name',                c.name,
        'short_name',          c.short_name,
        'contact_email',       c.contact_email,
        'id_mandate',          c.id_mandate,
        'safeguarding_config', c.safeguarding_config,
        'cohorts_count', (
          SELECT count(*) FROM public.club_cohorts cc
          WHERE cc.club_id = c.id AND cc.active
        )
      ) ORDER BY c.name
    ), '[]'::jsonb)
    FROM public.clubs c
    JOIN public.club_venues cv ON cv.club_id = c.id
    WHERE cv.venue_id = v_venue_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.venue_list_clubs(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_list_clubs(text) TO anon, authenticated;

-- ── 8. venue_update_club_settings (NEW) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_update_club_settings(
  p_venue_token         text,
  p_club_id             text,
  p_id_mandate          boolean DEFAULT NULL,
  p_safeguarding_config jsonb   DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club_id  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.clubs SET
    id_mandate          = COALESCE(p_id_mandate,          id_mandate),
    safeguarding_config = COALESCE(p_safeguarding_config, safeguarding_config)
  WHERE id = p_club_id
  RETURNING id INTO v_club_id;

  IF v_club_id IS NULL THEN RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_club_settings_updated', 'club', v_club_id,
          jsonb_build_object('venue_id', v_venue_id, 'id_mandate', p_id_mandate));
  RETURN jsonb_build_object('ok', true, 'club_id', v_club_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_update_club_settings(text, text, boolean, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_update_club_settings(text, text, boolean, jsonb) TO anon, authenticated;
