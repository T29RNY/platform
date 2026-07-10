-- 526 DOWN: revert club_manager_list_team_fixtures() to the mig-451 roster shape
-- (roster rows { name, status } — drop the additive 'member_profile_id'). Everything
-- else identical. Removing an additive field is safe: consumers that read it simply
-- get undefined again (the pre-P5 state).

CREATE OR REPLACE FUNCTION public.club_manager_list_team_fixtures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_teams   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'team_id',   ct.id,
      'team_name', ct.name,
      'club_id',   ct.club_id,
      'upcoming',  up.upcoming,
      'recent',    rc.recent
    ) ORDER BY ct.name
  ), '[]'::jsonb)
  INTO v_teams
  FROM club_team_managers ctm
  JOIN club_teams ct ON ct.id = ctm.team_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(fx ORDER BY (fx->>'scheduled_date') NULLS LAST, (fx->>'kickoff_time')), '[]'::jsonb) AS upcoming
    FROM (
      SELECT jsonb_build_object(
        'fixture_id',     cf.id,
        'opponent_name',  cf.opponent_name,
        'is_home',        cf.is_home,
        'scheduled_date', cf.scheduled_date,
        'kickoff_time',   to_char(cf.kickoff_time, 'HH24:MI'),
        'league_name',    cl.name,
        'pitch_name',     pa.name,
        'venue_name',     v.name,
        'ref_name',       COALESCE(mo.name, cf.ref_name),
        'notes',          cf.notes,
        'source',         cf.source,
        'status',         cf.status,
        'counts',         av.counts,
        'roster',         av.roster
      ) AS fx
      FROM club_fixtures cf
      LEFT JOIN club_leagues    cl ON cl.id = cf.league_id
      LEFT JOIN playing_areas   pa ON pa.id = cf.playing_area_id
      LEFT JOIN venues          v  ON v.id  = pa.venue_id
      LEFT JOIN match_officials mo ON mo.id = cf.official_id
      CROSS JOIN LATERAL (
        SELECT
          jsonb_build_object(
            'in',      count(*) FILTER (WHERE st = 'in'),
            'out',     count(*) FILTER (WHERE st = 'out'),
            'maybe',   count(*) FILTER (WHERE st = 'maybe'),
            'pending', count(*) FILTER (WHERE st = 'pending'),
            'total',   count(*)
          ) AS counts,
          COALESCE(jsonb_agg(jsonb_build_object('name', nm, 'status', st) ORDER BY nm), '[]'::jsonb) AS roster
        FROM (
          SELECT btrim(concat_ws(' ', mp.first_name, mp.last_name)) AS nm,
                 COALESCE(a.status, 'pending') AS st
          FROM club_team_members m
          JOIN member_profiles mp ON mp.id = m.member_profile_id
          LEFT JOIN club_fixture_availability a
            ON a.fixture_id = cf.id AND a.member_profile_id = m.member_profile_id
          WHERE m.team_id = ct.id AND m.is_active = true
        ) r
      ) av
      WHERE cf.club_team_id = ct.id
        AND cf.status = 'scheduled'
        AND (cf.scheduled_date IS NULL OR cf.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date)
    ) up_inner
  ) up
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(fx ORDER BY (fx->>'scheduled_date') DESC), '[]'::jsonb) AS recent
    FROM (
      SELECT jsonb_build_object(
        'fixture_id',     cf.id,
        'opponent_name',  cf.opponent_name,
        'is_home',        cf.is_home,
        'scheduled_date', cf.scheduled_date,
        'kickoff_time',   to_char(cf.kickoff_time, 'HH24:MI'),
        'home_score',     cf.home_score,
        'away_score',     cf.away_score,
        'league_name',    cl.name,
        'source',         cf.source,
        'status',         cf.status
      ) AS fx
      FROM club_fixtures cf
      LEFT JOIN club_leagues cl ON cl.id = cf.league_id
      WHERE cf.club_team_id = ct.id AND cf.status = 'completed'
      ORDER BY cf.scheduled_date DESC NULLS LAST
      LIMIT 6
    ) rec_inner
  ) rc
  WHERE ctm.member_profile_id = v_profile
    AND ctm.is_active = true;

  IF v_teams = '[]'::jsonb THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'teams', v_teams);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_list_team_fixtures() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_list_team_fixtures() TO authenticated;
