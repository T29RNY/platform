-- Migration 042 — get_player_league_table_raw_by_admin_token
--
-- WHY: getPlayerLeagueTable in supabase.js does direct .from() reads on
-- matches, player_match (×2), and players. Under post-session-24 RLS those
-- return zero rows for anon callers — so on /demoadmin (and any anon admin
-- route) the H2H "Overall Comparison" bars never compute, and StatsView
-- never gets the per-player form + reliability columns. Mirrors the H2H
-- raw-data RPC shipped in 041.
--
-- Returns:
--   {
--     period_matches:    [{ id, match_date, score_type }],
--     player_match_rows: [{ player_id, match_id, attended, result, goals,
--                           was_motm, had_bibs, late_cancel, team_assignment }],
--     all_time_attended: [{ player_id, n }],
--     all_team_match_dates: [{ match_date }],
--     players:           [{ id, name, nickname, injured, disabled, is_guest, created_at }]
--   }

CREATE OR REPLACE FUNCTION public.get_player_league_table_raw_by_admin_token(
  p_admin_token text,
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
  v_period_matches jsonb;
  v_pm_rows jsonb;
  v_all_time jsonb;
  v_all_dates jsonb;
  v_players jsonb;
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

  -- Period-filtered matches (id + scoreType used for goal-eligibility filter)
  SELECT COALESCE(jsonb_agg(to_jsonb(m_row)), '[]'::jsonb)
    INTO v_period_matches
  FROM (
    SELECT id, match_date, score_type
    FROM matches
    WHERE team_id = v_team_id
      AND COALESCE(cancelled, false) = false
      AND (v_cutoff IS NULL OR match_date >= v_cutoff)
  ) m_row;

  -- player_match rows for those matches
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

  -- All-time attended counts per player (reliability numerator)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', t.player_id, 'n', t.n)), '[]'::jsonb)
    INTO v_all_time
  FROM (
    SELECT player_id, COUNT(*) AS n
    FROM player_match
    WHERE team_id = v_team_id AND attended = true
    GROUP BY player_id
  ) t;

  -- All uncancelled team match dates (reliability denominator)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('match_date', match_date)), '[]'::jsonb)
    INTO v_all_dates
  FROM matches
  WHERE team_id = v_team_id AND COALESCE(cancelled, false) = false;

  -- Player details (created_at = join date)
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

REVOKE ALL ON FUNCTION public.get_player_league_table_raw_by_admin_token(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_player_league_table_raw_by_admin_token(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_player_league_table_raw_by_admin_token(text, text) TO anon;
