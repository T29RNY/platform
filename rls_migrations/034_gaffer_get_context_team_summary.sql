-- Migration 034 — gaffer_get_context_team_summary RPC
-- Spec: GAFFER.md (Surfaces → Team summary)
--
-- Returns jsonb context block consumed by the team_summary system prompt:
--   {
--     team: { id, name, group_name },
--     schedule: { day_of_week, kickoff, venue, squad_size, price_per_player, game_is_live, is_cancelled },
--     this_week: {
--       in: int, out: int, maybe: int, reserve: int, no_response: int,
--       no_response_players: [{ id, name }],
--       confirmed_short_by: int     -- negative if over-subscribed
--     },
--     recent_form: [{ match_date, winner, score_a, score_b }],  -- last 5
--     top_scorer_30d: { id, name, goals } | null,
--     top_reliable_30d: { id, name, attended, total } | null,
--     last_potm: { id, name, match_date } | null
--   }

CREATE OR REPLACE FUNCTION public.gaffer_get_context_team_summary(
  p_admin_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id text;
  v_team_name text;
  v_group_name text;
  v_schedule jsonb;
  v_this_week jsonb;
  v_recent jsonb;
  v_top_scorer jsonb;
  v_top_reliable jsonb;
  v_last_potm jsonb;
  v_squad_size int;
BEGIN
  -- Resolve team from admin token (never trust client)
  SELECT t.id, t.name, COALESCE(s.group_name, t.name)
    INTO v_team_id, v_team_name, v_group_name
  FROM teams t
  LEFT JOIN settings s ON s.team_id = t.id
  WHERE t.admin_token = p_admin_token;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  -- Schedule block
  SELECT jsonb_build_object(
    'day_of_week', sch.day_of_week,
    'kickoff', sch.kickoff,
    'venue', sch.venue,
    'squad_size', sch.squad_size,
    'price_per_player', sch.price_per_player,
    'game_is_live', sch.game_is_live,
    'is_cancelled', sch.is_cancelled,
    'game_date_time', sch.game_date_time
  ), sch.squad_size
    INTO v_schedule, v_squad_size
  FROM schedule sch
  WHERE sch.team_id = v_team_id
    AND sch.active = true
  LIMIT 1;

  -- This week status counts via team_players (players.team is A/B not team_id)
  SELECT jsonb_build_object(
    'in', COUNT(*) FILTER (WHERE p.status = 'in'),
    'out', COUNT(*) FILTER (WHERE p.status = 'out'),
    'maybe', COUNT(*) FILTER (WHERE p.status = 'maybe'),
    'reserve', COUNT(*) FILTER (WHERE p.status = 'reserve'),
    'no_response', COUNT(*) FILTER (WHERE p.status IN ('none', '') OR p.status IS NULL),
    'no_response_players', COALESCE(
      jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name))
        FILTER (WHERE p.status IN ('none', '') OR p.status IS NULL),
      '[]'::jsonb
    ),
    'confirmed_short_by', COALESCE(v_squad_size, 0) - COUNT(*) FILTER (WHERE p.status = 'in')::int
  )
    INTO v_this_week
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id
    AND COALESCE(p.disabled, false) = false
    AND COALESCE(p.is_guest, false) = false
    AND COALESCE(p.injured, false) = false;

  -- Recent form: last 5 completed matches
  SELECT COALESCE(jsonb_agg(to_jsonb(m_row) ORDER BY m_row.match_date DESC), '[]'::jsonb)
    INTO v_recent
  FROM (
    SELECT m.match_date, m.winner, m.score_a, m.score_b
    FROM matches m
    WHERE m.team_id = v_team_id
      AND COALESCE(m.cancelled, false) = false
      AND m.winner IS NOT NULL
    ORDER BY m.match_date DESC
    LIMIT 5
  ) m_row;

  -- Top scorer in last 30 days
  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'goals', SUM(pm.goals))
    INTO v_top_scorer
  FROM player_match pm
  JOIN players p ON p.id = pm.player_id
  JOIN matches m ON m.id = pm.match_id
  WHERE pm.team_id = v_team_id
    AND m.match_date >= (CURRENT_DATE - INTERVAL '30 days')
    AND COALESCE(m.cancelled, false) = false
  GROUP BY p.id, p.name
  HAVING SUM(pm.goals) > 0
  ORDER BY SUM(pm.goals) DESC
  LIMIT 1;

  -- Top reliable in last 30 days (min 3 squad games to be considered)
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'attended', SUM(CASE WHEN pm.attended THEN 1 ELSE 0 END),
    'total', COUNT(*)
  )
    INTO v_top_reliable
  FROM player_match pm
  JOIN players p ON p.id = pm.player_id
  JOIN matches m ON m.id = pm.match_id
  WHERE pm.team_id = v_team_id
    AND m.match_date >= (CURRENT_DATE - INTERVAL '30 days')
    AND COALESCE(m.cancelled, false) = false
  GROUP BY p.id, p.name
  HAVING COUNT(*) >= 3
  ORDER BY (SUM(CASE WHEN pm.attended THEN 1 ELSE 0 END)::float / COUNT(*)) DESC, COUNT(*) DESC
  LIMIT 1;

  -- Last POTM
  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'match_date', m.match_date)
    INTO v_last_potm
  FROM matches m
  JOIN players p ON p.id = m.motm
  WHERE m.team_id = v_team_id
    AND m.motm IS NOT NULL
    AND COALESCE(m.cancelled, false) = false
  ORDER BY m.match_date DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'team', jsonb_build_object('id', v_team_id, 'name', v_team_name, 'group_name', v_group_name),
    'schedule', COALESCE(v_schedule, '{}'::jsonb),
    'this_week', COALESCE(v_this_week, '{}'::jsonb),
    'recent_form', v_recent,
    'top_scorer_30d', v_top_scorer,
    'top_reliable_30d', v_top_reliable,
    'last_potm', v_last_potm,
    'generated_at', to_jsonb(now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gaffer_get_context_team_summary(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gaffer_get_context_team_summary(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.gaffer_get_context_team_summary(text) TO anon;
-- ^ anon is fine because admin_token is the auth signal (same pattern as other admin RPCs)
