-- Migration 143 — Pitch Booking Stage 2b (venue-owned): confirmed-clash gate.
-- venue_assign_pitch / venue_generate_fixtures now detect an overlapping
-- CONFIRMED booking before writing the fixture. If any confirmed clash is not
-- explicitly approved via p_displace_booking_ids[], they refuse with
-- 'confirmed_booking_clash' (DETAIL = csv of clashing booking ids). Approved
-- ids are displaced (occupancy active=false, status='superseded', notify) in
-- the same txn before the fixture write. Un-confirmed bookings are auto-yielded
-- by the trigger (mig 142) — not handled here.
--
-- New param p_displace_booking_ids uuid[] DEFAULT '{}'. The old 3-arg
-- signatures are DROPPed; existing named-arg JS calls resolve to the new
-- 4-arg via the default. PostgREST cache reloaded at the end.

DROP FUNCTION IF EXISTS public.venue_assign_pitch(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.venue_generate_fixtures(text, uuid, jsonb);

-- ── venue_assign_pitch (4-arg) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_assign_pitch(
  p_venue_token        text,
  p_fixture_id         uuid,
  p_playing_area_id    uuid,
  p_displace_booking_ids uuid[] DEFAULT '{}'
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
  v_slot int;
  v_start timestamptz;
  v_range tstzrange;
  v_clash_ids uuid[];
  v_undisplaced uuid[];
  v_b record;
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
         f.kickoff_time, f.slot_minutes,
         s.league_id, l.venue_id AS l_venue, lc.slot_minutes AS lc_slot
  INTO v_fixture
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  LEFT JOIN league_config lc ON lc.league_id = l.id
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

    -- Confirmed-booking clash gate (only when the fixture has a concrete slot)
    IF v_fixture.scheduled_date IS NOT NULL AND v_fixture.kickoff_time IS NOT NULL THEN
      v_slot  := COALESCE(v_fixture.slot_minutes, v_fixture.lc_slot, 60);
      v_start := (v_fixture.scheduled_date + v_fixture.kickoff_time) AT TIME ZONE 'Europe/London';
      v_range := tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)');

      SELECT array_agg(b.id) INTO v_clash_ids
      FROM pitch_occupancy po
      JOIN pitch_bookings b ON b.id = po.source_id::uuid
      WHERE po.playing_area_id = p_playing_area_id
        AND po.active AND po.source_kind = 'booking'
        AND b.status = 'confirmed'
        AND po.time_range && v_range;

      IF v_clash_ids IS NOT NULL THEN
        SELECT array_agg(x) INTO v_undisplaced
        FROM unnest(v_clash_ids) x
        WHERE NOT (x = ANY(COALESCE(p_displace_booking_ids, '{}'::uuid[])));
        IF v_undisplaced IS NOT NULL AND array_length(v_undisplaced, 1) > 0 THEN
          RAISE EXCEPTION 'confirmed_booking_clash' USING ERRCODE = 'P0001',
            DETAIL = array_to_string(v_undisplaced, ',');
        END IF;
        FOR v_b IN SELECT b.id, b.team_id, b.venue_id FROM pitch_bookings b WHERE b.id = ANY(v_clash_ids) LOOP
          UPDATE pitch_occupancy SET active = false WHERE source_kind='booking' AND source_id = v_b.id::text;
          UPDATE pitch_bookings  SET status = 'superseded' WHERE id = v_b.id;
          PERFORM public.notify_venue_change(v_b.venue_id, 'booking_superseded');
          IF v_b.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_b.team_id, 'booking_superseded'); END IF;
        END LOOP;
      END IF;
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
      'new_status', v_new_status,
      'displaced_booking_ids', p_displace_booking_ids
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

REVOKE ALL ON FUNCTION public.venue_assign_pitch(text, uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_assign_pitch(text, uuid, uuid, uuid[]) TO anon, authenticated;

-- ── venue_generate_fixtures (4-arg) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_generate_fixtures(
  p_venue_token        text,
  p_competition_id     uuid,
  p_fixtures           jsonb,
  p_displace_booking_ids uuid[] DEFAULT '{}'
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
  v_lc_slot int;
  v_start timestamptz;
  v_range tstzrange;
  v_clash_ids uuid[] := '{}'::uuid[];
  v_undisplaced uuid[];
  v_b record;
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

  SELECT lc.slot_minutes INTO v_lc_slot FROM league_config lc WHERE lc.league_id = v_league_id;

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
      RAISE EXCEPTION 'fixture_home_team_invalid' USING ERRCODE = 'P0001', DETAIL = v_home;
    END IF;
    IF v_away IS NOT NULL AND NOT (v_away = ANY(v_active_team_ids)) THEN
      RAISE EXCEPTION 'fixture_away_team_invalid' USING ERRCODE = 'P0001', DETAIL = v_away;
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

    -- accumulate confirmed-booking clashes for this fixture's slot
    IF (v_fx->>'playing_area_id') IS NOT NULL
       AND (v_fx->>'scheduled_date') IS NOT NULL
       AND (v_fx->>'kickoff_time') IS NOT NULL THEN
      v_kickoff_text := v_fx->>'kickoff_time';
      IF length(v_kickoff_text) = 5 THEN v_kickoff_text := v_kickoff_text || ':00'; END IF;
      v_start := ((v_fx->>'scheduled_date')::date + v_kickoff_text::time) AT TIME ZONE 'Europe/London';
      v_range := tstzrange(v_start, v_start + make_interval(mins => COALESCE(v_lc_slot, 60)), '[)');
      v_clash_ids := v_clash_ids || COALESCE((
        SELECT array_agg(b.id)
        FROM pitch_occupancy po JOIN pitch_bookings b ON b.id = po.source_id::uuid
        WHERE po.playing_area_id = (v_fx->>'playing_area_id')::uuid
          AND po.active AND po.source_kind = 'booking'
          AND b.status = 'confirmed' AND po.time_range && v_range
      ), '{}'::uuid[]);
    END IF;
  END LOOP;

  -- confirmed-clash gate across the whole batch
  IF array_length(v_clash_ids, 1) > 0 THEN
    SELECT array_agg(DISTINCT x) INTO v_undisplaced
    FROM unnest(v_clash_ids) x
    WHERE NOT (x = ANY(COALESCE(p_displace_booking_ids, '{}'::uuid[])));
    IF v_undisplaced IS NOT NULL AND array_length(v_undisplaced, 1) > 0 THEN
      RAISE EXCEPTION 'confirmed_booking_clash' USING ERRCODE = 'P0001',
        DETAIL = array_to_string(v_undisplaced, ',');
    END IF;
    FOR v_b IN SELECT DISTINCT b.id, b.team_id, b.venue_id FROM pitch_bookings b WHERE b.id = ANY(v_clash_ids) LOOP
      UPDATE pitch_occupancy SET active = false WHERE source_kind='booking' AND source_id = v_b.id::text;
      UPDATE pitch_bookings  SET status = 'superseded' WHERE id = v_b.id;
      PERFORM public.notify_venue_change(v_b.venue_id, 'booking_superseded');
      IF v_b.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_b.team_id, 'booking_superseded'); END IF;
    END LOOP;
  END IF;

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
      'fixture_count', v_fixture_count,
      'displaced_booking_ids', p_displace_booking_ids
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

REVOKE ALL ON FUNCTION public.venue_generate_fixtures(text, uuid, jsonb, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_generate_fixtures(text, uuid, jsonb, uuid[]) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
