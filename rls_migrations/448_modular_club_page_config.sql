-- 448: Modular Platform Epic B — Phase 5a (page-level config: sponsor tiers + get-involved links).
-- The setup-wizard / edit-dashboard backend that needs NO new tables. Two schema
-- additions + four function changes; all other P5 modules (contacts/documents/events/
-- POTM stats) land in the separate Phase-5b migration (449) after this PR merges.
--
--   club_sponsors.tier   -- headline | match | supporter (NULL = untiered, degrades to flat row)
--   club_pages.links     -- [{label,url}] get-involved CTAs (volunteer/shop/lottery/donate)
--
-- Function changes (every one keeps the mig-446 auth/gate/audit preamble verbatim):
--   club_add_sponsor    -- + p_tier         (NEW overload — old 5-arg signature DROPped)
--   club_update_sponsor -- + p_tier         (NEW overload — old 6-arg signature DROPped)
--   club_set_page       -- + p_links        (NEW overload — old 11-arg signature DROPped)
--   club_list_sponsors  -- returns tier     (same signature — CREATE OR REPLACE)
--   get_club_public     -- sponsors.tier + new getInvolved slice (same signature)
--
-- Consumers (Hard Rule #14): P5 ClubSettingsScreen (writes); P4 ClubPublicScreen
-- SponsorsSection (reads sponsors[].tier) + GetInvolvedSection (reads getInvolved[]).
-- Both P4 components already read these keys defensively — zero P4 rework.

-- ─── 1. schema additions ──────────────────────────────────────────────────────
ALTER TABLE public.club_sponsors
  ADD COLUMN IF NOT EXISTS tier text DEFAULT NULL
  CONSTRAINT club_sponsors_tier_chk CHECK (tier IS NULL OR tier IN ('headline','match','supporter'));

ALTER TABLE public.club_pages
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;   -- [{label,url}]

-- ─── 2. club_add_sponsor (+ p_tier) ───────────────────────────────────────────
DROP FUNCTION IF EXISTS public.club_add_sponsor(text,text,text,text,int);
CREATE OR REPLACE FUNCTION public.club_add_sponsor(
  p_club_id text, p_name text, p_logo_url text DEFAULT NULL,
  p_website_url text DEFAULT NULL, p_display_order int DEFAULT 0, p_tier text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid;
  v_name text := NULLIF(btrim(COALESCE(p_name,'')),'');
  v_tier text := NULLIF(btrim(COALESCE(p_tier,'')),''); v_sponsor_id uuid;
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
  IF v_tier IS NOT NULL AND v_tier NOT IN ('headline','match','supporter') THEN
    RAISE EXCEPTION 'invalid_tier' USING ERRCODE='P0001'; END IF;

  INSERT INTO club_sponsors (club_id, name, logo_url, website_url, display_order, tier)
  VALUES (p_club_id, v_name,
          NULLIF(btrim(COALESCE(p_logo_url,'')),''),
          NULLIF(btrim(COALESCE(p_website_url,'')),''),
          COALESCE(p_display_order,0), v_tier)
  RETURNING id INTO v_sponsor_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_sponsor_added', 'club_sponsor', v_sponsor_id::text,
          jsonb_build_object('club_id', p_club_id, 'sponsor_id', v_sponsor_id, 'name', v_name, 'tier', v_tier));
  RETURN jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_add_sponsor(text,text,text,text,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_add_sponsor(text,text,text,text,int,text) TO authenticated;

-- ─── 3. club_update_sponsor (+ p_tier) ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.club_update_sponsor(uuid,text,text,text,int,boolean);
CREATE OR REPLACE FUNCTION public.club_update_sponsor(
  p_sponsor_id uuid, p_name text DEFAULT NULL, p_logo_url text DEFAULT NULL,
  p_website_url text DEFAULT NULL, p_display_order int DEFAULT NULL, p_active boolean DEFAULT NULL,
  p_tier text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text; v_tier text;
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
  -- p_tier: NULL = leave as-is; '' = clear to untiered; else must be a valid tier.
  v_tier := NULLIF(btrim(COALESCE(p_tier,'')),'');
  IF p_tier IS NOT NULL AND v_tier IS NOT NULL AND v_tier NOT IN ('headline','match','supporter') THEN
    RAISE EXCEPTION 'invalid_tier' USING ERRCODE='P0001'; END IF;

  UPDATE club_sponsors SET
    name          = COALESCE(NULLIF(btrim(COALESCE(p_name,'')),''), name),
    logo_url      = CASE WHEN p_logo_url    IS NULL THEN logo_url    ELSE NULLIF(btrim(p_logo_url),'')    END,
    website_url   = CASE WHEN p_website_url IS NULL THEN website_url ELSE NULLIF(btrim(p_website_url),'') END,
    display_order = COALESCE(p_display_order, display_order),
    active        = COALESCE(p_active, active),
    tier          = CASE WHEN p_tier IS NULL THEN tier ELSE v_tier END
  WHERE id = p_sponsor_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_sponsor_updated', 'club_sponsor', p_sponsor_id::text,
          jsonb_build_object('club_id', v_club_id, 'sponsor_id', p_sponsor_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_update_sponsor(uuid,text,text,text,int,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_update_sponsor(uuid,text,text,text,int,boolean,text) TO authenticated;

-- ─── 4. club_list_sponsors (returns tier) ─────────────────────────────────────
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
      'website_url', s.website_url, 'display_order', s.display_order,
      'active', s.active, 'tier', s.tier
    ) ORDER BY s.display_order, s.name)
    FROM club_sponsors s WHERE s.club_id = p_club_id
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_list_sponsors(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_list_sponsors(text) TO authenticated;

-- ─── 5. club_set_page (+ p_links) ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.club_set_page(text,text,text,text,text,text,text,text,text,jsonb,jsonb);
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
  p_sections         jsonb DEFAULT NULL,
  p_links            jsonb DEFAULT NULL
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

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_page_set', 'club_page', p_club_id,
          jsonb_build_object('club_id', p_club_id, 'slug', v_slug));
  RETURN jsonb_build_object('ok', true, 'club_id', p_club_id, 'slug', v_slug);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_set_page(text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_page(text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb) TO authenticated;

-- ─── 6. get_club_public (sponsors.tier + getInvolved slice) ───────────────────
CREATE OR REPLACE FUNCTION public.get_club_public(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row          record;
  v_sg           jsonb;
  v_min_age      int;
  v_hide_rosters boolean;
BEGIN
  SELECT cp.*,
         c.name           AS club_name,
         c.short_name     AS club_short_name,
         c.discipline     AS club_discipline,
         c.founded_year   AS club_founded_year,
         c.safeguarding_config AS safeguarding_config
    INTO v_row
    FROM public.club_pages cp
    JOIN public.clubs c ON c.id = cp.club_id
   WHERE cp.slug = p_slug
   LIMIT 1;

  IF v_row.club_id IS NULL OR NOT COALESCE(v_row.published, false) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_sg           := COALESCE(v_row.safeguarding_config, '{}'::jsonb);
  v_min_age      := COALESCE(NULLIF(v_sg->>'min_public_age','')::int, 18);
  v_hide_rosters := COALESCE((v_sg->>'hide_public_rosters')::boolean, false);

  RETURN jsonb_build_object(
    'found', true,
    'club', jsonb_build_object(
      'id',           v_row.club_id,
      'name',         v_row.club_name,
      'short_name',   v_row.club_short_name,
      'discipline',   v_row.club_discipline,
      'founded_year', v_row.club_founded_year
    ),
    'branding', jsonb_build_object(
      'primary_colour',   v_row.primary_colour,
      'secondary_colour', v_row.secondary_colour,
      'accent_colour',    v_row.accent_colour,
      'crest_url',        v_row.crest_url,
      'hero_url',         v_row.hero_url,
      'tagline',          v_row.tagline,
      'about',            v_row.about,
      'socials',          v_row.socials,
      'sections',         v_row.sections
    ),
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'cohort_id', cc.id, 'name', cc.name, 'category', cc.category,
        'min_age', cc.min_age, 'max_age', cc.max_age,
        'teams', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'team_id', t.id, 'name', t.name, 'gender', t.gender,
            'priority_rank', t.priority_rank,
            'members', CASE WHEN v_hide_rosters THEN '[]'::jsonb ELSE COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'member_id', mp.id,
                'name', CASE
                  WHEN (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age)
                  THEN mp.first_name || COALESCE(' ' || left(mp.last_name, 1) || '.', '')
                  ELSE mp.first_name || COALESCE(' ' || mp.last_name, '')
                END,
                'is_minor', (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age),
                'photo_url', NULL
              ) ORDER BY mp.first_name)
              FROM public.club_team_members cm
              JOIN public.member_profiles mp ON mp.id = cm.member_profile_id
              WHERE cm.team_id = t.id AND cm.is_active = true
            ), '[]'::jsonb) END
          ) ORDER BY t.priority_rank NULLS LAST, t.name)
          FROM public.club_teams t
          WHERE t.cohort_id = cc.id AND t.archived_at IS NULL
        ), '[]'::jsonb)
      ) ORDER BY cc.name)
      FROM public.club_cohorts cc
      WHERE cc.club_id = v_row.club_id AND cc.active = true
    ), '[]'::jsonb),
    'leagues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'league_id', cl.id, 'name', cl.name, 'season_label', cl.season_label,
        'fixtures', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'our_team',       COALESCE(f.club_team_name, ct.name),
            'opponent',       f.opponent_name,
            'is_home',        f.is_home,
            'scheduled_date', f.scheduled_date,
            'kickoff_time',   to_char(f.kickoff_time, 'HH24:MI'),
            'home_score',     f.home_score,
            'away_score',     f.away_score,
            'status',         f.status
          ) ORDER BY f.scheduled_date NULLS LAST, f.kickoff_time NULLS LAST)
          FROM public.club_fixtures f
          LEFT JOIN public.club_teams ct ON ct.id = f.club_team_id
          WHERE f.league_id = cl.id AND f.status <> 'void'
        ), '[]'::jsonb)
      ) ORDER BY cl.created_at)
      FROM public.club_leagues cl
      WHERE cl.club_id = v_row.club_id AND cl.archived_at IS NULL
    ), '[]'::jsonb),
    -- sponsors now carry tier (headline|match|supporter|null) for the tiered wall
    'sponsors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sponsor_id', s.id, 'name', s.name,
        'logo_url', s.logo_url, 'website_url', s.website_url, 'tier', s.tier
      ) ORDER BY s.display_order, s.name)
      FROM public.club_sponsors s
      WHERE s.club_id = v_row.club_id AND s.active = true
    ), '[]'::jsonb),
    'news', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'post_id', p.id, 'slug', p.slug, 'title', p.title, 'body', p.body,
        'hero_url', p.hero_url, 'author_name', p.author_name,
        'published_at', p.published_at
      ) ORDER BY p.published_at DESC NULLS LAST)
      FROM public.club_posts p
      WHERE p.club_id = v_row.club_id AND p.status = 'published'
    ), '[]'::jsonb),
    'tournaments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', te.slug, 'name', te.name, 'status', te.status, 'event_date', te.event_date
      ) ORDER BY te.event_date DESC NULLS LAST)
      FROM public.tournament_events te
      WHERE te.club_id = v_row.club_id AND te.status <> 'draft'
    ), '[]'::jsonb),
    -- get-involved CTAs off club_pages.links ([{label,url}])
    'getInvolved', COALESCE(v_row.links, '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_club_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_club_public(text) TO anon, authenticated;

-- ─── 7. club_get_page — club-manager admin read for the wizard / edit dashboard ─
-- Returns the page row at ANY published state (no safeguarding transform — admins
-- edit raw values) + club identity + safeguarding config to prefill the wizard.
-- page = NULL when the club hasn't set up a page yet. Read-only -> no audit.
CREATE OR REPLACE FUNCTION public.club_get_page(p_club_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid;
  v_page jsonb; v_club jsonb; v_cfg jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;

  SELECT to_jsonb(cp) - 'created_at' - 'updated_at' INTO v_page
    FROM club_pages cp WHERE cp.club_id = p_club_id;

  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'short_name', c.short_name,
    'discipline', c.discipline, 'founded_year', c.founded_year,
    'contact_name', c.contact_name, 'contact_email', c.contact_email
  ), COALESCE(c.safeguarding_config, '{}'::jsonb)
  INTO v_club, v_cfg
  FROM clubs c WHERE c.id = p_club_id;
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
REVOKE ALL ON FUNCTION public.club_get_page(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_get_page(text) TO authenticated;
