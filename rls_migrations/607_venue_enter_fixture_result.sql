-- 607_venue_enter_fixture_result.sql
--
-- Operator direct result-entry for a venue internal-league fixture (System A,
-- the `fixtures` table).
--
-- Today the venue console can only CORRECT an already-completed fixture
-- (venue_update_fixture_result, mig 127, which rejects a not-yet-completed
-- fixture with 'fixture_not_completed'). A FRESH result — a league game that was
-- played WITHOUT a live-scoring referee on the ref app — has no operator entry
-- path: the only way a fixture reached 'completed' was ref_confirm_full_time
-- (mig 120). This closes that gap.
--
-- Adds ONE new RPC, venue_enter_fixture_result, the operator sibling of
-- venue_update_fixture_result:
--   * guards status IN ('scheduled','allocated') — rejects 'in_progress' (a ref
--     is live-scoring; don't stomp it) and 'completed' (route to the correction
--     RPC).
--   * requires both teams to be set (an unallocated knockout slot can't be scored).
--   * writes home_score + away_score AND transitions status → 'completed' in one
--     UPDATE.
--   * reason is OPTIONAL (a first entry has no "previous scoreline" to justify;
--     unlike a correction, which mandates one).
--   * audit-logs the entered scores (Hard Rule #9).
--   * broadcasts to both teams + venue + league using ONLY already-whitelisted
--     reasons — 'match_result_saved' for team/venue (same as ref_confirm_full_time,
--     mig 120; whitelisted in notify_team_change mig 120 + notify_venue_change
--     mig 127) and 'fixture_status_changed' for the league (whitelisted in
--     notify_league_change mig 127). So NO notify_* whitelist is touched — this
--     migration is purely additive: one new function, zero edits to shipped ones.
--
-- Standings cascade: nothing to do. venue_get_standings (mig 197) /
-- get_league_standings_for_player read home_score/away_score/status from fixtures
-- at request time — the write is enough for the next standings read to reflect it.
--
-- Side-effect to be aware of (PRE-EXISTING, not introduced here): the
-- trg_reset_status_on_fixture_played trigger (mig 157) fires when a fixture goes
-- OLD.status='scheduled' → 'completed', resetting BOTH competitive squads'
-- players.status to 'none' + a 'schedule_updated' broadcast ("start fresh each
-- game"). So entering a result FROM 'scheduled' also clears that fixture's in/out
-- board — the intended "game was played" behaviour. Entering FROM 'allocated'
-- does not trip the trigger (it keys on OLD.status='scheduled' only); a harmless
-- asymmetry, left as-is (the trigger is deliberately not edited).
--
-- RLS / grants: SECURITY DEFINER, search_path locked, REVOKE FROM PUBLIC,
-- GRANT EXECUTE to anon + authenticated — same shape as mig 127
-- (venue_update_fixture_result). Auth is enforced inside via resolve_venue_caller.

CREATE OR REPLACE FUNCTION public.venue_enter_fixture_result(
  p_venue_token text,
  p_fixture_id  uuid,
  p_home_score  integer,
  p_away_score  integer,
  p_reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       record;
  v_venue_id     text;
  v_fixture      record;
  v_league_id    text;
  v_clean_reason text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_home_score IS NULL OR p_away_score IS NULL THEN
    RAISE EXCEPTION 'scores_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_home_score < 0 OR p_away_score < 0 THEN
    RAISE EXCEPTION 'scores_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;

  v_clean_reason := NULLIF(trim(COALESCE(p_reason, '')), '');  -- optional on entry

  SELECT f.id, f.status, f.competition_id, f.home_team_id, f.away_team_id,
         s.league_id, l.venue_id AS l_venue
  INTO v_fixture
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE f.id = p_fixture_id;

  IF v_fixture.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.l_venue <> v_venue_id THEN
    RAISE EXCEPTION 'fixture_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.status NOT IN ('scheduled', 'allocated') THEN
    -- 'in_progress' → ref is live-scoring; 'completed' → use the correction RPC;
    -- any terminal status (void/postponed/walkover/forfeit) → not enterable.
    RAISE EXCEPTION 'fixture_not_enterable' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;
  IF v_fixture.home_team_id IS NULL OR v_fixture.away_team_id IS NULL THEN
    RAISE EXCEPTION 'fixture_teams_not_set' USING ERRCODE = 'P0001';
  END IF;

  v_league_id := v_fixture.league_id;

  UPDATE fixtures
     SET home_score = p_home_score,
         away_score = p_away_score,
         status     = 'completed'
   WHERE id = p_fixture_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_fixture.home_team_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'venue_enter_fixture_result', 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'competition_id', v_fixture.competition_id,
      'league_id',      v_league_id,
      'home_team_id',   v_fixture.home_team_id,
      'away_team_id',   v_fixture.away_team_id,
      'home_score',     p_home_score,
      'away_score',     p_away_score,
      'from_status',    v_fixture.status,
      'reason',         v_clean_reason
    )
  );

  PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_result_saved');
  IF v_fixture.away_team_id IS NOT NULL THEN
    PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_result_saved');
  END IF;
  PERFORM public.notify_venue_change(v_venue_id, 'match_result_saved');
  PERFORM public.notify_league_change(v_league_id, 'fixture_status_changed');

  RETURN jsonb_build_object(
    'ok',         true,
    'fixture_id', p_fixture_id,
    'home_score', p_home_score,
    'away_score', p_away_score,
    'status',     'completed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_enter_fixture_result(text, uuid, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_enter_fixture_result(text, uuid, integer, integer, text)
  TO anon, authenticated;
