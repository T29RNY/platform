-- 449 DOWN: revert Modular Platform Epic B Phase 5b.
-- Drops the P5b RPCs + new tables, removes the demo seed, and restores
-- get_club_public to the mig-448 body (without contacts/documents/events/stats).

-- ─── demo seed ────────────────────────────────────────────────────────────────
DELETE FROM public.club_team_potm WHERE team_id = 'c0000000-0000-4000-8000-000000000001';
DELETE FROM public.club_events     WHERE id IN (
  'db000000-0000-4000-8000-000000000001','db000000-0000-4000-8000-000000000002','db000000-0000-4000-8000-000000000003');
DELETE FROM public.club_documents  WHERE id IN (
  'da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002',
  'da000000-0000-4000-8000-000000000003','da000000-0000-4000-8000-000000000004');
DELETE FROM public.club_committee  WHERE id IN (
  'd9000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000002',
  'd9000000-0000-4000-8000-000000000003','d9000000-0000-4000-8000-000000000004');

-- ─── RPCs ─────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.club_add_committee_member(text,text,text,text,boolean,int);
DROP FUNCTION IF EXISTS public.club_update_committee_member(uuid,text,text,text,boolean,int);
DROP FUNCTION IF EXISTS public.club_remove_committee_member(uuid);
DROP FUNCTION IF EXISTS public.club_list_committee(text);
DROP FUNCTION IF EXISTS public.club_add_document(text,text,text,text,text,int);
DROP FUNCTION IF EXISTS public.club_update_document(uuid,text,text,text,text,int);
DROP FUNCTION IF EXISTS public.club_remove_document(uuid);
DROP FUNCTION IF EXISTS public.club_list_documents(text);
DROP FUNCTION IF EXISTS public.club_add_event(text,text,date,text,int);
DROP FUNCTION IF EXISTS public.club_update_event(uuid,text,date,text,int);
DROP FUNCTION IF EXISTS public.club_remove_event(uuid);
DROP FUNCTION IF EXISTS public.club_list_events(text);
DROP FUNCTION IF EXISTS public.club_set_potm(uuid,text,text);
DROP FUNCTION IF EXISTS public.club_remove_potm(uuid);
DROP FUNCTION IF EXISTS public.club_list_potm(text);

-- ─── tables ───────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.club_team_potm;
DROP TABLE IF EXISTS public.club_events;
DROP TABLE IF EXISTS public.club_documents;
DROP TABLE IF EXISTS public.club_committee;

-- ─── get_club_public — restore mig-448 body (no P5b slices) ────────────────────
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
    'getInvolved', COALESCE(v_row.links, '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_club_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_club_public(text) TO anon, authenticated;
