-- mig 193 — Phase 11.4a: get_group_standings (READ).
-- Per-group mini-league tables for a group_stage cup. Aggregation mirrors
-- get_league_standings_for_player (mig 087): W=3/D=1/L=0, GD, GF, walkover/forfeit 3-0.
-- Scoped by competition_id + group_label; rank pts→gd→gf→seed (deterministic, no H2H in v1).
-- anon-readable (keyed by competition UUID, mirrors get_cup_bracket).

CREATE OR REPLACE FUNCTION public.get_group_standings(p_competition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_qpg int;
  v_result jsonb;
  v_all_complete boolean;
BEGIN
  IF p_competition_id IS NULL THEN
    RAISE EXCEPTION 'competition_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE((config->>'qualifiers_per_group')::int, 0) INTO v_qpg
  FROM competitions WHERE id = p_competition_id;

  -- all group fixtures resolved?
  SELECT NOT EXISTS (
    SELECT 1 FROM fixtures
    WHERE competition_id = p_competition_id
      AND group_label IS NOT NULL
      AND status NOT IN ('completed','walkover','forfeit')
  ) AND EXISTS (
    SELECT 1 FROM fixtures WHERE competition_id = p_competition_id AND group_label IS NOT NULL
  )
  INTO v_all_complete;

  WITH
  grp_teams AS (
    SELECT ct.team_id, ct.group_label, ct.seed,
           t.name AS team_name, t.primary_colour, t.secondary_colour
    FROM competition_teams ct JOIN teams t ON t.id = ct.team_id
    WHERE ct.competition_id = p_competition_id AND ct.group_label IS NOT NULL
  ),
  outcomes AS (
    SELECT f.group_label, f.home_team_id, f.away_team_id,
           COALESCE(f.home_score, CASE
             WHEN f.status='walkover' AND f.walkover_winner_id=f.home_team_id THEN 3
             WHEN f.status='walkover' AND f.walkover_winner_id=f.away_team_id THEN 0
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.home_team_id THEN 3
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.away_team_id THEN 0
             ELSE NULL END) AS hs,
           COALESCE(f.away_score, CASE
             WHEN f.status='walkover' AND f.walkover_winner_id=f.away_team_id THEN 3
             WHEN f.status='walkover' AND f.walkover_winner_id=f.home_team_id THEN 0
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.away_team_id THEN 3
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.home_team_id THEN 0
             ELSE NULL END) AS as_score
    FROM fixtures f
    WHERE f.competition_id = p_competition_id AND f.group_label IS NOT NULL
      AND f.status IN ('completed','walkover','forfeit')
  ),
  rows AS (
    SELECT group_label, home_team_id AS team_id,
           CASE WHEN hs>as_score THEN 1 ELSE 0 END AS w,
           CASE WHEN hs=as_score THEN 1 ELSE 0 END AS d,
           CASE WHEN hs<as_score THEN 1 ELSE 0 END AS l,
           hs AS gf, as_score AS ga
    FROM outcomes WHERE hs IS NOT NULL AND as_score IS NOT NULL
    UNION ALL
    SELECT group_label, away_team_id AS team_id,
           CASE WHEN as_score>hs THEN 1 ELSE 0 END AS w,
           CASE WHEN as_score=hs THEN 1 ELSE 0 END AS d,
           CASE WHEN as_score<hs THEN 1 ELSE 0 END AS l,
           as_score AS gf, hs AS ga
    FROM outcomes WHERE hs IS NOT NULL AND as_score IS NOT NULL AND away_team_id IS NOT NULL
  ),
  agg AS (
    SELECT group_label, team_id, SUM(w+d+l)::int AS played,
           SUM(w)::int AS w, SUM(d)::int AS d, SUM(l)::int AS l,
           SUM(gf)::int AS gf, SUM(ga)::int AS ga,
           (SUM(gf)-SUM(ga))::int AS gd, (SUM(w)*3+SUM(d))::int AS pts
    FROM rows GROUP BY group_label, team_id
  ),
  standings AS (
    SELECT gt.group_label, gt.team_id, gt.team_name, gt.primary_colour, gt.secondary_colour, gt.seed,
           COALESCE(a.played,0) AS played, COALESCE(a.w,0) AS w, COALESCE(a.d,0) AS d,
           COALESCE(a.l,0) AS l, COALESCE(a.gf,0) AS gf, COALESCE(a.ga,0) AS ga,
           COALESCE(a.gd,0) AS gd, COALESCE(a.pts,0) AS pts,
           row_number() OVER (PARTITION BY gt.group_label
             ORDER BY COALESCE(a.pts,0) DESC, COALESCE(a.gd,0) DESC,
                      COALESCE(a.gf,0) DESC, gt.seed ASC) AS rank
    FROM grp_teams gt LEFT JOIN agg a
      ON a.group_label = gt.group_label AND a.team_id = gt.team_id
  )
  SELECT COALESCE(jsonb_agg(grp ORDER BY grp->>'group_label'), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'group_label', s.group_label,
      'qualifiers_per_group', v_qpg,
      'standings', jsonb_agg(jsonb_build_object(
        'team_id', s.team_id, 'team_name', s.team_name,
        'primary_colour', s.primary_colour, 'secondary_colour', s.secondary_colour,
        'played', s.played, 'w', s.w, 'd', s.d, 'l', s.l,
        'gf', s.gf, 'ga', s.ga, 'gd', s.gd, 'pts', s.pts,
        'rank', s.rank, 'qualifying', (s.rank <= v_qpg)
      ) ORDER BY s.rank)
    ) AS grp
    FROM standings s
    GROUP BY s.group_label
  ) groups;

  RETURN jsonb_build_object(
    'competition_id', p_competition_id,
    'groups', v_result,
    'all_groups_complete', COALESCE(v_all_complete, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_group_standings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_group_standings(uuid) TO anon, authenticated;
