-- 198_phase2_venue_list_players.sql
--
-- Player management (aggregate): every player across all teams that play in
-- this venue's competitions, with their team. Read-only; ownership via
-- competition_teams -> competitions -> seasons -> leagues -> venue_id.
-- Excludes token/user_id/phone. One row per (player, team) membership.
--
--   venue_list_players(p_venue_token) -> { ok, players:[...] }
--
-- Verified read-only against the live DB (24 demo players returned with team).

CREATE OR REPLACE FUNCTION public.venue_list_players(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_players jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  WITH venue_teams AS (
    SELECT DISTINCT ct.team_id
    FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    JOIN seasons s ON s.id = c.season_id
    JOIN leagues l ON l.id = s.league_id
    WHERE l.venue_id = v_venue_id
      AND ct.status NOT IN ('rejected','expelled','withdrawn')
  )
  SELECT COALESCE(jsonb_agg(p ORDER BY p.team_name, lower(p.name)), '[]'::jsonb)
  INTO v_players
  FROM (
    SELECT pl.id, pl.name, pl.nickname, pl.shirt_number, pl.type, pl.status,
           pl.goals, pl.motm, pl.attended,
           COALESCE(pl.injured, false) AS injured,
           COALESCE(pl.disabled, false) AS disabled,
           t.id AS team_id, t.name AS team_name, t.primary_colour AS team_colour
    FROM venue_teams vt
    JOIN team_players tp ON tp.team_id = vt.team_id
    JOIN players pl ON pl.id = tp.player_id
    JOIN teams t ON t.id = vt.team_id
  ) p;

  RETURN jsonb_build_object('ok', true, 'players', v_players);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_list_players(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_players(text) TO anon, authenticated;
