-- Migration 036 — gaffer_get_context_attendance_risk RPC
-- Spec: GAFFER.md (Surfaces → Attendance risk)
--
-- Returns:
--   {
--     team_id,
--     squad_size_target: int,
--     confirmed_in: int,
--     short_by: int,                       -- > 0 means short
--     hours_to_kickoff: numeric | null,
--     declining_regulars: [
--       { id, name, recent_rate, prior_rate, delta }
--     ],
--     not_responded: [{ id, name }],
--     cover_pool_size: int,
--     risk_level: 'none'|'low'|'medium'|'high'
--   }

CREATE OR REPLACE FUNCTION public.gaffer_get_context_attendance_risk(
  p_admin_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id text;
  v_squad_size int;
  v_confirmed_in int;
  v_short_by int;
  v_hours_to_kickoff numeric;
  v_declining jsonb;
  v_not_responded jsonb;
  v_cover_size int;
  v_risk text;
  v_game_dt timestamptz;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT squad_size, game_date_time
    INTO v_squad_size, v_game_dt
  FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;

  IF v_game_dt IS NOT NULL THEN
    v_hours_to_kickoff := EXTRACT(EPOCH FROM (v_game_dt - now())) / 3600.0;
  END IF;

  -- Confirmed IN count
  SELECT COUNT(*)
    INTO v_confirmed_in
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id
    AND COALESCE(p.disabled, false) = false
    AND COALESCE(p.injured, false) = false
    AND p.status = 'in';

  v_short_by := COALESCE(v_squad_size, 0) - v_confirmed_in;

  -- Declining regulars: ≥3 games in last 8 weeks AND last 4 weeks rate dropped
  --   ≥ 25% vs prior 4 weeks
  SELECT COALESCE(jsonb_agg(row_to_jsonb(r) ORDER BY r.delta ASC), '[]'::jsonb)
    INTO v_declining
  FROM (
    SELECT
      p.id, p.name,
      recent.rate AS recent_rate,
      prior.rate AS prior_rate,
      (recent.rate - prior.rate) AS delta
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = v_team_id
    JOIN LATERAL (
      SELECT
        COALESCE(AVG(CASE WHEN pm.attended THEN 1.0 ELSE 0.0 END), 0) AS rate,
        COUNT(*) AS n
      FROM player_match pm
      JOIN matches m ON m.id = pm.match_id
      WHERE pm.team_id = v_team_id
        AND pm.player_id = p.id
        AND m.match_date >= (CURRENT_DATE - INTERVAL '28 days')
        AND m.match_date < CURRENT_DATE
        AND COALESCE(m.cancelled, false) = false
    ) recent ON true
    JOIN LATERAL (
      SELECT
        COALESCE(AVG(CASE WHEN pm.attended THEN 1.0 ELSE 0.0 END), 0) AS rate,
        COUNT(*) AS n
      FROM player_match pm
      JOIN matches m ON m.id = pm.match_id
      WHERE pm.team_id = v_team_id
        AND pm.player_id = p.id
        AND m.match_date >= (CURRENT_DATE - INTERVAL '56 days')
        AND m.match_date < (CURRENT_DATE - INTERVAL '28 days')
        AND COALESCE(m.cancelled, false) = false
    ) prior ON true
    WHERE COALESCE(p.disabled, false) = false
      AND recent.n >= 2
      AND prior.n >= 2
      AND (prior.rate - recent.rate) >= 0.25
  ) r;

  -- Not responded
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)), '[]'::jsonb)
    INTO v_not_responded
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id
    AND COALESCE(p.disabled, false) = false
    AND COALESCE(p.injured, false) = false
    AND COALESCE(p.is_guest, false) = false
    AND (p.status IN ('none', '') OR p.status IS NULL);

  -- Cover pool depth
  SELECT COUNT(*) INTO v_cover_size FROM cover_pool WHERE team_id = v_team_id;

  -- Risk classification
  v_risk := CASE
    WHEN v_short_by <= 0 AND jsonb_array_length(v_declining) = 0 THEN 'none'
    WHEN v_short_by >= 3 AND v_hours_to_kickoff IS NOT NULL AND v_hours_to_kickoff < 24 THEN 'high'
    WHEN v_short_by >= 1 AND v_hours_to_kickoff IS NOT NULL AND v_hours_to_kickoff < 24 THEN 'medium'
    WHEN v_short_by >= 1 OR jsonb_array_length(v_declining) >= 2 THEN 'medium'
    ELSE 'low'
  END;

  RETURN jsonb_build_object(
    'team_id', v_team_id,
    'squad_size_target', v_squad_size,
    'confirmed_in', v_confirmed_in,
    'short_by', v_short_by,
    'hours_to_kickoff', v_hours_to_kickoff,
    'declining_regulars', v_declining,
    'not_responded', v_not_responded,
    'cover_pool_size', v_cover_size,
    'risk_level', v_risk,
    'generated_at', to_jsonb(now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gaffer_get_context_attendance_risk(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gaffer_get_context_attendance_risk(text) TO anon;
