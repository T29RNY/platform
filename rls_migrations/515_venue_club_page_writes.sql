-- 515: Club Manager epic PR #10 — venue-token twins of the club-page write/read RPCs.
--
-- WHY: the club-page RPCs club_set_page / club_publish_page / club_get_page (migs
-- 446/448) authenticate as CLUB-MANAGER (auth.uid -> member_profiles -> club_team_managers).
-- The new apps/clubmanager admin console authenticates as VENUE-ADMIN (venue-token:
-- resolve_venue_caller verifies auth.uid -> venue_admins(status='active')). A pure venue
-- owner (e.g. demo admin Pav) has NO club_team_managers row, so the existing RPCs return
-- 'not_authorised'. These three venue-token twins let the venue-admin console edit a club's
-- public page from the one console. Mirrors the established venue-token-twin pattern:
--   venue_set_club_discipline (mig 355), venue_upsert_club_fixture (#3), club_send_announcement (#5).
--
-- Auth model (arch decision A, DECISIONS.md 2026-07-08): venue-token + manage_facility cap
-- + the club MUST belong to the caller's venue via club_venues (M:N). The 'public_web'
-- feature gate is kept (orthogonal to auth — a venue admin editing a public-web-off club
-- still gets feature_disabled, matching the club-manager path). Validation (slug + hex) and
-- the club_pages UPSERT are byte-identical to club_set_page (mig 448); only the auth
-- preamble + audit shape differ (venue-token audit: team_id=venue_id, actor_identifier set).
--
-- Consumers (Hard Rule #14): apps/clubmanager ClubPage.jsx (venueGetClubPage/venueSetClubPage/
-- venuePublishClubPage wrappers). The public /c/<slug> renderer (get_club_public, mig 448)
-- is UNCHANGED — it still applies the U18 name-truncation + roster-hide transform server-side
-- at read time off clubs.safeguarding_config. These writers touch club_pages branding/content
-- only; safeguarding config is NOT writable here (a separate tightening-only twin, out of scope).
--
-- All three: SECURITY DEFINER, search_path pinned, single overload (no prior signature ->
-- no DROP), REVOKE from public + GRANT anon+authenticated (venue-token convention — the token
-- is the auth; resolve_venue_caller also accepts the shared token), audit = flags/ids only (no PII).

-- ─── 1. venue_get_club_page — venue-token admin read (wizard prefill) ──────────
-- Returns the page row at ANY published state (admins edit raw values) + club identity +
-- safeguarding config. Byte-identical shape to club_get_page so the ported UI prefill is
-- unchanged. page = NULL when no page set up yet. Read-only -> no audit.
CREATE OR REPLACE FUNCTION public.venue_get_club_page(
  p_venue_token text,
  p_club_id     text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_linked   boolean;
  v_page jsonb; v_club jsonb; v_cfg jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  IF p_club_id IS NULL THEN RAISE EXCEPTION 'club_id_required' USING ERRCODE='P0001'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE='P0001'; END IF;

  SELECT to_jsonb(cp) - 'created_at' - 'updated_at' INTO v_page
    FROM public.club_pages cp WHERE cp.club_id = p_club_id;

  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'short_name', c.short_name,
    'discipline', c.discipline, 'founded_year', c.founded_year,
    'contact_name', c.contact_name, 'contact_email', c.contact_email
  ), COALESCE(c.safeguarding_config, '{}'::jsonb)
  INTO v_club, v_cfg
  FROM public.clubs c WHERE c.id = p_club_id;
  IF v_club IS NULL THEN RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001'; END IF;

  RETURN jsonb_build_object(
    'page', v_page,
    'club', v_club,
    'safeguarding', jsonb_build_object(
      'min_public_age',      COALESCE(NULLIF(v_cfg->>'min_public_age','')::int, 18),
      'hide_public_rosters', COALESCE((v_cfg->>'hide_public_rosters')::boolean, false)
    )
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_get_club_page(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_get_club_page(text,text) TO anon, authenticated;

-- ─── 2. venue_set_club_page — venue-token branding/content UPSERT ─────────────
CREATE OR REPLACE FUNCTION public.venue_set_club_page(
  p_venue_token      text,
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
  p_sections         jsonb DEFAULT NULL,
  p_links            jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_linked   boolean;
  v_slug     text := lower(btrim(COALESCE(p_slug,'')));
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  IF p_club_id IS NULL THEN RAISE EXCEPTION 'club_id_required' USING ERRCODE='P0001'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE='P0001'; END IF;

  IF NOT public._club_feature_enabled(p_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001';
  END IF;

  -- validation (identical to club_set_page, mig 448)
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
    INSERT INTO public.club_pages (
      club_id, slug, primary_colour, secondary_colour, accent_colour,
      crest_url, hero_url, tagline, about, socials, sections, links, updated_at
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
      COALESCE(p_links,    '[]'::jsonb),
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
      links            = EXCLUDED.links,
      updated_at       = now();
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'slug_taken'   USING ERRCODE='P0001';
    WHEN check_violation  THEN RAISE EXCEPTION 'slug_invalid' USING ERRCODE='P0001';
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_page_set', 'club_page', p_club_id,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', p_club_id, 'slug', v_slug));
  RETURN jsonb_build_object('ok', true, 'club_id', p_club_id, 'slug', v_slug);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_set_club_page(text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_set_club_page(text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb) TO anon, authenticated;

-- ─── 3. venue_publish_club_page — venue-token publish toggle ──────────────────
CREATE OR REPLACE FUNCTION public.venue_publish_club_page(
  p_venue_token text,
  p_club_id     text,
  p_published   boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_linked   boolean;
  v_exists   boolean;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  IF p_club_id IS NULL THEN RAISE EXCEPTION 'club_id_required' USING ERRCODE='P0001'; END IF;
  IF p_published IS NULL THEN RAISE EXCEPTION 'published_required' USING ERRCODE='P0001'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE='P0001'; END IF;

  IF NOT public._club_feature_enabled(p_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.club_pages WHERE club_id = p_club_id) INTO v_exists;
  IF NOT v_exists THEN RAISE EXCEPTION 'page_not_found' USING ERRCODE='P0001'; END IF;

  UPDATE public.club_pages SET published = p_published, updated_at = now()
   WHERE club_id = p_club_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_page_published', 'club_page', p_club_id,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', p_club_id, 'published', p_published));
  RETURN jsonb_build_object('ok', true, 'published', p_published);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_publish_club_page(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_publish_club_page(text,text,boolean) TO anon, authenticated;

SELECT pg_notify('pgrst','reload schema');
