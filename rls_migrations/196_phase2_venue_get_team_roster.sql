-- 196_phase2_venue_get_team_roster.sql
--
-- Team management depth: a venue admin can read the roster of any team that
-- plays in one of its competitions. Read-only; ownership-gated through
-- competition_teams -> competitions -> seasons -> leagues -> venue_id.
-- Sensitive player fields (token, user_id, phone) are NOT exposed.
--
--   venue_get_team_roster(p_venue_token, p_team_id)
--     -> { ok, team:{...}, players:[...], competitions:[...] }
--
-- Verified read-only against the live DB: rosters return for venue teams;
-- team_not_in_venue + invalid_venue_token both enforced.

CREATE OR REPLACE FUNCTION public.venue_get_team_roster(
  p_venue_token text,
  p_team_id     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_authorized boolean;
  v_team jsonb;
  v_players jsonb;
  v_comps jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  -- Team must be registered in a competition owned by this venue.
  SELECT EXISTS (
    SELECT 1
    FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    JOIN seasons s ON s.id = c.season_id
    JOIN leagues l ON l.id = s.league_id
    WHERE ct.team_id = p_team_id AND l.venue_id = v_venue_id
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'team_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(t) INTO v_team FROM (
    SELECT id, name, primary_colour, secondary_colour, team_type
    FROM teams WHERE id = p_team_id
  ) t;
  IF v_team IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(p ORDER BY p.shirt_number NULLS LAST, lower(p.name)), '[]'::jsonb)
  INTO v_players
  FROM (
    SELECT pl.id, pl.name, pl.nickname, pl.shirt_number, pl.type, pl.status,
           pl.goals, pl.motm, pl.attended, pl.w, pl.l, pl.d,
           COALESCE(pl.injured, false) AS injured,
           COALESCE(pl.disabled, false) AS disabled,
           COALESCE(tp.is_vice_captain, false) AS is_vice_captain
    FROM team_players tp
    JOIN players pl ON pl.id = tp.player_id
    WHERE tp.team_id = p_team_id
  ) p;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', c.name, 'status', ct.status) ORDER BY c.name), '[]'::jsonb)
  INTO v_comps
  FROM competition_teams ct
  JOIN competitions c ON c.id = ct.competition_id
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE ct.team_id = p_team_id AND l.venue_id = v_venue_id;

  RETURN jsonb_build_object('ok', true, 'team', v_team, 'players', v_players, 'competitions', v_comps);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_get_team_roster(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_get_team_roster(text, text) TO anon, authenticated;
