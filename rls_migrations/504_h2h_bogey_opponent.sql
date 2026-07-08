-- Migration 504 — H2H bogey opponent (real): widen both H2H raw readers
--
-- WHY: getHeadToHead (packages/core/storage/supabase.js) computes a "bogey
-- opponent" — the third player who, when me+them play TOGETHER (same team),
-- beats the pair most often. To aggregate that client-side we need each
-- together-match's OPPOSING roster and each opponent's own result. Both
-- SECURITY DEFINER readers (mig 041 admin-token, mig 348 player-token) plus
-- the JS direct-read fallback are widened in lockstep with a fourth,
-- ADDITIVE return key `opponent_rows`. Signatures unchanged (CREATE OR
-- REPLACE, no DROP). Read-only.
--
-- opponent_rows: [{ player_id, match_id, result, name }]
--   Attended players on the side OPPOSING the pair, in every match where
--   me+them shared a team_assignment. `result` is the OPPONENT'S own result
--   ('w' = the opponent's side beat the pair). Excludes me/them themselves.
--   `name` = COALESCE(NULLIF(nickname,''), name).
--
-- THIRD-PARTY DISCLOSURE: this surfaces a third team-member's per-match result
-- versus the compared pair to the token caller. Operator sign-off GIVEN
-- (H2H_FUN_ADDITIONS_HANDOFF.md PR#7). Scope is strictly within-team, within
-- shared appearances — the same audience that already sees these matches on
-- the board and in Results.

CREATE OR REPLACE FUNCTION public.get_head_to_head_raw_by_admin_token(
  p_admin_token text,
  p_me_id       text,
  p_them_id     text,
  p_period      text DEFAULT 'all'   -- 'month' | 'season' | 'all'
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
  v_opp      jsonb;
BEGIN
  -- Resolve team from admin token (never trust client-supplied team_id)
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  -- Compute period cutoff server-side (mirrors scoring.js periodCutoff)
  IF p_period = 'month' THEN
    v_cutoff := date_trunc('month', CURRENT_DATE)::date;
  ELSIF p_period = 'season' THEN
    v_cutoff := (extract(year FROM CURRENT_DATE)::text || '-01-01')::date;
  ELSE
    v_cutoff := NULL;
  END IF;

  -- All-time matches (for dominantType detection)
  SELECT COALESCE(jsonb_agg(to_jsonb(m_row)), '[]'::jsonb)
    INTO v_all_time
  FROM (
    SELECT id, match_date, score_a, score_b, winner, score_type, cancelled
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
  ) m_row;

  -- Period-filtered matches
  SELECT COALESCE(jsonb_agg(to_jsonb(m_row)), '[]'::jsonb)
    INTO v_period
  FROM (
    SELECT id, match_date, score_a, score_b, winner, score_type, cancelled
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
      AND (v_cutoff IS NULL OR match_date >= v_cutoff)
  ) m_row;

  -- player_match rows for both players (attended only)
  SELECT COALESCE(jsonb_agg(to_jsonb(pm_row)), '[]'::jsonb)
    INTO v_pm
  FROM (
    SELECT player_id, match_id, team_assignment, result, goals, was_motm, had_bibs
    FROM player_match
    WHERE team_id = v_team_id
      AND player_id IN (p_me_id, p_them_id)
      AND attended = true
  ) pm_row;

  -- Opposing-side attended players in together-matches (bogey opponent source)
  SELECT COALESCE(jsonb_agg(to_jsonb(o_row)), '[]'::jsonb)
    INTO v_opp
  FROM (
    SELECT opp.player_id,
           opp.match_id,
           opp.result,
           COALESCE(NULLIF(pl.nickname, ''), pl.name) AS name
    FROM player_match opp
    JOIN (
      SELECT me.match_id, me.team_assignment AS pair_side
      FROM player_match me
      JOIN player_match them
        ON them.match_id  = me.match_id
       AND them.team_id   = me.team_id
       AND them.player_id = p_them_id
       AND them.attended  = true
       AND them.team_assignment IS NOT NULL
      WHERE me.team_id = v_team_id
        AND me.player_id = p_me_id
        AND me.attended  = true
        AND me.team_assignment IS NOT NULL
        AND me.team_assignment = them.team_assignment
    ) pair ON pair.match_id = opp.match_id
    JOIN players pl ON pl.id = opp.player_id
    WHERE opp.team_id = v_team_id
      AND opp.attended = true
      AND opp.player_id NOT IN (p_me_id, p_them_id)
      AND opp.team_assignment IS NOT NULL
      AND opp.team_assignment IS DISTINCT FROM pair.pair_side
  ) o_row;

  RETURN jsonb_build_object(
    'all_time_matches',  v_all_time,
    'period_matches',    v_period,
    'player_match_rows', v_pm,
    'opponent_rows',     v_opp
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_head_to_head_raw_by_admin_token(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_head_to_head_raw_by_admin_token(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_head_to_head_raw_by_admin_token(text, text, text, text) TO anon;
-- ^ anon allowed because admin_token is the auth signal (same pattern as other admin RPCs)


CREATE OR REPLACE FUNCTION public.get_head_to_head_raw_by_player_token(
  p_token   text,
  p_me_id   text,
  p_them_id text,
  p_period  text DEFAULT 'all'   -- 'month' | 'season' | 'all'
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
  v_opp       jsonb;
BEGIN
  -- Resolve caller's player + team from the token (never trust a client team_id)
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT team_id INTO v_team_id FROM team_players
  WHERE player_id = v_player_id ORDER BY created_at ASC LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  -- Compute period cutoff server-side (mirrors scoring.js periodCutoff)
  IF p_period = 'month' THEN
    v_cutoff := date_trunc('month', CURRENT_DATE)::date;
  ELSIF p_period = 'season' THEN
    v_cutoff := (extract(year FROM CURRENT_DATE)::text || '-01-01')::date;
  ELSE
    v_cutoff := NULL;
  END IF;

  -- All-time matches (for dominantType detection)
  SELECT COALESCE(jsonb_agg(to_jsonb(m_row)), '[]'::jsonb)
    INTO v_all_time
  FROM (
    SELECT id, match_date, score_a, score_b, winner, score_type, cancelled
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
  ) m_row;

  -- Period-filtered matches
  SELECT COALESCE(jsonb_agg(to_jsonb(m_row)), '[]'::jsonb)
    INTO v_period
  FROM (
    SELECT id, match_date, score_a, score_b, winner, score_type, cancelled
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
      AND (v_cutoff IS NULL OR match_date >= v_cutoff)
  ) m_row;

  -- player_match rows for both players (attended only), scoped to this team
  SELECT COALESCE(jsonb_agg(to_jsonb(pm_row)), '[]'::jsonb)
    INTO v_pm
  FROM (
    SELECT player_id, match_id, team_assignment, result, goals, was_motm, had_bibs
    FROM player_match
    WHERE team_id = v_team_id
      AND player_id IN (p_me_id, p_them_id)
      AND attended = true
  ) pm_row;

  -- Opposing-side attended players in together-matches (bogey opponent source)
  SELECT COALESCE(jsonb_agg(to_jsonb(o_row)), '[]'::jsonb)
    INTO v_opp
  FROM (
    SELECT opp.player_id,
           opp.match_id,
           opp.result,
           COALESCE(NULLIF(pl.nickname, ''), pl.name) AS name
    FROM player_match opp
    JOIN (
      SELECT me.match_id, me.team_assignment AS pair_side
      FROM player_match me
      JOIN player_match them
        ON them.match_id  = me.match_id
       AND them.team_id   = me.team_id
       AND them.player_id = p_them_id
       AND them.attended  = true
       AND them.team_assignment IS NOT NULL
      WHERE me.team_id = v_team_id
        AND me.player_id = p_me_id
        AND me.attended  = true
        AND me.team_assignment IS NOT NULL
        AND me.team_assignment = them.team_assignment
    ) pair ON pair.match_id = opp.match_id
    JOIN players pl ON pl.id = opp.player_id
    WHERE opp.team_id = v_team_id
      AND opp.attended = true
      AND opp.player_id NOT IN (p_me_id, p_them_id)
      AND opp.team_assignment IS NOT NULL
      AND opp.team_assignment IS DISTINCT FROM pair.pair_side
  ) o_row;

  RETURN jsonb_build_object(
    'all_time_matches',  v_all_time,
    'period_matches',    v_period,
    'player_match_rows', v_pm,
    'opponent_rows',     v_opp
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_head_to_head_raw_by_player_token(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_head_to_head_raw_by_player_token(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_head_to_head_raw_by_player_token(text, text, text, text) TO authenticated;
-- ^ anon allowed because the player token is the auth signal (same pattern as
--   get_team_state_by_player_token and the other player-token RPCs)
