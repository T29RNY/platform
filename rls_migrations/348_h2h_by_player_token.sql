-- Migration 348 — get_head_to_head_raw_by_player_token
--
-- WHY: getHeadToHead in supabase.js has two data paths. The admin-token path
-- routes through a SECURITY DEFINER RPC (migration 041) and works. The
-- fallback "direct-read" path does three direct .from() reads against
-- matches + player_match. player_match has RLS enabled with NO select policy
-- or grant for anon/authenticated, so those reads return zero rows for every
-- non-admin caller. On a player route (/p/<token>) isAdmin is false, so
-- adminToken is null, so getHeadToHead takes the dead direct-read path and
-- Head-to-Head renders the empty "you haven't played together" state for
-- EVERY player, regardless of actual shared games.
--
-- This mirrors migration 041 but resolves team_id from a player token (same
-- pattern as get_team_state_by_player_token: players.token -> team_players).
-- Read-only; returns the identical shape to the admin-token variant.
--
-- Returns:
--   {
--     all_time_matches: [{ id, match_date, score_a, score_b, winner, score_type, cancelled }],
--     period_matches:   [{ id, match_date, score_a, score_b, winner, score_type, cancelled }],
--     player_match_rows:[{ player_id, match_id, team_assignment, result, goals, was_motm, had_bibs }]
--   }

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
-- ^ anon allowed because the player token is the auth signal (same pattern as
--   get_team_state_by_player_token and the other player-token RPCs)


-- get_player_league_table_raw_by_player_token
--
-- Same RLS gap, same modal: HeadToHead's "Overall Comparison" section (and the
-- in-modal ranking strip) calls getPlayerLeagueTable, whose direct-read fallback
-- also reads player_match and so returns nothing on a player route. Mirror of
-- get_player_league_table_raw_by_admin_token, keyed by player token.

CREATE OR REPLACE FUNCTION public.get_player_league_table_raw_by_player_token(
  p_token  text,
  p_period text DEFAULT 'all'::text
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
  v_period_matches jsonb;
  v_pm_rows   jsonb;
  v_all_time  jsonb;
  v_all_dates jsonb;
  v_players   jsonb;
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
    INTO v_period_matches
  FROM (
    SELECT id, match_date, score_type
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
      AND (v_cutoff IS NULL OR match_date >= v_cutoff)
  ) m_row;

  SELECT COALESCE(jsonb_agg(to_jsonb(pm_row)), '[]'::jsonb)
    INTO v_pm_rows
  FROM (
    SELECT pm.player_id, pm.match_id, pm.attended, pm.result, pm.goals,
           pm.was_motm, pm.had_bibs, pm.late_cancel, pm.team_assignment
    FROM player_match pm
    JOIN matches m ON m.id = pm.match_id
    WHERE pm.team_id = v_team_id
      AND COALESCE(m.cancelled, false) = false
      AND (v_cutoff IS NULL OR m.match_date >= v_cutoff)
  ) pm_row;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', t.player_id, 'n', t.n)), '[]'::jsonb)
    INTO v_all_time
  FROM (
    SELECT player_id, COUNT(*) AS n
    FROM player_match
    WHERE team_id = v_team_id AND attended = true
    GROUP BY player_id
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('match_date', match_date)), '[]'::jsonb)
    INTO v_all_dates
  FROM matches
  WHERE team_id = v_team_id AND COALESCE(cancelled, false) = false;

  SELECT COALESCE(jsonb_agg(to_jsonb(p_row)), '[]'::jsonb)
    INTO v_players
  FROM (
    SELECT p.id, p.name, p.nickname, p.injured, p.disabled, p.is_guest, p.created_at
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
    WHERE tp.team_id = v_team_id
  ) p_row;

  RETURN jsonb_build_object(
    'period_matches',       v_period_matches,
    'player_match_rows',    v_pm_rows,
    'all_time_attended',    v_all_time,
    'all_team_match_dates', v_all_dates,
    'players',              v_players
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_league_table_raw_by_player_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_player_league_table_raw_by_player_token(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_player_league_table_raw_by_player_token(text, text) TO authenticated;
