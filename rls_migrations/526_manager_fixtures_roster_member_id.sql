-- 526: Manager /hub build-out P5 — add member_profile_id to the availability roster.
--
-- club_manager_list_team_fixtures() (mig 451) returns each upcoming fixture's roster as
-- [{name, status}] only — no id — so the Tonight/League availability rows can't open the
-- coach member-detail sheet (club_manager_get_member_detail needs a member_profile_id),
-- while the People roster (which HAS profile_id from club_manager_get_team_members) can.
-- This ADDITIVE change carries member_profile_id through the roster subquery so every
-- roster row across the coach track is tappable to the same detail sheet.
--
-- ADDITIVE ONLY: the roster object gains one field ('member_profile_id'); every existing
-- consumer (TeamManagerLeague / TeamManagerTonight / TeamManagerPeople) ignores unknown
-- fields, so no return-shape break (Hard Rule 7/12 — no dbToPlayer-style mapper; the screens
-- read roster fields directly). Read-only RPC (STABLE-shaped, no writes) → no EV. Auth,
-- grants, search_path, overload all UNCHANGED from 451.
--
-- Consumers (Hard Rule #14): apps/inorout TeamManagerLeague.jsx (/hub league tab),
-- TeamManagerTonight.jsx (tonight tab), TeamManagerPeople.jsx (people tab — detail sheet).

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
    -- Upcoming: scheduled, today-onward (or undated), each with the availability
    -- roster + counts. Pending = an active roster member with no row (or status 'pending').
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
          COALESCE(jsonb_agg(jsonb_build_object('member_profile_id', pid, 'name', nm, 'status', st) ORDER BY nm), '[]'::jsonb) AS roster
        FROM (
          SELECT m.member_profile_id AS pid,
                 btrim(concat_ws(' ', mp.first_name, mp.last_name)) AS nm,
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
    -- Recent: completed fixtures (scores), most recent 6.
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

  -- Not an active manager of any team → reject (mirrors the mig-446 not_authorised gate).
  IF v_teams = '[]'::jsonb THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'teams', v_teams);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_list_team_fixtures() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_list_team_fixtures() TO authenticated;
