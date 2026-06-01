-- 201_phase2_league_update_fixture_result.sql
--
-- League dashboard write: a league admin corrects a completed fixture's score
-- (initial results come from the ref app; this is the override path, mirroring
-- venue_update_fixture_result mig 127). Ownership via fixture's competition ->
-- season.league_id = caller's league. Fixture must already be 'completed'.
-- Audits previous + new scores + reason; broadcasts to both teams, the league
-- and the venue.
--
-- Ephemeral-verify: 8/8 assertions pass (correct/persist/audit + 5 error
-- paths), leak-check clean.
--
--   league_update_fixture_result(p_league_token, p_fixture_id,
--                                p_home_score, p_away_score, p_reason)

CREATE OR REPLACE FUNCTION public.league_update_fixture_result(
  p_league_token text,
  p_fixture_id   uuid,
  p_home_score   integer,
  p_away_score   integer,
  p_reason       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_league_id text;
  v_venue_id  text;
  v_fixture   record;
  v_prev_home int;
  v_prev_away int;
  v_clean_reason text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_league_caller(p_league_token);
  IF v_caller IS NULL OR v_caller.league_id IS NULL THEN
    RAISE EXCEPTION 'invalid_league_token' USING ERRCODE = 'P0001';
  END IF;
  v_league_id := v_caller.league_id;
  v_venue_id  := v_caller.venue_id;

  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_home_score IS NULL OR p_away_score IS NULL THEN
    RAISE EXCEPTION 'scores_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_home_score < 0 OR p_away_score < 0 THEN
    RAISE EXCEPTION 'scores_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;

  v_clean_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.id, f.status, f.competition_id, f.home_team_id, f.away_team_id,
         f.home_score, f.away_score, s.league_id
  INTO v_fixture
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  WHERE f.id = p_fixture_id;

  IF v_fixture.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.league_id <> v_league_id THEN
    RAISE EXCEPTION 'fixture_not_in_league' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.status <> 'completed' THEN
    RAISE EXCEPTION 'fixture_not_completed' USING ERRCODE = 'P0001', DETAIL = v_fixture.status;
  END IF;

  v_prev_home := v_fixture.home_score;
  v_prev_away := v_fixture.away_score;

  UPDATE fixtures
     SET home_score = p_home_score,
         away_score = p_away_score
   WHERE id = p_fixture_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_fixture.home_team_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'league_update_fixture_result', 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'competition_id', v_fixture.competition_id,
      'league_id',      v_league_id,
      'home_team_id',   v_fixture.home_team_id,
      'away_team_id',   v_fixture.away_team_id,
      'previous_home_score', v_prev_home,
      'previous_away_score', v_prev_away,
      'new_home_score',      p_home_score,
      'new_away_score',      p_away_score,
      'reason',              v_clean_reason
    )
  );

  PERFORM public.notify_team_change(v_fixture.home_team_id, 'result_corrected');
  IF v_fixture.away_team_id IS NOT NULL THEN
    PERFORM public.notify_team_change(v_fixture.away_team_id, 'result_corrected');
  END IF;
  PERFORM public.notify_league_change(v_league_id, 'fixture_result_corrected');
  IF v_venue_id IS NOT NULL THEN
    PERFORM public.notify_venue_change(v_venue_id, 'result_corrected');
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'fixture_id', p_fixture_id,
    'home_score', p_home_score, 'away_score', p_away_score,
    'previous_home_score', v_prev_home, 'previous_away_score', v_prev_away
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.league_update_fixture_result(text, uuid, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.league_update_fixture_result(text, uuid, integer, integer, text) TO anon, authenticated;
