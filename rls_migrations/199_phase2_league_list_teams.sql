-- 199_phase2_league_list_teams.sql
--
-- League dashboard: teams across all of a league's competitions, for fixture
-- name resolution + a Teams view. Read-only; resolves the caller via
-- resolve_league_caller (league_admin_token). league_get_state returns no
-- teams map, so the league app needs this companion read.
-- Verified: 5 teams for Demo Summer League; invalid_league_token enforced.
--
--   league_list_teams(p_league_token) -> { ok, teams:[{id,name,colours}] }

CREATE OR REPLACE FUNCTION public.league_list_teams(p_league_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_league_id text;
  v_teams jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_league_caller(p_league_token);
  IF v_caller IS NULL OR v_caller.league_id IS NULL THEN
    RAISE EXCEPTION 'invalid_league_token' USING ERRCODE = 'P0001';
  END IF;
  v_league_id := v_caller.league_id;

  SELECT COALESCE(jsonb_agg(t ORDER BY lower(t.name)), '[]'::jsonb)
  INTO v_teams
  FROM (
    SELECT DISTINCT te.id, te.name, te.primary_colour, te.secondary_colour
    FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    JOIN seasons s ON s.id = c.season_id
    JOIN teams te ON te.id = ct.team_id
    WHERE s.league_id = v_league_id
      AND ct.status NOT IN ('rejected','expelled','withdrawn')
  ) t;

  RETURN jsonb_build_object('ok', true, 'teams', v_teams);
END;
$function$;

REVOKE ALL ON FUNCTION public.league_list_teams(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.league_list_teams(text) TO anon, authenticated;
