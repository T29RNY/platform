-- 104_phase2_standings_forfeit_support_down.sql
--
-- Reverses 104 by restoring the mig 087 body verbatim (walkover-only
-- treatment; no forfeit branch).

CREATE OR REPLACE FUNCTION public.get_league_standings_for_player(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_player_id text;
  v_result jsonb;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'token_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_player_id FROM players WHERE token = p_token LIMIT 1;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'P0001';
  END IF;
  WITH
  player_teams AS (SELECT DISTINCT tp.team_id FROM team_players tp WHERE tp.player_id = v_player_id),
  player_comps AS (
    SELECT DISTINCT ct.competition_id FROM competition_teams ct
    WHERE ct.team_id IN (SELECT team_id FROM player_teams) AND ct.status = 'active'
  ),
  comp_meta AS (
    SELECT c.id AS competition_id, c.name AS comp_name, c.type AS comp_type, c.format AS comp_format,
           s.id AS season_id, s.name AS season_name, s.start_date AS season_start, s.end_date AS season_end,
           l.id AS league_id, l.name AS league_name, l.standings_visibility,
           v.id AS venue_id, v.name AS venue_name
    FROM competitions c JOIN seasons s ON s.id = c.season_id
    JOIN leagues l ON l.id = s.league_id JOIN venues v ON v.id = l.venue_id
    WHERE c.id IN (SELECT competition_id FROM player_comps)
  ),
  comp_teams_all AS (
    SELECT ct.competition_id, ct.team_id, ct.status AS ct_status,
           t.name AS team_name, t.primary_colour, t.secondary_colour
    FROM competition_teams ct JOIN teams t ON t.id = ct.team_id
    WHERE ct.competition_id IN (SELECT competition_id FROM player_comps)
      AND ct.status IN ('active','withdrawn')
  ),
  fixture_outcomes AS (
    SELECT f.competition_id, f.home_team_id, f.away_team_id,
           COALESCE(f.home_score, CASE
             WHEN f.status = 'walkover' AND f.walkover_winner_id = f.home_team_id THEN 3
             WHEN f.status = 'walkover' AND f.walkover_winner_id = f.away_team_id THEN 0
             ELSE NULL END) AS hs,
           COALESCE(f.away_score, CASE
             WHEN f.status = 'walkover' AND f.walkover_winner_id = f.away_team_id THEN 3
             WHEN f.status = 'walkover' AND f.walkover_winner_id = f.home_team_id THEN 0
             ELSE NULL END) AS as_score
    FROM fixtures f WHERE f.competition_id IN (SELECT competition_id FROM player_comps)
      AND f.status IN ('completed','walkover')
  ),
  team_rows AS (
    SELECT competition_id, home_team_id AS team_id,
           CASE WHEN hs > as_score THEN 1 ELSE 0 END AS w,
           CASE WHEN hs = as_score THEN 1 ELSE 0 END AS d,
           CASE WHEN hs < as_score THEN 1 ELSE 0 END AS l,
           hs AS gf, as_score AS ga
    FROM fixture_outcomes WHERE hs IS NOT NULL AND as_score IS NOT NULL
    UNION ALL
    SELECT competition_id, away_team_id AS team_id,
           CASE WHEN as_score > hs THEN 1 ELSE 0 END AS w,
           CASE WHEN as_score = hs THEN 1 ELSE 0 END AS d,
           CASE WHEN as_score < hs THEN 1 ELSE 0 END AS l,
           as_score AS gf, hs AS ga
    FROM fixture_outcomes WHERE hs IS NOT NULL AND as_score IS NOT NULL AND away_team_id IS NOT NULL
  ),
  team_aggregated AS (
    SELECT competition_id, team_id, SUM(w + d + l)::int AS played,
           SUM(w)::int AS w, SUM(d)::int AS d, SUM(l)::int AS l,
           SUM(gf)::int AS gf, SUM(ga)::int AS ga,
           (SUM(gf) - SUM(ga))::int AS gd, (SUM(w) * 3 + SUM(d))::int AS pts
    FROM team_rows GROUP BY competition_id, team_id
  ),
  standings AS (
    SELECT cta.competition_id, cta.team_id, cta.team_name, cta.primary_colour, cta.secondary_colour, cta.ct_status,
           COALESCE(ta.played, 0) AS played, COALESCE(ta.w, 0) AS w, COALESCE(ta.d, 0) AS d, COALESCE(ta.l, 0) AS l,
           COALESCE(ta.gf, 0) AS gf, COALESCE(ta.ga, 0) AS ga, COALESCE(ta.gd, 0) AS gd, COALESCE(ta.pts, 0) AS pts
    FROM comp_teams_all cta LEFT JOIN team_aggregated ta
      ON ta.competition_id = cta.competition_id AND ta.team_id = cta.team_id
  )
  SELECT jsonb_build_object(
    'player_id', v_player_id,
    'competitions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id', cm.competition_id, 'competition_name', cm.comp_name,
        'competition_type', cm.comp_type, 'competition_format', cm.comp_format,
        'season_id', cm.season_id, 'season_name', cm.season_name,
        'season_start', cm.season_start, 'season_end', cm.season_end,
        'league_id', cm.league_id, 'league_name', cm.league_name,
        'venue_id', cm.venue_id, 'venue_name', cm.venue_name,
        'standings_visible', cm.standings_visibility = 'public',
        'standings', CASE WHEN cm.standings_visibility = 'public' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'team_id', s.team_id, 'team_name', s.team_name,
            'primary_colour', s.primary_colour, 'secondary_colour', s.secondary_colour,
            'ct_status', s.ct_status, 'played', s.played,
            'w', s.w, 'd', s.d, 'l', s.l, 'gf', s.gf, 'ga', s.ga, 'gd', s.gd, 'pts', s.pts
          ) ORDER BY s.pts DESC, s.gd DESC, s.gf DESC, s.team_name)
          FROM standings s WHERE s.competition_id = cm.competition_id), '[]'::jsonb)
          ELSE '[]'::jsonb END,
        'top_scorers', '[]'::jsonb
      ) ORDER BY cm.season_start DESC NULLS LAST, cm.comp_name)
      FROM comp_meta cm), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_league_standings_for_player(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_league_standings_for_player(text) TO anon, authenticated;
