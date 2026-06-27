-- 446: Modular Platform Epic B — Phase 3 (club-manager admin write RPCs).
-- Clones the club_admin_set_branding (mig 388) auth/gate/audit preamble + the
-- tournament_sponsors admin RPCs (mig 327), FK swapped to clubs.id (text).
-- Every RPC: club-manager auth (auth.uid->member_profiles->club_team_managers
-- JOIN club_teams, is_active) + _club_feature_enabled(club_id,'public_web')
-- + audit_events (Hard Rule #9). Strict hex on the 3 colours (format only;
-- contrast is advisory/client-side in the P5 wizard). authenticated-only.
-- Consumers (Hard Rule #14): P5 ClubSettingsScreen wizard/edit; P4 read surfaces.

-- ─── 1. club_set_page — UPSERT club_pages ─────────────────────────────────────
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

-- ─── 2. club_publish_page ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_publish_page(p_club_id text, p_published boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid; v_x text;
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

  UPDATE club_pages SET published = COALESCE(p_published,false), updated_at = now()
   WHERE club_id = p_club_id RETURNING club_id INTO v_x;
  IF v_x IS NULL THEN RAISE EXCEPTION 'page_not_found' USING ERRCODE='P0001'; END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_page_published', 'club_page', p_club_id,
          jsonb_build_object('club_id', p_club_id, 'published', COALESCE(p_published,false)));
  RETURN jsonb_build_object('ok', true, 'published', COALESCE(p_published,false));
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_publish_page(text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_publish_page(text,boolean) TO authenticated;

-- ─── 3. club_add_sponsor ──────────────────────────────────────────────────────
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

-- ─── 4. club_update_sponsor (covers reorder via display_order + active) ────────
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

-- ─── 5. club_remove_sponsor ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_remove_sponsor(p_sponsor_id uuid)
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

  DELETE FROM club_sponsors WHERE id = p_sponsor_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_sponsor_removed', 'club_sponsor', p_sponsor_id::text,
          jsonb_build_object('club_id', v_club_id, 'sponsor_id', p_sponsor_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_remove_sponsor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_remove_sponsor(uuid) TO authenticated;

-- ─── 6. club_list_sponsors (admin — includes inactive) ────────────────────────
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

-- ─── 7. club_create_post ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_create_post(
  p_club_id text, p_slug text, p_title text, p_body text DEFAULT NULL,
  p_hero_url text DEFAULT NULL, p_author_name text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid;
  v_slug text := lower(btrim(COALESCE(p_slug,'')));
  v_title text := NULLIF(btrim(COALESCE(p_title,'')),''); v_post_id uuid;
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
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE='P0001'; END IF;
  IF v_slug = '' OR v_slug !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'slug_invalid' USING ERRCODE='P0001'; END IF;

  BEGIN
    INSERT INTO club_posts (club_id, slug, title, body, hero_url, author_name, author_profile_id, status, updated_at)
    VALUES (p_club_id, v_slug, v_title,
            NULLIF(btrim(COALESCE(p_body,'')),''),
            NULLIF(btrim(COALESCE(p_hero_url,'')),''),
            NULLIF(btrim(COALESCE(p_author_name,'')),''),
            v_profile_id, 'draft', now())
    RETURNING id INTO v_post_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'post_slug_taken' USING ERRCODE='P0001';
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_post_created', 'club_post', v_post_id::text,
          jsonb_build_object('club_id', p_club_id, 'post_id', v_post_id, 'slug', v_slug));
  RETURN jsonb_build_object('ok', true, 'post_id', v_post_id, 'slug', v_slug);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_create_post(text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_create_post(text,text,text,text,text,text) TO authenticated;

-- ─── 8. club_update_post ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_update_post(
  p_post_id uuid, p_title text DEFAULT NULL, p_body text DEFAULT NULL,
  p_hero_url text DEFAULT NULL, p_author_name text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_posts WHERE id = p_post_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  UPDATE club_posts SET
    title       = COALESCE(NULLIF(btrim(COALESCE(p_title,'')),''), title),
    body        = CASE WHEN p_body        IS NULL THEN body        ELSE NULLIF(btrim(p_body),'')        END,
    hero_url    = CASE WHEN p_hero_url    IS NULL THEN hero_url    ELSE NULLIF(btrim(p_hero_url),'')    END,
    author_name = CASE WHEN p_author_name IS NULL THEN author_name ELSE NULLIF(btrim(p_author_name),'') END,
    updated_at  = now()
  WHERE id = p_post_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_post_updated', 'club_post', p_post_id::text,
          jsonb_build_object('club_id', v_club_id, 'post_id', p_post_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_update_post(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_update_post(uuid,text,text,text,text) TO authenticated;

-- ─── 9. club_delete_post (hard delete) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_delete_post(p_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_posts WHERE id = p_post_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  DELETE FROM club_posts WHERE id = p_post_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_post_deleted', 'club_post', p_post_id::text,
          jsonb_build_object('club_id', v_club_id, 'post_id', p_post_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_delete_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_delete_post(uuid) TO authenticated;

-- ─── 10. club_publish_post ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_publish_post(p_post_id uuid, p_published boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text; v_new_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_posts WHERE id = p_post_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  v_new_status := CASE WHEN COALESCE(p_published,false) THEN 'published' ELSE 'draft' END;
  UPDATE club_posts SET
    status       = v_new_status,
    published_at = CASE WHEN v_new_status = 'published' THEN COALESCE(published_at, now()) ELSE NULL END,
    updated_at   = now()
  WHERE id = p_post_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_post_published', 'club_post', p_post_id::text,
          jsonb_build_object('club_id', v_club_id, 'post_id', p_post_id, 'status', v_new_status));
  RETURN jsonb_build_object('ok', true, 'status', v_new_status);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_publish_post(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_publish_post(uuid,boolean) TO authenticated;

-- ─── 11. club_list_posts (admin — includes drafts) ────────────────────────────
CREATE OR REPLACE FUNCTION public.club_list_posts(p_club_id text)
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
      'post_id', p.id, 'slug', p.slug, 'title', p.title, 'body', p.body,
      'hero_url', p.hero_url, 'author_name', p.author_name, 'status', p.status,
      'published_at', p.published_at, 'updated_at', p.updated_at
    ) ORDER BY COALESCE(p.published_at, p.updated_at) DESC)
    FROM club_posts p WHERE p.club_id = p_club_id
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_list_posts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_list_posts(text) TO authenticated;

-- ─── 12. club_set_safeguarding (tightening-only) ──────────────────────────────
-- Club managers may STRENGTHEN safeguarding but never weaken a venue-set policy.
-- min_public_age may only increase vs current; hide_public_rosters only false->true.
-- Loosening stays the venue operator's call (venue_update_club_settings). Merges
-- just these two keys, preserving any other keys the venue set.
CREATE OR REPLACE FUNCTION public.club_set_safeguarding(
  p_club_id text, p_min_public_age int DEFAULT NULL, p_hide_public_rosters boolean DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid;
  v_cfg jsonb; v_cur_age int; v_cur_hide boolean; v_new_age int; v_new_hide boolean;
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

  SELECT COALESCE(safeguarding_config,'{}'::jsonb) INTO v_cfg FROM clubs WHERE id = p_club_id;
  IF v_cfg IS NULL THEN RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001'; END IF;
  v_cur_age  := COALESCE(NULLIF(v_cfg->>'min_public_age','')::int, 18);
  v_cur_hide := COALESCE((v_cfg->>'hide_public_rosters')::boolean, false);

  IF p_min_public_age IS NOT NULL THEN
    IF p_min_public_age < 0 OR p_min_public_age > 99 THEN
      RAISE EXCEPTION 'invalid_min_age' USING ERRCODE='P0001';
    END IF;
    IF p_min_public_age < v_cur_age THEN
      RAISE EXCEPTION 'safeguarding_cannot_weaken' USING ERRCODE='P0001';
    END IF;
  END IF;
  IF p_hide_public_rosters IS NOT NULL AND p_hide_public_rosters = false AND v_cur_hide = true THEN
    RAISE EXCEPTION 'safeguarding_cannot_weaken' USING ERRCODE='P0001';
  END IF;

  v_new_age  := COALESCE(p_min_public_age, v_cur_age);
  v_new_hide := COALESCE(p_hide_public_rosters, v_cur_hide);

  UPDATE clubs SET safeguarding_config =
    COALESCE(safeguarding_config,'{}'::jsonb)
    || jsonb_build_object('min_public_age', v_new_age, 'hide_public_rosters', v_new_hide)
  WHERE id = p_club_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_safeguarding_set', 'club', p_club_id,
          jsonb_build_object('club_id', p_club_id, 'min_public_age', v_new_age, 'hide_public_rosters', v_new_hide));
  RETURN jsonb_build_object('ok', true, 'min_public_age', v_new_age, 'hide_public_rosters', v_new_hide);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_set_safeguarding(text,int,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_safeguarding(text,int,boolean) TO authenticated;
