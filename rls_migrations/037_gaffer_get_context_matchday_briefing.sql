-- Migration 037 — gaffer_get_context_matchday_briefing RPC
-- Spec: GAFFER.md (Surfaces → Matchday briefing)
--
-- Returns:
--   {
--     team_id, match_id, match_date,
--     squad: { confirmed: [{id, name, vc, bibs_due}], maybe: [...], reserves: [...] },
--     predicted_teams: { team_a:[...], team_b:[...], predicted_winner, predicted_confidence } | null,
--     bib_rotation: { last_holder: {id,name} | null, never_had_bibs: [{id,name}] },
--     in_form_players: [{ id, name, goals_last_4, won_streak }],
--     last_potm: { id, name, match_date } | null,
--     schedule: { day_of_week, kickoff, venue }
--   }

CREATE OR REPLACE FUNCTION public.gaffer_get_context_matchday_briefing(
  p_admin_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id text;
  v_match_id text;
  v_match_date date;
  v_schedule jsonb;
  v_squad jsonb;
  v_predicted jsonb;
  v_bib jsonb;
  v_in_form jsonb;
  v_last_potm jsonb;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT active_match_id, jsonb_build_object(
    'day_of_week', day_of_week,
    'kickoff', kickoff,
    'venue', venue,
    'game_date_time', game_date_time
  )
    INTO v_match_id, v_schedule
  FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;

  SELECT match_date INTO v_match_date FROM matches WHERE id = v_match_id;

  -- Squad: confirmed/maybe/reserve groupings with VC flag
  SELECT jsonb_build_object(
    'confirmed', COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name,
      'vc', tp.is_vice_captain,
      'group_number', tp.group_number
    )) FILTER (WHERE p.status = 'in'), '[]'::jsonb),
    'maybe', COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name
    )) FILTER (WHERE p.status = 'maybe'), '[]'::jsonb),
    'reserves', COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name
    )) FILTER (WHERE p.status = 'reserve'), '[]'::jsonb)
  )
    INTO v_squad
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id
    AND COALESCE(p.disabled, false) = false
    AND COALESCE(p.injured, false) = false;

  -- Predicted teams (if Smart Teams already run for this match)
  SELECT jsonb_build_object(
    'team_a', team_a,
    'team_b', team_b,
    'predicted_winner', predicted_winner,
    'predicted_confidence', predicted_confidence
  )
    INTO v_predicted
  FROM matches WHERE id = v_match_id;

  -- Bib rotation: last holder and players who've never had bibs
  SELECT jsonb_build_object(
    'last_holder', (
      SELECT jsonb_build_object('id', p.id, 'name', p.name)
      FROM bib_history bh
      JOIN players p ON p.id = bh.player_id
      WHERE bh.team_id = v_team_id AND bh.player_id IS NOT NULL
      ORDER BY bh.match_date DESC LIMIT 1
    ),
    'never_had_bibs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name))
      FROM team_players tp
      JOIN players p ON p.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND COALESCE(p.disabled, false) = false
        AND COALESCE(p.is_guest, false) = false
        AND COALESCE(p.bib_count, 0) = 0
    ), '[]'::jsonb)
  )
    INTO v_bib;

  -- In-form players: goals + wins in last 4 matches
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.goals_last_4 DESC), '[]'::jsonb)
    INTO v_in_form
  FROM (
    SELECT
      p.id, p.name,
      SUM(pm.goals) AS goals_last_4,
      SUM(CASE WHEN pm.result = 'w' THEN 1 ELSE 0 END) AS won_streak
    FROM player_match pm
    JOIN players p ON p.id = pm.player_id
    JOIN matches m ON m.id = pm.match_id
    WHERE pm.team_id = v_team_id
      AND COALESCE(m.cancelled, false) = false
      AND m.id IN (
        SELECT id FROM matches
        WHERE team_id = v_team_id AND COALESCE(cancelled,false)=false AND winner IS NOT NULL
        ORDER BY match_date DESC LIMIT 4
      )
    GROUP BY p.id, p.name
    HAVING SUM(pm.goals) > 0 OR SUM(CASE WHEN pm.result='w' THEN 1 ELSE 0 END) >= 3
    ORDER BY SUM(pm.goals) DESC
    LIMIT 5
  ) r;

  -- Last POTM
  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'match_date', m.match_date)
    INTO v_last_potm
  FROM matches m
  JOIN players p ON p.id = m.motm
  WHERE m.team_id = v_team_id AND m.motm IS NOT NULL AND COALESCE(m.cancelled,false)=false
  ORDER BY m.match_date DESC LIMIT 1;

  RETURN jsonb_build_object(
    'team_id', v_team_id,
    'match_id', v_match_id,
    'match_date', v_match_date,
    'schedule', v_schedule,
    'squad', v_squad,
    'predicted_teams', v_predicted,
    'bib_rotation', v_bib,
    'in_form_players', v_in_form,
    'last_potm', v_last_potm,
    'generated_at', to_jsonb(now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gaffer_get_context_matchday_briefing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gaffer_get_context_matchday_briefing(text) TO anon;
