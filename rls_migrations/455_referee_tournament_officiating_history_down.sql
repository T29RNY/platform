-- 455_referee_tournament_officiating_history_down.sql
-- Reverts 455: restores the mig-441 league+casual-only body of
-- get_my_officiating_history and removes the seeded completed tournament fixture.

CREATE OR REPLACE FUNCTION public.get_my_officiating_history(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_person uuid;
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_games  jsonb;
  v_count  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person FROM public.people WHERE auth_user_id = v_uid;
  IF v_person IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'game_count', 0, 'games', '[]'::jsonb);
  END IF;

  WITH fixture_arm AS (
    SELECT
      'league'::text AS context,
      'referee'::text AS role,
      f.ref_token,
      f.id::text AS game_id,
      ((f.scheduled_date + COALESCE(f.kickoff_time, time '00:00'))
         AT TIME ZONE 'Europe/London') AS kickoff_at,
      f.status,
      false AS is_in_progress,
      COALESCE(va.name, mv.name) AS venue_name,
      ht.name AS home_team,
      at.name AS away_team,
      NULL::text AS squad_name,
      f.home_score,
      f.away_score
    FROM public.fixtures f
    JOIN public.match_officials mo ON mo.id = f.official_id AND mo.person_id = v_person
    JOIN public.teams ht ON ht.id = f.home_team_id
    LEFT JOIN public.teams at ON at.id = f.away_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    LEFT JOIN public.venues va ON va.id = pa.venue_id
    LEFT JOIN public.venues mv ON mv.id = mo.venue_id
    WHERE f.status = 'completed'
  ),
  casual_arm AS (
    SELECT
      'casual'::text AS context,
      'referee'::text AS role,
      m.ref_token,
      m.id::text AS game_id,
      COALESCE(s.game_date_time, m.match_date::timestamptz) AS kickoff_at,
      'completed'::text AS status,
      false AS is_in_progress,
      s.venue AS venue_name,
      'Team A'::text AS home_team,
      'Team B'::text AS away_team,
      t.name AS squad_name,
      m.score_a AS home_score,
      m.score_b AS away_score
    FROM public.matches m
    JOIN public.players p ON p.id = m.ref_player_id AND p.person_id = v_person
    JOIN public.teams t ON t.id = m.team_id
    LEFT JOIN public.schedule s ON s.active_match_id = m.id
    WHERE m.winner IS NOT NULL
      AND COALESCE(m.cancelled, false) = false
  ),
  unioned AS (
    SELECT * FROM fixture_arm
    UNION ALL
    SELECT * FROM casual_arm
  ),
  ordered AS (
    SELECT u.*,
           row_number() OVER (ORDER BY kickoff_at DESC NULLS LAST) AS rn
    FROM unioned u
    ORDER BY kickoff_at DESC NULLS LAST
    LIMIT v_limit
  )
  SELECT
    coalesce(jsonb_agg((to_jsonb(o) - 'rn') ORDER BY o.rn), '[]'::jsonb),
    count(*)
  INTO v_games, v_count
  FROM ordered o;

  RETURN jsonb_build_object(
    'ok', true,
    'game_count', v_count,
    'games', v_games
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_officiating_history(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_officiating_history(int) TO authenticated;

DELETE FROM public.fixtures WHERE id = '70000000-0000-4000-8000-000000000646';

SELECT pg_notify('pgrst', 'reload schema');
