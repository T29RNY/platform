-- Migration 041 — get_head_to_head_raw_by_admin_token
--
-- WHY: getHeadToHead in supabase.js previously did three direct .from()
-- reads (matches all-time, matches period, player_match for two players).
-- Direct reads are RLS-gated and return zero rows for anon callers — so
-- the /demoadmin showcase route (and any unauthenticated browser) sees
-- an empty H2H. Wrap the raw data fetch in a SECURITY DEFINER RPC that
-- derives team_id from p_admin_token. The JS keeps its existing
-- computation; we only move the data-fetch boundary inside the RPC.
--
-- Returns:
--   {
--     all_time_matches: [{ id, match_date, score_a, score_b, winner, score_type, cancelled }],
--     period_matches:   [{ id, match_date, score_a, score_b, winner, score_type, cancelled }],
--     player_match_rows:[{ player_id, match_id, team_assignment, result, goals, was_motm, had_bibs }]
--   }

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
-- ^ anon allowed because admin_token is the auth signal (same pattern as other admin RPCs)
