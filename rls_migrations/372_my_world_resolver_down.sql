-- Down for 372 — drop get_my_world + get_my_assignments, and restore
-- get_my_next_assignment to its mig-369 standalone (user_id-keyed) body.

DROP FUNCTION IF EXISTS public.get_my_world();
DROP FUNCTION IF EXISTS public.get_my_assignments(text);

-- Restore mig 369's original standalone resolver (user_id-keyed, self-contained).
CREATE OR REPLACE FUNCTION public.get_my_next_assignment(p_role_filter text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_games  jsonb;
  v_next   jsonb;
  v_count  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  WITH fixture_arm AS (
    SELECT
      'league'::text AS context,
      'referee'::text AS role,
      1 AS role_priority,
      f.ref_token,
      f.id::text AS game_id,
      ((f.scheduled_date + COALESCE(f.kickoff_time, time '00:00'))
         AT TIME ZONE 'Europe/London') AS kickoff_at,
      f.status,
      (f.status = 'in_progress') AS is_in_progress,
      COALESCE(va.name, mv.name) AS venue_name,
      ht.name AS home_team,
      at.name AS away_team,
      NULL::text AS squad_name
    FROM public.fixtures f
    JOIN public.match_officials mo ON mo.id = f.official_id AND mo.user_id = v_uid
    JOIN public.teams ht ON ht.id = f.home_team_id
    LEFT JOIN public.teams at ON at.id = f.away_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    LEFT JOIN public.venues va ON va.id = pa.venue_id
    LEFT JOIN public.venues mv ON mv.id = mo.venue_id
    WHERE f.status IN ('scheduled', 'allocated', 'in_progress')
      AND (f.status = 'in_progress'
           OR f.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date)
      AND (p_role_filter IS NULL OR p_role_filter = 'league')
  ),
  casual_arm AS (
    SELECT
      'casual'::text AS context,
      'referee'::text AS role,
      2 AS role_priority,
      m.ref_token,
      m.id::text AS game_id,
      s.game_date_time AS kickoff_at,
      (CASE WHEN COALESCE(s.game_is_live, false) AND m.winner IS NULL
            THEN 'in_progress' ELSE 'scheduled' END)::text AS status,
      (COALESCE(s.game_is_live, false) AND m.winner IS NULL) AS is_in_progress,
      s.venue AS venue_name,
      'Team A'::text AS home_team,
      'Team B'::text AS away_team,
      t.name AS squad_name
    FROM public.matches m
    JOIN public.players p ON p.id = m.ref_player_id AND p.user_id = v_uid
    JOIN public.teams t ON t.id = m.team_id
    LEFT JOIN public.schedule s ON s.active_match_id = m.id
    WHERE m.winner IS NULL
      AND COALESCE(m.cancelled, false) = false
      AND (
        COALESCE(s.game_is_live, false) = true
        OR (s.game_date_time IS NOT NULL
            AND s.game_date_time >= (now() AT TIME ZONE 'Europe/London')::date::timestamptz - interval '6 hours')
        OR (s.game_date_time IS NULL AND m.match_date >= (now() AT TIME ZONE 'Europe/London')::date)
      )
      AND (p_role_filter IS NULL OR p_role_filter = 'casual')
  ),
  unioned AS (
    SELECT * FROM fixture_arm
    UNION ALL
    SELECT * FROM casual_arm
  ),
  ordered AS (
    SELECT u.*,
           row_number() OVER (
             ORDER BY is_in_progress DESC, kickoff_at ASC NULLS LAST, role_priority ASC
           ) AS rn
    FROM unioned u
  )
  SELECT
    coalesce(jsonb_agg((to_jsonb(o) - 'rn' - 'role_priority') ORDER BY o.rn), '[]'::jsonb),
    (SELECT to_jsonb(o2) - 'rn' - 'role_priority' FROM ordered o2 WHERE o2.rn = 1),
    count(*)
  INTO v_games, v_next, v_count
  FROM ordered o;

  RETURN jsonb_build_object(
    'ok', true,
    'game_count', v_count,
    'next', v_next,
    'games', v_games
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_next_assignment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_next_assignment(text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
