-- 610_trial_cta_gate_down.sql — reverse of 610_trial_cta_gate.sql
-- Restore get_club_public WITHOUT trial_cta_enabled, then drop the column.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_club_public(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_row record; v_sg jsonb; v_min_age int; v_hide_rosters boolean;
BEGIN
  SELECT cp.*, c.name AS club_name, c.short_name AS club_short_name, c.discipline AS club_discipline,
         c.founded_year AS club_founded_year, c.contact_name AS club_contact_name,
         c.contact_email AS club_contact_email, c.safeguarding_config AS safeguarding_config
    INTO v_row FROM public.club_pages cp JOIN public.clubs c ON c.id = cp.club_id WHERE cp.slug = p_slug LIMIT 1;
  IF v_row.club_id IS NULL OR NOT COALESCE(v_row.published, false) THEN RETURN jsonb_build_object('found', false); END IF;
  v_sg := COALESCE(v_row.safeguarding_config, '{}'::jsonb);
  v_min_age := COALESCE(NULLIF(v_sg->>'min_public_age','')::int, 18);
  v_hide_rosters := COALESCE((v_sg->>'hide_public_rosters')::boolean, false);
  RETURN jsonb_build_object('found', true,
    'club', jsonb_build_object('id', v_row.club_id, 'name', v_row.club_name, 'short_name', v_row.club_short_name,
      'discipline', v_row.club_discipline, 'founded_year', v_row.club_founded_year),
    'branding', jsonb_build_object('primary_colour', v_row.primary_colour, 'secondary_colour', v_row.secondary_colour,
      'accent_colour', v_row.accent_colour, 'crest_url', v_row.crest_url, 'hero_url', v_row.hero_url,
      'tagline', v_row.tagline, 'about', v_row.about, 'socials', v_row.socials, 'sections', v_row.sections),
    'teams', COALESCE((SELECT jsonb_agg(jsonb_build_object('cohort_id', cc.id, 'name', cc.name, 'category', cc.category,
        'min_age', cc.min_age, 'max_age', cc.max_age,
        'teams', COALESCE((SELECT jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'gender', t.gender,
          'priority_rank', t.priority_rank,
          'members', CASE WHEN v_hide_rosters THEN '[]'::jsonb ELSE COALESCE((
            SELECT jsonb_agg(jsonb_build_object('member_id', mp.id,
              'name', CASE WHEN (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age)
                THEN mp.first_name || COALESCE(' ' || left(mp.last_name, 1) || '.', '')
                ELSE mp.first_name || COALESCE(' ' || mp.last_name, '') END,
              'is_minor', (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age), 'photo_url', NULL)
              ORDER BY mp.first_name)
            FROM public.club_team_members cm JOIN public.member_profiles mp ON mp.id = cm.member_profile_id
            WHERE cm.team_id = t.id AND cm.is_active = true), '[]'::jsonb) END)
          ORDER BY t.priority_rank NULLS LAST, t.name)
          FROM public.club_teams t WHERE t.cohort_id = cc.id AND t.archived_at IS NULL), '[]'::jsonb))
        ORDER BY cc.name) FROM public.club_cohorts cc WHERE cc.club_id = v_row.club_id AND cc.active = true), '[]'::jsonb),
    'leagues', COALESCE((SELECT jsonb_agg(jsonb_build_object('league_id', cl.id, 'name', cl.name, 'season_label', cl.season_label,
        'fixtures', COALESCE((SELECT jsonb_agg(jsonb_build_object('our_team', COALESCE(f.club_team_name, ct.name),
          'opponent', f.opponent_name, 'is_home', f.is_home, 'scheduled_date', f.scheduled_date,
          'kickoff_time', to_char(f.kickoff_time, 'HH24:MI'), 'home_score', f.home_score,
          'away_score', f.away_score, 'status', f.status) ORDER BY f.scheduled_date NULLS LAST, f.kickoff_time NULLS LAST)
          FROM public.club_fixtures f LEFT JOIN public.club_teams ct ON ct.id = f.club_team_id
          WHERE f.league_id = cl.id AND f.status <> 'void'), '[]'::jsonb))
        ORDER BY cl.created_at) FROM public.club_leagues cl WHERE cl.club_id = v_row.club_id AND cl.archived_at IS NULL), '[]'::jsonb),
    'sponsors', COALESCE((SELECT jsonb_agg(jsonb_build_object('sponsor_id', s.id, 'name', s.name,
        'logo_url', s.logo_url, 'website_url', s.website_url, 'tier', s.tier) ORDER BY s.display_order, s.name)
        FROM public.club_sponsors s WHERE s.club_id = v_row.club_id AND s.active = true), '[]'::jsonb),
    'news', COALESCE((SELECT jsonb_agg(jsonb_build_object('post_id', p.id, 'slug', p.slug, 'title', p.title,
        'body', p.body, 'hero_url', p.hero_url, 'author_name', p.author_name, 'published_at', p.published_at)
        ORDER BY p.published_at DESC NULLS LAST) FROM public.club_posts p
        WHERE p.club_id = v_row.club_id AND p.status = 'published'), '[]'::jsonb),
    'tournaments', COALESCE((SELECT jsonb_agg(jsonb_build_object('slug', te.slug, 'name', te.name, 'status', te.status,
        'event_date', te.event_date) ORDER BY te.event_date DESC NULLS LAST) FROM public.tournament_events te
        WHERE te.club_id = v_row.club_id AND te.status <> 'draft'), '[]'::jsonb),
    'getInvolved', COALESCE(v_row.links, '[]'::jsonb),
    'contacts', jsonb_build_object('contact_name', v_row.club_contact_name, 'contact_email', v_row.club_contact_email,
      'welfareOfficer', (SELECT jsonb_build_object('name', cm.name, 'email', cm.email) FROM public.club_committee cm
        WHERE cm.club_id = v_row.club_id AND cm.is_welfare = true ORDER BY cm.display_order, cm.name LIMIT 1),
      'committee', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', cm.role, 'name', cm.name, 'email', cm.email)
        ORDER BY cm.display_order, cm.name) FROM public.club_committee cm
        WHERE cm.club_id = v_row.club_id AND cm.is_welfare = false), '[]'::jsonb)),
    'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', d.title, 'url', d.url, 'type', d.doc_type,
        'size', d.size_label) ORDER BY d.display_order, d.created_at) FROM public.club_documents d
        WHERE d.club_id = v_row.club_id), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', e.title, 'date', e.event_date, 'blurb', e.blurb)
        ORDER BY e.event_date NULLS LAST, e.display_order) FROM public.club_events e
        WHERE e.club_id = v_row.club_id), '[]'::jsonb),
    'stats', CASE WHEN v_hide_rosters THEN '{}'::jsonb ELSE COALESCE((
      SELECT jsonb_object_agg(t.id::text, jsonb_build_object(
        'potm', CASE WHEN pm.team_id IS NOT NULL THEN jsonb_build_object('name', pm.name, 'month', pm.month) ELSE NULL END,
        'topScorer', (
          SELECT jsonb_build_object(
            'name', CASE WHEN (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age)
              THEN mp.first_name || COALESCE(' ' || left(mp.last_name, 1) || '.', '')
              ELSE mp.first_name || COALESCE(' ' || mp.last_name, '') END,
            'goals', ld.total_goals)
          FROM (SELECT s.member_profile_id, SUM(s.goals) AS total_goals FROM public.club_fixture_player_stats s
                JOIN public.club_fixtures cf ON cf.id = s.fixture_id
                WHERE cf.club_team_id = t.id AND cf.status <> 'void'
                GROUP BY s.member_profile_id HAVING SUM(s.goals) > 0
                ORDER BY SUM(s.goals) DESC, s.member_profile_id LIMIT 1) ld
          JOIN public.member_profiles mp ON mp.id = ld.member_profile_id),
        'reliability', '[]'::jsonb))
      FROM public.club_teams t
      LEFT JOIN public.club_team_potm pm ON pm.team_id = t.id
      LEFT JOIN public.club_cohorts cc ON cc.id = t.cohort_id
      WHERE t.club_id = v_row.club_id AND t.archived_at IS NULL
        AND NOT (COALESCE(cc.category,'') = 'youth' OR (cc.max_age IS NOT NULL AND cc.max_age < v_min_age))
        AND (pm.team_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.club_fixture_player_stats s2
             JOIN public.club_fixtures cf2 ON cf2.id = s2.fixture_id WHERE cf2.club_team_id = t.id AND cf2.status <> 'void'))
    ), '{}'::jsonb) END
  );
END;
$function$;

ALTER TABLE public.club_pages DROP COLUMN IF EXISTS trial_cta_enabled;

COMMIT;
