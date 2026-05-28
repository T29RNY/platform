-- 155_player_competition_fixtures.sql
--
-- League Mode Phase 5 — Cycle 5.3 player-facing competition fixtures RPC.
--
--   get_player_competition_fixtures(p_token, p_filter DEFAULT 'upcoming')
--     For every competition the player's teams are registered in
--     (status='active'), return the fixtures involving one of the
--     player's teams. One flat array, designed once for all consumers.
--
--     p_filter:
--       'upcoming' — status = 'scheduled'
--       'past'     — status in ('completed','walkover','forfeit','void')
--       'all'      — everything (client groups by status). Any other
--                    value falls back to 'all' (forgiving, no error).
--
--     Each row carries the player's perspective:
--       my_team_id / is_home / opponent_name / my_score / opponent_score
--       result — 'W'/'D'/'L' for completed (from my_team's view),
--                W/L for walkover + forfeit, NULL otherwise. No phantom
--                3-0 walkover scoring here — that lives in standings
--                (mig 087). This RPC reports status truthfully.
--
--     Token-gated: a casual player's token resolves to zero active
--     competitions, so 'fixtures' is []. The client card self-gates
--     to render nothing — the casual flow is untouched.
--
-- Designed-for consumers (hard-rule #14, recorded in RPCS.md):
--   - Cycle 5.3 player my-view CompetitionFixturesCard (this cycle)
--   - Phase 4 reception display "upcoming fixtures" panel (future)
--   - Phase 6 HQ "tonight's fixtures" feed (future)
-- Return-shape additions for those consumers won't break this cycle.
--
-- HARD security rules honoured:
--   - SECURITY DEFINER + SET search_path = public, pg_temp.
--   - REVOKE ALL FROM PUBLIC + GRANT to anon, authenticated
--     (players hit this anon from the phone; authenticated covers the
--     post-auth player path without a re-grant).

CREATE OR REPLACE FUNCTION public.get_player_competition_fixtures(
  p_token text,
  p_filter text DEFAULT 'upcoming'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_player_id text;
  v_filter    text;
  v_result    jsonb;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'token_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_player_id
  FROM players
  WHERE token = p_token
  LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'P0001';
  END IF;

  v_filter := lower(coalesce(p_filter, 'upcoming'));
  IF v_filter NOT IN ('upcoming', 'past', 'all') THEN
    v_filter := 'all';
  END IF;

  WITH
  player_teams AS (
    SELECT DISTINCT tp.team_id
    FROM team_players tp
    WHERE tp.player_id = v_player_id
  ),
  player_comps AS (
    SELECT DISTINCT ct.competition_id
    FROM competition_teams ct
    WHERE ct.team_id IN (SELECT team_id FROM player_teams)
      AND ct.status = 'active'
  ),
  my_fixtures AS (
    SELECT f.*,
           CASE WHEN f.home_team_id IN (SELECT team_id FROM player_teams)
                THEN f.home_team_id ELSE f.away_team_id END AS my_team_id,
           (f.home_team_id IN (SELECT team_id FROM player_teams)) AS is_home
    FROM fixtures f
    WHERE f.competition_id IN (SELECT competition_id FROM player_comps)
      AND (f.home_team_id IN (SELECT team_id FROM player_teams)
           OR f.away_team_id IN (SELECT team_id FROM player_teams))
  ),
  filtered AS (
    SELECT * FROM my_fixtures mf
    WHERE
      CASE v_filter
        WHEN 'upcoming' THEN mf.status = 'scheduled'
        WHEN 'past'     THEN mf.status IN ('completed','walkover','forfeit','void')
        ELSE true
      END
  )
  SELECT jsonb_build_object(
    'player_id', v_player_id,
    'filter', v_filter,
    'fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fixture_id', fx.id,
        'competition_id', fx.competition_id,
        'competition_name', c.name,
        'competition_type', c.type,
        'season_name', s.name,
        'league_name', l.name,
        'venue_name', v.name,
        'week_number', fx.week_number,
        'round_name', fx.round_name,
        'scheduled_date', fx.scheduled_date,
        'kickoff_time', fx.kickoff_time,
        'pitch_name', pa.name,
        'status', fx.status,
        'home_team_id', fx.home_team_id,
        'home_team_name', ht.name,
        'home_primary_colour', ht.primary_colour,
        'away_team_id', fx.away_team_id,
        'away_team_name', at.name,
        'away_primary_colour', at.primary_colour,
        'home_score', fx.home_score,
        'away_score', fx.away_score,
        'my_team_id', fx.my_team_id,
        'is_home', fx.is_home,
        'opponent_id', CASE WHEN fx.is_home THEN fx.away_team_id ELSE fx.home_team_id END,
        'opponent_name', CASE WHEN fx.is_home THEN at.name ELSE ht.name END,
        'my_score', CASE WHEN fx.is_home THEN fx.home_score ELSE fx.away_score END,
        'opponent_score', CASE WHEN fx.is_home THEN fx.away_score ELSE fx.home_score END,
        'result', CASE
          WHEN fx.status = 'completed' AND fx.home_score IS NOT NULL AND fx.away_score IS NOT NULL THEN
            CASE
              WHEN (CASE WHEN fx.is_home THEN fx.home_score ELSE fx.away_score END)
                 > (CASE WHEN fx.is_home THEN fx.away_score ELSE fx.home_score END) THEN 'W'
              WHEN (CASE WHEN fx.is_home THEN fx.home_score ELSE fx.away_score END)
                 = (CASE WHEN fx.is_home THEN fx.away_score ELSE fx.home_score END) THEN 'D'
              ELSE 'L'
            END
          WHEN fx.status = 'walkover' THEN
            CASE WHEN fx.walkover_winner_id = fx.my_team_id THEN 'W' ELSE 'L' END
          WHEN fx.status = 'forfeit' THEN
            CASE WHEN fx.forfeit_winner_id = fx.my_team_id THEN 'W' ELSE 'L' END
          ELSE NULL
        END
      ) ORDER BY fx.scheduled_date ASC NULLS LAST, fx.kickoff_time ASC NULLS LAST, fx.week_number ASC)
      FROM filtered fx
      JOIN competitions c ON c.id = fx.competition_id
      JOIN seasons s ON s.id = c.season_id
      JOIN leagues l ON l.id = s.league_id
      JOIN venues v ON v.id = l.venue_id
      LEFT JOIN teams ht ON ht.id = fx.home_team_id
      LEFT JOIN teams at ON at.id = fx.away_team_id
      LEFT JOIN playing_areas pa ON pa.id = fx.playing_area_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_player_competition_fixtures(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_player_competition_fixtures(text, text)
  TO anon, authenticated;
