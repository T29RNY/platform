-- 203_phase2_league_reschedule_fixture.sql
--
-- League dashboard write: move a fixture to a new date/time. League owns the
-- calendar (pitch allocation stays a venue concern). Allowed from scheduled /
-- allocated / postponed; rescheduling a postponed fixture revives it (back to
-- 'allocated' if it still has a pitch, else 'scheduled'). Ownership via
-- competition -> season.league_id.
-- Ephemeral-verify (with mig 202): postpone->reschedule path + error paths.
--
--   league_reschedule_fixture(p_league_token, p_fixture_id, p_scheduled_date, p_kickoff_time, p_reason)

CREATE OR REPLACE FUNCTION public.league_reschedule_fixture(
  p_league_token   text,
  p_fixture_id     uuid,
  p_scheduled_date date,
  p_kickoff_time   time,
  p_reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_league_id text;
  v_venue_id text;
  v_fixture record;
  v_new_status text;
  v_prev_date date;
  v_prev_time time;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_league_caller(p_league_token);
  IF v_caller IS NULL OR v_caller.league_id IS NULL THEN
    RAISE EXCEPTION 'invalid_league_token' USING ERRCODE = 'P0001';
  END IF;
  v_league_id := v_caller.league_id;
  v_venue_id  := v_caller.venue_id;

  IF p_fixture_id IS NULL THEN RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001'; END IF;
  IF p_scheduled_date IS NULL THEN RAISE EXCEPTION 'date_required' USING ERRCODE = 'P0001'; END IF;
  IF p_kickoff_time IS NULL THEN RAISE EXCEPTION 'kickoff_required' USING ERRCODE = 'P0001'; END IF;

  SELECT f.id, f.status, f.competition_id, f.home_team_id, f.away_team_id,
         f.scheduled_date, f.kickoff_time, f.playing_area_id, s.league_id
  INTO v_fixture
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  WHERE f.id = p_fixture_id;

  IF v_fixture.id IS NULL THEN RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_fixture.league_id <> v_league_id THEN RAISE EXCEPTION 'fixture_not_in_league' USING ERRCODE = 'P0001'; END IF;
  IF v_fixture.status NOT IN ('scheduled','allocated','postponed') THEN
    RAISE EXCEPTION 'cannot_reschedule' USING ERRCODE = 'P0001', DETAIL = v_fixture.status;
  END IF;

  v_prev_date := v_fixture.scheduled_date;
  v_prev_time := v_fixture.kickoff_time;
  v_new_status := CASE
    WHEN v_fixture.status = 'postponed' THEN (CASE WHEN v_fixture.playing_area_id IS NOT NULL THEN 'allocated' ELSE 'scheduled' END)
    ELSE v_fixture.status END;

  UPDATE fixtures
     SET scheduled_date = p_scheduled_date,
         kickoff_time   = p_kickoff_time,
         status         = v_new_status,
         postpone_reason = CASE WHEN v_fixture.status = 'postponed' THEN NULL ELSE postpone_reason END
   WHERE id = p_fixture_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_fixture.home_team_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'fixture_rescheduled', 'fixture', p_fixture_id::text,
    jsonb_build_object('competition_id', v_fixture.competition_id, 'league_id', v_league_id,
      'previous_date', v_prev_date, 'previous_time', v_prev_time,
      'new_date', p_scheduled_date, 'new_time', p_kickoff_time,
      'previous_status', v_fixture.status, 'new_status', v_new_status,
      'reason', NULLIF(trim(COALESCE(p_reason,'')), ''))
  );

  PERFORM public.notify_league_change(v_league_id, 'fixture_status_changed');
  IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, 'fixture_scheduled'); END IF;

  RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id,
    'scheduled_date', p_scheduled_date, 'kickoff_time', p_kickoff_time, 'status', v_new_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.league_reschedule_fixture(text, uuid, date, time, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.league_reschedule_fixture(text, uuid, date, time, text) TO anon, authenticated;
