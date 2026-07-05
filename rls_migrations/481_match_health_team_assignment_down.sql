-- 481 DOWN: restore get_match_health_for_match to the mig-475 body VERBATIM (drops team_assignment).
-- No signature change → CREATE OR REPLACE back to the prior body; grants unchanged.

CREATE OR REPLACE FUNCTION get_match_health_for_match(p_match_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_rows    jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_match_ref IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.is_self DESC, r.ended_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.id                                   AS session_id,
      (s.user_id = v_user_id)                AS is_self,
      COALESCE(disp.name, 'Player')          AS player_name,
      s.match_context,
      s.duration_seconds,
      s.active_energy_kcal,
      s.distance_meters,
      s.avg_hr,
      s.max_hr,
      s.hr_zones,
      s.source,
      EXISTS (SELECT 1 FROM match_health_routes mr WHERE mr.session_id = s.id) AS has_route,
      s.started_at,
      s.ended_at
    FROM match_health_sessions s
    LEFT JOIN LATERAL (
      SELECT p.name, p.share_match_fitness
        FROM players p
        JOIN team_players tp ON tp.player_id = p.id
        JOIN matches m       ON m.id = s.match_ref AND m.team_id = tp.team_id
       WHERE p.user_id = s.user_id
       LIMIT 1
    ) disp ON true
    WHERE s.match_ref = p_match_ref
      AND NOT _health_is_under_18(s.user_id)
      AND (
        s.user_id = v_user_id
        OR (s.match_context = 'casual' AND COALESCE(disp.share_match_fitness, false) = true)
      )
  ) r;

  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION get_match_health_for_match(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION get_match_health_for_match(text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
