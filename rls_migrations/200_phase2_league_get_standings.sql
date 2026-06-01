-- 200_phase2_league_get_standings.sql
--
-- League dashboard standings — same computation as venue_get_standings (mig
-- 197) but resolved via the league_admin_token and gated to competitions that
-- belong to this league. Completed/walkover/forfeit fixtures; walkover+forfeit
-- count 3-0; ranked pts -> gd -> gf -> name.
-- Verified: Summer League leader Alpha United (6 pts); competition_not_in_league
-- + invalid_league_token enforced.
--
--   league_get_standings(p_league_token, p_competition_id)
--     -> { ok, competition:{...}, standings:[...] }

CREATE OR REPLACE FUNCTION public.league_get_standings(
  p_league_token   text,
  p_competition_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_league_id text;
  v_comp jsonb;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_league_caller(p_league_token);
  IF v_caller IS NULL OR v_caller.league_id IS NULL THEN
    RAISE EXCEPTION 'invalid_league_token' USING ERRCODE = 'P0001';
  END IF;
  v_league_id := v_caller.league_id;

  SELECT to_jsonb(c) INTO v_comp FROM (
    SELECT cm.id, cm.name, cm.type, cm.format
    FROM competitions cm
    JOIN seasons s ON s.id = cm.season_id
    WHERE cm.id = p_competition_id AND s.league_id = v_league_id
  ) c;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'competition_not_in_league' USING ERRCODE = 'P0001';
  END IF;

  WITH played AS (
    SELECT f.home_team_id AS team_id,
           CASE f.status
             WHEN 'completed' THEN f.home_score
             WHEN 'walkover'  THEN CASE WHEN f.walkover_winner_id = f.home_team_id THEN 3 ELSE 0 END
             WHEN 'forfeit'   THEN CASE WHEN f.forfeit_winner_id  = f.home_team_id THEN 3 ELSE 0 END
           END AS gf,
           CASE f.status
             WHEN 'completed' THEN f.away_score
             WHEN 'walkover'  THEN CASE WHEN f.walkover_winner_id = f.home_team_id THEN 0 ELSE 3 END
             WHEN 'forfeit'   THEN CASE WHEN f.forfeit_winner_id  = f.home_team_id THEN 0 ELSE 3 END
           END AS ga
    FROM fixtures f
    WHERE f.competition_id = p_competition_id AND f.away_team_id IS NOT NULL
      AND f.status IN ('completed','walkover','forfeit')
    UNION ALL
    SELECT f.away_team_id AS team_id,
           CASE f.status
             WHEN 'completed' THEN f.away_score
             WHEN 'walkover'  THEN CASE WHEN f.walkover_winner_id = f.away_team_id THEN 3 ELSE 0 END
             WHEN 'forfeit'   THEN CASE WHEN f.forfeit_winner_id  = f.away_team_id THEN 3 ELSE 0 END
           END AS gf,
           CASE f.status
             WHEN 'completed' THEN f.home_score
             WHEN 'walkover'  THEN CASE WHEN f.walkover_winner_id = f.away_team_id THEN 0 ELSE 3 END
             WHEN 'forfeit'   THEN CASE WHEN f.forfeit_winner_id  = f.away_team_id THEN 0 ELSE 3 END
           END AS ga
    FROM fixtures f
    WHERE f.competition_id = p_competition_id AND f.away_team_id IS NOT NULL
      AND f.status IN ('completed','walkover','forfeit')
  ),
  agg AS (
    SELECT team_id, count(*) AS played,
           count(*) FILTER (WHERE gf > ga) AS w,
           count(*) FILTER (WHERE gf = ga) AS d,
           count(*) FILTER (WHERE gf < ga) AS l,
           COALESCE(sum(gf),0) AS gf, COALESCE(sum(ga),0) AS ga
    FROM played GROUP BY team_id
  ),
  table_rows AS (
    SELECT t.id AS team_id, t.name AS team_name, t.primary_colour,
           COALESCE(a.played,0) AS played, COALESCE(a.w,0) AS w,
           COALESCE(a.d,0) AS d, COALESCE(a.l,0) AS l,
           COALESCE(a.gf,0) AS gf, COALESCE(a.ga,0) AS ga,
           COALESCE(a.gf,0)-COALESCE(a.ga,0) AS gd,
           COALESCE(a.w,0)*3 + COALESCE(a.d,0) AS pts
    FROM competition_teams ct
    JOIN teams t ON t.id = ct.team_id
    LEFT JOIN agg a ON a.team_id = ct.team_id
    WHERE ct.competition_id = p_competition_id
      AND ct.status NOT IN ('rejected','expelled','withdrawn')
  ),
  ranked AS (
    SELECT *, row_number() OVER (ORDER BY pts DESC, gd DESC, gf DESC, lower(team_name) ASC) AS rank
    FROM table_rows
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', team_id, 'team_name', team_name, 'primary_colour', primary_colour,
    'played', played, 'w', w, 'd', d, 'l', l, 'gf', gf, 'ga', ga, 'gd', gd, 'pts', pts, 'rank', rank
  ) ORDER BY rank), '[]'::jsonb) INTO v_rows FROM ranked;

  RETURN jsonb_build_object('ok', true, 'competition', v_comp, 'standings', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.league_get_standings(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.league_get_standings(text, uuid) TO anon, authenticated;
