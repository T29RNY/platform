-- Migration 138 — Pitch Booking Stage 2a (venue-owned).
-- Now that the fixture-mirror trigger (137) enforces the partial EXCLUDE,
-- the two fixture-write RPCs that set a pitch+time can hit a raw 23P01
-- (exclusion_violation) when a slot is already taken. Translate that to a
-- friendly 'pitch_double_booked' so operators get a clear error, not a raw
-- constraint message. Bodies otherwise identical to mig 109 / mig 091.
--
-- The confirmed-clash gate (querying pitch_bookings + p_displace_booking_ids[])
-- is Stage 2b — it needs the pitch_bookings table (Stage 3).

-- ──────────────────────────────────────────────────────────────────
-- venue_assign_pitch — wrap the fixture UPDATE (mig 109 body otherwise)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_assign_pitch(
  p_venue_token   text,
  p_fixture_id    uuid,
  p_playing_area_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_fixture record;
  v_league_id text;
  v_new_status text;
  v_prev_pitch uuid;
  v_mw jsonb;
  v_w jsonb;
  v_blocked_window text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.id, f.status, f.playing_area_id, f.competition_id, f.scheduled_date,
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
  IF v_fixture.status NOT IN ('scheduled','allocated') THEN
    RAISE EXCEPTION 'fixture_status_locks_pitch' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;
  v_league_id := v_fixture.league_id;
  v_prev_pitch := v_fixture.playing_area_id;

  IF p_playing_area_id IS NOT NULL THEN
    SELECT maintenance_windows INTO v_mw
    FROM playing_areas
    WHERE id = p_playing_area_id
      AND venue_id = v_venue_id
      AND active = true
      AND is_available = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pitch_unavailable' USING ERRCODE = 'P0001',
        DETAIL = p_playing_area_id::text;
    END IF;

    IF v_fixture.scheduled_date IS NOT NULL
       AND v_mw IS NOT NULL AND jsonb_typeof(v_mw) = 'array' THEN
      FOR v_w IN SELECT * FROM jsonb_array_elements(v_mw) LOOP
        IF v_fixture.scheduled_date BETWEEN (v_w->>'start_date')::date
                                       AND (v_w->>'end_date')::date THEN
          v_blocked_window := (v_w->>'start_date') || '..' || (v_w->>'end_date');
          RAISE EXCEPTION 'pitch_in_maintenance' USING ERRCODE = 'P0001',
            DETAIL = v_blocked_window;
        END IF;
      END LOOP;
    END IF;

    v_new_status := 'allocated';
  ELSE
    v_new_status := CASE WHEN v_fixture.status = 'allocated'
                         THEN 'scheduled' ELSE v_fixture.status END;
  END IF;

  BEGIN
    UPDATE fixtures
       SET playing_area_id = p_playing_area_id,
           status = v_new_status
     WHERE id = p_fixture_id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'pitch_double_booked' USING ERRCODE = 'P0001',
      DETAIL = p_playing_area_id::text;
  END;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'fixture_pitch_assigned', 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'competition_id', v_fixture.competition_id,
      'league_id', v_league_id,
      'previous_playing_area_id', v_prev_pitch,
      'playing_area_id', p_playing_area_id,
      'previous_status', v_fixture.status,
      'new_status', v_new_status
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'pitch_assigned');
  PERFORM public.notify_league_change(v_league_id, 'fixture_status_changed');

  RETURN jsonb_build_object(
    'ok', true,
    'fixture_id', p_fixture_id,
    'playing_area_id', p_playing_area_id,
    'status', v_new_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_assign_pitch(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_assign_pitch(text, uuid, uuid)
  TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────────
-- venue_generate_fixtures — wrap the bulk INSERT loop (mig 091 body otherwise)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_generate_fixtures(
  p_venue_token   text,
  p_competition_id uuid,
  p_fixtures      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_league_id text;
  v_season_id uuid;
  v_season_start date;
  v_season_end date;
  v_competition record;
  v_fixture_count int;
  v_active_team_ids text[];
  v_venue_pitch_ids uuid[];
  v_fx jsonb;
  v_home text;
  v_away text;
  v_date date;
  v_kickoff_text text;
  v_kickoff time;
  v_pitch uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT c.id, c.season_id, s.league_id, s.start_date, s.end_date,
         l.venue_id AS l_venue
  INTO v_competition
  FROM competitions c
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE c.id = p_competition_id;

  IF v_competition.id IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_competition.l_venue <> v_venue_id THEN
    RAISE EXCEPTION 'competition_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  v_league_id := v_competition.league_id;
  v_season_id := v_competition.season_id;
  v_season_start := v_competition.start_date;
  v_season_end := v_competition.end_date;

  IF EXISTS (SELECT 1 FROM fixtures WHERE competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'fixtures_already_exist' USING ERRCODE = 'P0001';
  END IF;

  IF p_fixtures IS NULL OR jsonb_typeof(p_fixtures) <> 'array' THEN
    RAISE EXCEPTION 'fixtures_required' USING ERRCODE = 'P0001';
  END IF;
  v_fixture_count := jsonb_array_length(p_fixtures);
  IF v_fixture_count = 0 THEN
    RAISE EXCEPTION 'fixtures_empty' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(team_id) INTO v_active_team_ids
  FROM competition_teams
  WHERE competition_id = p_competition_id AND status = 'active';

  IF v_active_team_ids IS NULL OR array_length(v_active_team_ids, 1) < 2 THEN
    RAISE EXCEPTION 'competition_has_too_few_active_teams' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(id) INTO v_venue_pitch_ids
  FROM playing_areas
  WHERE venue_id = v_venue_id;

  FOR v_fx IN SELECT * FROM jsonb_array_elements(p_fixtures) LOOP
    v_home := v_fx->>'home_team_id';
    v_away := v_fx->>'away_team_id';

    IF v_home IS NULL OR NOT (v_home = ANY(v_active_team_ids)) THEN
      RAISE EXCEPTION 'fixture_home_team_invalid' USING ERRCODE = 'P0001',
        DETAIL = v_home;
    END IF;
    IF v_away IS NOT NULL AND NOT (v_away = ANY(v_active_team_ids)) THEN
      RAISE EXCEPTION 'fixture_away_team_invalid' USING ERRCODE = 'P0001',
        DETAIL = v_away;
    END IF;

    IF (v_fx->>'scheduled_date') IS NOT NULL THEN
      v_date := (v_fx->>'scheduled_date')::date;
      IF v_date < v_season_start OR v_date > v_season_end THEN
        RAISE EXCEPTION 'fixture_date_outside_season' USING ERRCODE = 'P0001',
          DETAIL = v_fx->>'scheduled_date';
      END IF;
    END IF;

    IF (v_fx->>'playing_area_id') IS NOT NULL THEN
      v_pitch := (v_fx->>'playing_area_id')::uuid;
      IF v_venue_pitch_ids IS NULL OR NOT (v_pitch = ANY(v_venue_pitch_ids)) THEN
        RAISE EXCEPTION 'fixture_pitch_not_in_venue' USING ERRCODE = 'P0001',
          DETAIL = v_fx->>'playing_area_id';
      END IF;
    END IF;
  END LOOP;

  BEGIN
    FOR v_fx IN SELECT * FROM jsonb_array_elements(p_fixtures) LOOP
      v_home := v_fx->>'home_team_id';
      v_away := v_fx->>'away_team_id';
      v_date := NULLIF(v_fx->>'scheduled_date', '')::date;
      v_kickoff_text := v_fx->>'kickoff_time';
      IF v_kickoff_text IS NOT NULL AND length(v_kickoff_text) = 5 THEN
        v_kickoff_text := v_kickoff_text || ':00';
      END IF;
      v_kickoff := NULLIF(v_kickoff_text, '')::time;
      v_pitch := NULLIF(v_fx->>'playing_area_id', '')::uuid;

      INSERT INTO fixtures (
        competition_id, home_team_id, away_team_id,
        week_number, round_name,
        scheduled_date, kickoff_time,
        playing_area_id, status
      )
      VALUES (
        p_competition_id, v_home, v_away,
        (v_fx->>'week_number')::int, NULLIF(v_fx->>'round_name', ''),
        v_date, v_kickoff,
        v_pitch, 'scheduled'
      );
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'pitch_double_booked' USING ERRCODE = 'P0001';
  END;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'fixtures_generated', 'venue', v_venue_id,
    jsonb_build_object(
      'competition_id', p_competition_id,
      'season_id', v_season_id,
      'league_id', v_league_id,
      'fixture_count', v_fixture_count
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'fixtures_generated');
  PERFORM public.notify_league_change(v_league_id, 'fixtures_generated');

  RETURN jsonb_build_object(
    'ok', true,
    'competition_id', p_competition_id,
    'fixture_count', v_fixture_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_generate_fixtures(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_generate_fixtures(text, uuid, jsonb)
  TO anon, authenticated;
