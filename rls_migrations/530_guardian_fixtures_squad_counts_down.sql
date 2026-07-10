-- 530 DOWN: revert guardian_list_child_fixtures to the mig-426 body (drop the additive
-- 'counts' object on upcoming fixtures). Removing an additive field is backward-safe — the
-- mobile rows read counts?.in defensively and simply stop showing the 'N going' pill.

CREATE OR REPLACE FUNCTION public.guardian_list_child_fixtures(
  p_child_profile_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid            uuid := auth.uid();
  v_caller_profile uuid;
  v_upcoming       jsonb;
  v_recent         jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_caller_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001';
  END IF;

  IF p_child_profile_id <> v_caller_profile AND NOT EXISTS (
    SELECT 1 FROM public.member_guardians
    WHERE guardian_profile_id = v_caller_profile
      AND child_profile_id    = p_child_profile_id
      AND invite_state        = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'scheduled_date'), (row_obj->>'kickoff_time')), '[]'::jsonb)
  INTO v_upcoming
  FROM (
    SELECT jsonb_build_object(
      'fixture_id',      cf.id,
      'league_id',       cf.league_id,
      'league_name',     cl.name,
      'club_team_id',    cf.club_team_id,
      'club_team_name',  COALESCE(cf.club_team_name, ct.name),
      'opponent_name',   cf.opponent_name,
      'is_home',         cf.is_home,
      'scheduled_date',  cf.scheduled_date,
      'kickoff_time',    to_char(cf.kickoff_time, 'HH24:MI'),
      'pitch_name',      pa.name,
      'venue_name',      v.name,
      'ref_name',        COALESCE(mo.name, cf.ref_name),
      'status',          cf.status,
      'own_rsvp_status', a.status
    ) AS row_obj
    FROM public.club_fixtures cf
    JOIN public.club_team_members ctm
      ON ctm.team_id = cf.club_team_id
     AND ctm.member_profile_id = p_child_profile_id
     AND ctm.is_active = true
    LEFT JOIN public.club_leagues  cl ON cl.id = cf.league_id
    LEFT JOIN public.club_teams    ct ON ct.id = cf.club_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = cf.playing_area_id
    LEFT JOIN public.venues        v  ON v.id  = pa.venue_id
    LEFT JOIN public.match_officials mo ON mo.id = cf.official_id
    LEFT JOIN public.club_fixture_availability a
      ON a.fixture_id = cf.id AND a.member_profile_id = p_child_profile_id
    WHERE cf.status = 'scheduled'
      AND cf.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date
  ) up;

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'scheduled_date') DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT jsonb_build_object(
      'fixture_id',     cf.id,
      'league_id',      cf.league_id,
      'league_name',    cl.name,
      'club_team_id',   cf.club_team_id,
      'club_team_name', COALESCE(cf.club_team_name, ct.name),
      'opponent_name',  cf.opponent_name,
      'is_home',        cf.is_home,
      'scheduled_date', cf.scheduled_date,
      'kickoff_time',   to_char(cf.kickoff_time, 'HH24:MI'),
      'home_score',     cf.home_score,
      'away_score',     cf.away_score,
      'status',         cf.status
    ) AS row_obj
    FROM public.club_fixtures cf
    JOIN public.club_team_members ctm
      ON ctm.team_id = cf.club_team_id
     AND ctm.member_profile_id = p_child_profile_id
     AND ctm.is_active = true
    LEFT JOIN public.club_leagues cl ON cl.id = cf.league_id
    LEFT JOIN public.club_teams   ct ON ct.id = cf.club_team_id
    WHERE cf.status = 'completed'
    ORDER BY cf.scheduled_date DESC
    LIMIT 6
  ) rec;

  RETURN jsonb_build_object(
    'ok', true,
    'child_profile_id', p_child_profile_id,
    'upcoming', v_upcoming,
    'recent',   v_recent
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.guardian_list_child_fixtures(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.guardian_list_child_fixtures(uuid) TO anon, authenticated;
