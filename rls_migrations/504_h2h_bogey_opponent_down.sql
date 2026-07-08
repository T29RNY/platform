-- Down 504 — restore the pre-bogey 3-key H2H readers (migs 041 + 348).
-- Drops the additive `opponent_rows` return key. Signatures unchanged.

CREATE OR REPLACE FUNCTION public.get_head_to_head_raw_by_admin_token(
  p_admin_token text,
  p_me_id       text,
  p_them_id     text,
  p_period      text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id text;
  v_cutoff  date;
  v_all_time jsonb;
  v_period   jsonb;
  v_pm       jsonb;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  IF p_period = 'month' THEN
    v_cutoff := date_trunc('month', CURRENT_DATE)::date;
  ELSIF p_period = 'season' THEN
    v_cutoff := (extract(year FROM CURRENT_DATE)::text || '-01-01')::date;
  ELSE
    v_cutoff := NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(m_row)), '[]'::jsonb)
    INTO v_all_time
  FROM (
    SELECT id, match_date, score_a, score_b, winner, score_type, cancelled
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
  ) m_row;

  SELECT COALESCE(jsonb_agg(to_jsonb(m_row)), '[]'::jsonb)
    INTO v_period
  FROM (
    SELECT id, match_date, score_a, score_b, winner, score_type, cancelled
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
      AND (v_cutoff IS NULL OR match_date >= v_cutoff)
  ) m_row;

  SELECT COALESCE(jsonb_agg(to_jsonb(pm_row)), '[]'::jsonb)
    INTO v_pm
  FROM (
    SELECT player_id, match_id, team_assignment, result, goals, was_motm, had_bibs
    FROM player_match
    WHERE team_id = v_team_id
      AND player_id IN (p_me_id, p_them_id)
      AND attended = true
  ) pm_row;

  RETURN jsonb_build_object(
    'all_time_matches',  v_all_time,
    'period_matches',    v_period,
    'player_match_rows', v_pm
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_head_to_head_raw_by_admin_token(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_head_to_head_raw_by_admin_token(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_head_to_head_raw_by_admin_token(text, text, text, text) TO anon;


CREATE OR REPLACE FUNCTION public.get_head_to_head_raw_by_player_token(
  p_token   text,
  p_me_id   text,
  p_them_id text,
  p_period  text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_cutoff    date;
  v_all_time  jsonb;
  v_period    jsonb;
  v_pm        jsonb;
BEGIN
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT team_id INTO v_team_id FROM team_players
  WHERE player_id = v_player_id ORDER BY created_at ASC LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  IF p_period = 'month' THEN
    v_cutoff := date_trunc('month', CURRENT_DATE)::date;
  ELSIF p_period = 'season' THEN
    v_cutoff := (extract(year FROM CURRENT_DATE)::text || '-01-01')::date;
  ELSE
    v_cutoff := NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(m_row)), '[]'::jsonb)
    INTO v_all_time
  FROM (
    SELECT id, match_date, score_a, score_b, winner, score_type, cancelled
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
  ) m_row;

  SELECT COALESCE(jsonb_agg(to_jsonb(m_row)), '[]'::jsonb)
    INTO v_period
  FROM (
    SELECT id, match_date, score_a, score_b, winner, score_type, cancelled
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
      AND (v_cutoff IS NULL OR match_date >= v_cutoff)
  ) m_row;

  SELECT COALESCE(jsonb_agg(to_jsonb(pm_row)), '[]'::jsonb)
    INTO v_pm
  FROM (
    SELECT player_id, match_id, team_assignment, result, goals, was_motm, had_bibs
    FROM player_match
    WHERE team_id = v_team_id
      AND player_id IN (p_me_id, p_them_id)
      AND attended = true
  ) pm_row;

  RETURN jsonb_build_object(
    'all_time_matches',  v_all_time,
    'period_matches',    v_period,
    'player_match_rows', v_pm
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_head_to_head_raw_by_player_token(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_head_to_head_raw_by_player_token(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_head_to_head_raw_by_player_token(text, text, text, text) TO authenticated;
