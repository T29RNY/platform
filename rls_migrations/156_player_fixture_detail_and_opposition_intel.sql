-- 156_player_fixture_detail_and_opposition_intel.sql
--
-- League Mode Phase 5 — Cycle 5.4. Two read-only player-facing RPCs powering
-- the inline fixture-detail expansion + nested opposition intel on the player
-- my-view CompetitionFixturesCard.
--
-- Both are token-gated and STRICTER than the ref RPC (mig 119): a player may
-- only open a fixture in one of their OWN active competitions that one of their
-- OWN teams plays in. Any other fixture_id raises 'fixture_not_visible'. This is
-- the load-bearing security difference from the ref token (which grants access
-- to exactly one fixture by design).
--
--   get_player_fixture_detail(p_token, p_fixture_id)
--     Mirrors the mig-119 ref fixture-state shape (fixture, competition, league,
--     venue, pitch, both teams, both registered squads, events) PLUS the 5.3
--     player-perspective fields (my_team_id, is_home, opponent_name, my_score,
--     opponent_score, result). Squads are the LIVE registered roster (read fresh
--     each call) — a team may not finalise until just before kickoff. The
--     per-fixture confirmed XI arrives in Cycle 5.6 (fixture_lineups); until then
--     this is the full active player_registrations set.
--     Availability fields (availability_counts, my_availability) are intentionally
--     ABSENT — Cycle 5.5 adds them with a same-commit mapper update (hard-rule #12).
--     Consumers (hard-rule #14): 5.4 FixtureDetailCard; Phase 4 reception display;
--     Phase 7 AI briefings.
--
--   get_fixture_opposition_intel(p_token, p_fixture_id)
--     H2H (all-time + this-season) between the player's team and the opponent,
--     both teams' form (last 5 in this competition), per-team top scorers (from
--     match_events event_type='goal' — there is NO goals table), and the last
--     completed meeting. No phantom walkover/forfeit goals (winner → W/L only).
--     Consumers (hard-rule #14): 5.4 OppositionIntel; Phase 7 AI Gaffer briefings.
--
-- HARD security rules honoured:
--   - SECURITY DEFINER + SET search_path = public, pg_temp.
--   - REVOKE ALL FROM PUBLIC + GRANT to anon, authenticated.

CREATE OR REPLACE FUNCTION public.get_player_fixture_detail(p_token text, p_fixture_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_player_id text;
  v_fix       record;
  v_my        text;
  v_is_home   boolean;
  v_result    jsonb;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'token_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_player_id FROM players WHERE token = p_token LIMIT 1;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_fix FROM fixtures WHERE id = p_fixture_id;
  IF v_fix.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_visible' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players tp
    JOIN competition_teams ct ON ct.team_id = tp.team_id AND ct.status = 'active'
    WHERE tp.player_id = v_player_id
      AND ct.competition_id = v_fix.competition_id
      AND tp.team_id IN (v_fix.home_team_id, v_fix.away_team_id)
  ) THEN
    RAISE EXCEPTION 'fixture_not_visible' USING ERRCODE = 'P0001';
  END IF;

  SELECT tp.team_id INTO v_my
  FROM team_players tp
  WHERE tp.player_id = v_player_id
    AND tp.team_id IN (v_fix.home_team_id, v_fix.away_team_id)
  LIMIT 1;
  v_is_home := (v_my = v_fix.home_team_id);

  WITH
  comp AS (SELECT c.id, c.name, c.type, c.format, c.season_id FROM competitions c WHERE c.id = v_fix.competition_id),
  season AS (SELECT s.id, s.name, s.league_id FROM seasons s WHERE s.id = (SELECT season_id FROM comp)),
  league AS (SELECT l.id, l.name, l.sport, l.venue_id FROM leagues l WHERE l.id = (SELECT league_id FROM season)),
  venue AS (SELECT v.id, v.name FROM venues v WHERE v.id = (SELECT venue_id FROM league)),
  pitch AS (SELECT p.id, p.name, p.surface FROM playing_areas p WHERE p.id = v_fix.playing_area_id),
  home_team AS (SELECT t.id, t.name, t.primary_colour, t.secondary_colour FROM teams t WHERE t.id = v_fix.home_team_id),
  away_team AS (SELECT t.id, t.name, t.primary_colour, t.secondary_colour FROM teams t WHERE t.id = v_fix.away_team_id),
  home_squad AS (
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'shirt_number', p.shirt_number,
      'registration_status', pr.status, 'suspension_until', pr.suspension_until)
      ORDER BY p.shirt_number NULLS LAST, p.name) AS list
    FROM player_registrations pr JOIN players p ON p.id = pr.player_id
    WHERE pr.competition_id = v_fix.competition_id AND pr.team_id = v_fix.home_team_id AND pr.status = 'active'
  ),
  away_squad AS (
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'shirt_number', p.shirt_number,
      'registration_status', pr.status, 'suspension_until', pr.suspension_until)
      ORDER BY p.shirt_number NULLS LAST, p.name) AS list
    FROM player_registrations pr JOIN players p ON p.id = pr.player_id
    WHERE pr.competition_id = v_fix.competition_id AND pr.team_id = v_fix.away_team_id AND pr.status = 'active'
  ),
  events AS (
    SELECT jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'minute', e.minute,
      'period', e.period, 'team_id', e.team_id, 'player_id', e.player_id,
      'player_name_override', e.player_name_override, 'sub_player_on_id', e.sub_player_on_id,
      'sub_player_off_id', e.sub_player_off_id) ORDER BY e.minute NULLS LAST, e.created_at) AS list
    FROM match_events e WHERE e.fixture_id = v_fix.id
  )
  SELECT jsonb_build_object(
    'fixture', jsonb_build_object(
      'id', v_fix.id, 'competition_id', v_fix.competition_id,
      'home_team_id', v_fix.home_team_id, 'away_team_id', v_fix.away_team_id,
      'week_number', v_fix.week_number, 'round_name', v_fix.round_name,
      'scheduled_date', v_fix.scheduled_date, 'kickoff_time', v_fix.kickoff_time,
      'playing_area_id', v_fix.playing_area_id, 'status', v_fix.status,
      'home_score', v_fix.home_score, 'away_score', v_fix.away_score,
      'walkover_winner_id', v_fix.walkover_winner_id, 'forfeit_winner_id', v_fix.forfeit_winner_id,
      'postpone_reason', v_fix.postpone_reason, 'void_reason', v_fix.void_reason, 'forfeit_reason', v_fix.forfeit_reason),
    'competition', (SELECT to_jsonb(c.*) FROM comp c),
    'league', (SELECT to_jsonb(l.*) FROM league l),
    'venue', (SELECT to_jsonb(v.*) FROM venue v),
    'pitch', (SELECT to_jsonb(p.*) FROM pitch p),
    'home_team', (SELECT to_jsonb(t.*) FROM home_team t),
    'away_team', (SELECT to_jsonb(t.*) FROM away_team t),
    'home_squad', COALESCE((SELECT list FROM home_squad), '[]'::jsonb),
    'away_squad', COALESCE((SELECT list FROM away_squad), '[]'::jsonb),
    'events', COALESCE((SELECT list FROM events), '[]'::jsonb),
    'my_team_id', v_my,
    'is_home', v_is_home,
    'opponent_id', CASE WHEN v_is_home THEN v_fix.away_team_id ELSE v_fix.home_team_id END,
    'opponent_name', (SELECT name FROM teams WHERE id = CASE WHEN v_is_home THEN v_fix.away_team_id ELSE v_fix.home_team_id END),
    'my_score', CASE WHEN v_is_home THEN v_fix.home_score ELSE v_fix.away_score END,
    'opponent_score', CASE WHEN v_is_home THEN v_fix.away_score ELSE v_fix.home_score END,
    'result', CASE
      WHEN v_fix.status = 'completed' AND v_fix.home_score IS NOT NULL AND v_fix.away_score IS NOT NULL THEN
        CASE WHEN (CASE WHEN v_is_home THEN v_fix.home_score ELSE v_fix.away_score END)
               > (CASE WHEN v_is_home THEN v_fix.away_score ELSE v_fix.home_score END) THEN 'W'
             WHEN (CASE WHEN v_is_home THEN v_fix.home_score ELSE v_fix.away_score END)
               = (CASE WHEN v_is_home THEN v_fix.away_score ELSE v_fix.home_score END) THEN 'D' ELSE 'L' END
      WHEN v_fix.status = 'walkover' THEN CASE WHEN v_fix.walkover_winner_id = v_my THEN 'W' ELSE 'L' END
      WHEN v_fix.status = 'forfeit' THEN CASE WHEN v_fix.forfeit_winner_id = v_my THEN 'W' ELSE 'L' END
      ELSE NULL END,
    'caller', jsonb_build_object('actor_type', 'player_token', 'fixture_id', v_fix.id)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_player_fixture_detail(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_player_fixture_detail(text, uuid) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_fixture_opposition_intel(p_token text, p_fixture_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_player_id text;
  v_fix       record;
  v_my        text;
  v_opp       text;
  v_comp      uuid;
  v_season    uuid;
  v_result    jsonb;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'token_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_player_id FROM players WHERE token = p_token LIMIT 1;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_fix FROM fixtures WHERE id = p_fixture_id;
  IF v_fix.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_visible' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players tp
    JOIN competition_teams ct ON ct.team_id = tp.team_id AND ct.status = 'active'
    WHERE tp.player_id = v_player_id
      AND ct.competition_id = v_fix.competition_id
      AND tp.team_id IN (v_fix.home_team_id, v_fix.away_team_id)
  ) THEN
    RAISE EXCEPTION 'fixture_not_visible' USING ERRCODE = 'P0001';
  END IF;

  SELECT tp.team_id INTO v_my FROM team_players tp
  WHERE tp.player_id = v_player_id AND tp.team_id IN (v_fix.home_team_id, v_fix.away_team_id) LIMIT 1;
  v_opp  := CASE WHEN v_my = v_fix.home_team_id THEN v_fix.away_team_id ELSE v_fix.home_team_id END;
  v_comp := v_fix.competition_id;
  SELECT season_id INTO v_season FROM competitions WHERE id = v_comp;

  WITH
  meetings AS (
    SELECT f.*,
      (f.competition_id IN (SELECT id FROM competitions WHERE season_id = v_season)) AS this_season,
      CASE WHEN f.home_team_id = v_my THEN f.home_score ELSE f.away_score END AS my_g,
      CASE WHEN f.home_team_id = v_my THEN f.away_score ELSE f.home_score END AS opp_g,
      CASE
        WHEN f.status = 'completed' AND f.home_score IS NOT NULL THEN
          CASE WHEN (CASE WHEN f.home_team_id=v_my THEN f.home_score ELSE f.away_score END)
                 > (CASE WHEN f.home_team_id=v_my THEN f.away_score ELSE f.home_score END) THEN 'W'
               WHEN (CASE WHEN f.home_team_id=v_my THEN f.home_score ELSE f.away_score END)
                 = (CASE WHEN f.home_team_id=v_my THEN f.away_score ELSE f.home_score END) THEN 'D' ELSE 'L' END
        WHEN f.status = 'walkover' THEN CASE WHEN f.walkover_winner_id=v_my THEN 'W' ELSE 'L' END
        WHEN f.status = 'forfeit' THEN CASE WHEN f.forfeit_winner_id=v_my THEN 'W' ELSE 'L' END
      END AS outcome
    FROM fixtures f
    WHERE f.status IN ('completed','walkover','forfeit')
      AND ((f.home_team_id=v_my AND f.away_team_id=v_opp) OR (f.home_team_id=v_opp AND f.away_team_id=v_my))
  ),
  team_form_src AS (
    SELECT v_my AS team_id, f.scheduled_date, f.kickoff_time, f.status, f.walkover_winner_id, f.forfeit_winner_id,
      CASE WHEN f.home_team_id=v_my THEN f.home_score ELSE f.away_score END AS gf,
      CASE WHEN f.home_team_id=v_my THEN f.away_score ELSE f.home_score END AS ga
    FROM fixtures f
    WHERE f.competition_id=v_comp AND f.status IN ('completed','walkover','forfeit')
      AND (f.home_team_id=v_my OR f.away_team_id=v_my)
    UNION ALL
    SELECT v_opp AS team_id, f.scheduled_date, f.kickoff_time, f.status, f.walkover_winner_id, f.forfeit_winner_id,
      CASE WHEN f.home_team_id=v_opp THEN f.home_score ELSE f.away_score END AS gf,
      CASE WHEN f.home_team_id=v_opp THEN f.away_score ELSE f.home_score END AS ga
    FROM fixtures f
    WHERE f.competition_id=v_comp AND f.status IN ('completed','walkover','forfeit')
      AND (f.home_team_id=v_opp OR f.away_team_id=v_opp)
  ),
  team_form AS (
    SELECT team_id, scheduled_date, kickoff_time,
      CASE
        WHEN status='completed' AND gf IS NOT NULL THEN CASE WHEN gf>ga THEN 'W' WHEN gf=ga THEN 'D' ELSE 'L' END
        WHEN status='walkover' THEN CASE WHEN walkover_winner_id=team_id THEN 'W' ELSE 'L' END
        WHEN status='forfeit' THEN CASE WHEN forfeit_winner_id=team_id THEN 'W' ELSE 'L' END
      END AS outcome
    FROM team_form_src
  ),
  scorers AS (
    SELECT e.team_id, e.player_id,
      COALESCE(pl.name, e.player_name_override, 'Unknown') AS name, count(*)::int AS goals
    FROM match_events e
    LEFT JOIN players pl ON pl.id = e.player_id
    JOIN fixtures f ON f.id = e.fixture_id
    WHERE e.event_type='goal' AND f.competition_id=v_comp AND e.team_id IN (v_my, v_opp)
    GROUP BY e.team_id, e.player_id, COALESCE(pl.name, e.player_name_override, 'Unknown')
  )
  SELECT jsonb_build_object(
    'my_team_id', v_my,
    'opponent_id', v_opp,
    'opponent_name', (SELECT name FROM teams WHERE id = v_opp),
    'h2h', jsonb_build_object(
      'all_time', (SELECT jsonb_build_object(
        'p', count(*), 'w', count(*) FILTER (WHERE outcome='W'),
        'd', count(*) FILTER (WHERE outcome='D'), 'l', count(*) FILTER (WHERE outcome='L'),
        'gf', COALESCE(sum(my_g),0), 'ga', COALESCE(sum(opp_g),0)) FROM meetings),
      'this_season', (SELECT jsonb_build_object(
        'p', count(*), 'w', count(*) FILTER (WHERE outcome='W'),
        'd', count(*) FILTER (WHERE outcome='D'), 'l', count(*) FILTER (WHERE outcome='L'),
        'gf', COALESCE(sum(my_g),0), 'ga', COALESCE(sum(opp_g),0)) FROM meetings WHERE this_season)
    ),
    'my_form', COALESCE((SELECT jsonb_agg(outcome ORDER BY scheduled_date DESC, kickoff_time DESC)
      FROM (SELECT * FROM team_form WHERE team_id=v_my ORDER BY scheduled_date DESC, kickoff_time DESC LIMIT 5) x), '[]'::jsonb),
    'opponent_form', COALESCE((SELECT jsonb_agg(outcome ORDER BY scheduled_date DESC, kickoff_time DESC)
      FROM (SELECT * FROM team_form WHERE team_id=v_opp ORDER BY scheduled_date DESC, kickoff_time DESC LIMIT 5) x), '[]'::jsonb),
    'my_top_scorers', COALESCE((SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'name',name,'goals',goals) ORDER BY goals DESC, name)
      FROM (SELECT * FROM scorers WHERE team_id=v_my ORDER BY goals DESC LIMIT 5) x), '[]'::jsonb),
    'opponent_top_scorers', COALESCE((SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'name',name,'goals',goals) ORDER BY goals DESC, name)
      FROM (SELECT * FROM scorers WHERE team_id=v_opp ORDER BY goals DESC LIMIT 5) x), '[]'::jsonb),
    'last_meeting', (SELECT jsonb_build_object(
        'fixture_id', id, 'scheduled_date', scheduled_date, 'my_score', my_g, 'opponent_score', opp_g,
        'outcome', outcome, 'was_home', home_team_id=v_my)
      FROM meetings ORDER BY scheduled_date DESC NULLS LAST, kickoff_time DESC NULLS LAST LIMIT 1)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_fixture_opposition_intel(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fixture_opposition_intel(text, uuid) TO anon, authenticated;
