-- 448 DOWN: revert Phase-5a page config. Drops the new function overloads + the
-- two columns, and restores the mig-445/446 function bodies so the DB is left in
-- the exact Phase-3/4 state (not a half-dropped one).

-- restore originals first (CREATE OR REPLACE on same-signature fns),
-- then drop the new wider overloads, then drop the columns.

-- club_list_sponsors — mig-446 body (no tier)
CREATE OR REPLACE FUNCTION public.club_list_sponsors(p_club_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sponsor_id', s.id, 'name', s.name, 'logo_url', s.logo_url,
      'website_url', s.website_url, 'display_order', s.display_order, 'active', s.active
    ) ORDER BY s.display_order, s.name)
    FROM club_sponsors s WHERE s.club_id = p_club_id
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_list_sponsors(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_list_sponsors(text) TO authenticated;

-- club_add_sponsor — restore mig-446 5-arg, drop the 6-arg overload
CREATE OR REPLACE FUNCTION public.club_add_sponsor(
  p_club_id text, p_name text, p_logo_url text DEFAULT NULL,
  p_website_url text DEFAULT NULL, p_display_order int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid;
  v_name text := NULLIF(btrim(COALESCE(p_name,'')),''); v_sponsor_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(p_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;
  INSERT INTO club_sponsors (club_id, name, logo_url, website_url, display_order)
  VALUES (p_club_id, v_name,
          NULLIF(btrim(COALESCE(p_logo_url,'')),''),
          NULLIF(btrim(COALESCE(p_website_url,'')),''),
          COALESCE(p_display_order,0))
  RETURNING id INTO v_sponsor_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_sponsor_added', 'club_sponsor', v_sponsor_id::text,
          jsonb_build_object('club_id', p_club_id, 'sponsor_id', v_sponsor_id, 'name', v_name));
  RETURN jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_add_sponsor(text,text,text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_add_sponsor(text,text,text,text,int) TO authenticated;
DROP FUNCTION IF EXISTS public.club_add_sponsor(text,text,text,text,int,text);

-- club_update_sponsor — restore mig-446 6-arg, drop the 7-arg overload
CREATE OR REPLACE FUNCTION public.club_update_sponsor(
  p_sponsor_id uuid, p_name text DEFAULT NULL, p_logo_url text DEFAULT NULL,
  p_website_url text DEFAULT NULL, p_display_order int DEFAULT NULL, p_active boolean DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_sponsors WHERE id = p_sponsor_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'sponsor_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;
  UPDATE club_sponsors SET
    name          = COALESCE(NULLIF(btrim(COALESCE(p_name,'')),''), name),
    logo_url      = CASE WHEN p_logo_url    IS NULL THEN logo_url    ELSE NULLIF(btrim(p_logo_url),'')    END,
    website_url   = CASE WHEN p_website_url IS NULL THEN website_url ELSE NULLIF(btrim(p_website_url),'') END,
    display_order = COALESCE(p_display_order, display_order),
    active        = COALESCE(p_active, active)
  WHERE id = p_sponsor_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_sponsor_updated', 'club_sponsor', p_sponsor_id::text,
          jsonb_build_object('club_id', v_club_id, 'sponsor_id', p_sponsor_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_update_sponsor(uuid,text,text,text,int,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_update_sponsor(uuid,text,text,text,int,boolean) TO authenticated;
DROP FUNCTION IF EXISTS public.club_update_sponsor(uuid,text,text,text,int,boolean,text);

-- club_set_page — restore mig-446 11-arg, drop the 12-arg overload
CREATE OR REPLACE FUNCTION public.club_set_page(
  p_club_id          text,
  p_slug             text,
  p_primary_colour   text  DEFAULT NULL,
  p_secondary_colour text  DEFAULT NULL,
  p_accent_colour    text  DEFAULT NULL,
  p_crest_url        text  DEFAULT NULL,
  p_hero_url         text  DEFAULT NULL,
  p_tagline          text  DEFAULT NULL,
  p_about            text  DEFAULT NULL,
  p_socials          jsonb DEFAULT NULL,
  p_sections         jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_slug       text := lower(btrim(COALESCE(p_slug,'')));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(p_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001';
  END IF;
  IF v_slug = '' OR v_slug !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'slug_invalid' USING ERRCODE='P0001';
  END IF;
  IF NULLIF(btrim(COALESCE(p_primary_colour,'')),'')   IS NOT NULL
     AND btrim(p_primary_colour)   !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'invalid_colour' USING ERRCODE='P0001'; END IF;
  IF NULLIF(btrim(COALESCE(p_secondary_colour,'')),'') IS NOT NULL
     AND btrim(p_secondary_colour) !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'invalid_colour' USING ERRCODE='P0001'; END IF;
  IF NULLIF(btrim(COALESCE(p_accent_colour,'')),'')    IS NOT NULL
     AND btrim(p_accent_colour)    !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'invalid_colour' USING ERRCODE='P0001'; END IF;
  BEGIN
    INSERT INTO club_pages (
      club_id, slug, primary_colour, secondary_colour, accent_colour,
      crest_url, hero_url, tagline, about, socials, sections, updated_at
    ) VALUES (
      p_club_id, v_slug,
      NULLIF(btrim(COALESCE(p_primary_colour,'')),''),
      NULLIF(btrim(COALESCE(p_secondary_colour,'')),''),
      NULLIF(btrim(COALESCE(p_accent_colour,'')),''),
      NULLIF(btrim(COALESCE(p_crest_url,'')),''),
      NULLIF(btrim(COALESCE(p_hero_url,'')),''),
      NULLIF(btrim(COALESCE(p_tagline,'')),''),
      NULLIF(btrim(COALESCE(p_about,'')),''),
      COALESCE(p_socials,  '{}'::jsonb),
      COALESCE(p_sections, '[]'::jsonb),
      now()
    )
    ON CONFLICT (club_id) DO UPDATE SET
      slug             = EXCLUDED.slug,
      primary_colour   = EXCLUDED.primary_colour,
      secondary_colour = EXCLUDED.secondary_colour,
      accent_colour    = EXCLUDED.accent_colour,
      crest_url        = EXCLUDED.crest_url,
      hero_url         = EXCLUDED.hero_url,
      tagline          = EXCLUDED.tagline,
      about            = EXCLUDED.about,
      socials          = EXCLUDED.socials,
      sections         = EXCLUDED.sections,
      updated_at       = now();
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'slug_taken'   USING ERRCODE='P0001';
    WHEN check_violation  THEN RAISE EXCEPTION 'slug_invalid' USING ERRCODE='P0001';
  END;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_page_set', 'club_page', p_club_id,
          jsonb_build_object('club_id', p_club_id, 'slug', v_slug));
  RETURN jsonb_build_object('ok', true, 'club_id', p_club_id, 'slug', v_slug);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_set_page(text,text,text,text,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_page(text,text,text,text,text,text,text,text,text,jsonb,jsonb) TO authenticated;
DROP FUNCTION IF EXISTS public.club_set_page(text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb);

-- get_club_public — restore mig-445 body (no tier, no getInvolved)
-- (re-run rls_migrations/445_modular_club_pages_public_read.sql to restore exactly)

-- new read RPC
DROP FUNCTION IF EXISTS public.club_get_page(text);

-- finally drop the columns
ALTER TABLE public.club_pages    DROP COLUMN IF EXISTS links;
ALTER TABLE public.club_sponsors DROP COLUMN IF EXISTS tier;
