-- 091_phase2_venue_generate_fixtures.sql
--
-- Phase 2 (League Mode) — Cycle 2.3 fixture persistence RPC.
--
--   venue_generate_fixtures(p_venue_token, p_competition_id, p_fixtures)
--     Bulk-persists a pre-computed fixtures array. The roundRobin /
--     cupBracket engines run client-side; the admin reviews them
--     in the wizard preview; this RPC saves them.
--
-- p_fixtures shape — JSONB array of:
--   {
--     "week_number":     1,
--     "home_team_id":    "team_xxx",   -- must be active in competition
--     "away_team_id":    "team_yyy",   -- nullable for byes
--     "scheduled_date":  "2026-04-07", -- within season window
--     "kickoff_time":    "19:30:00",   -- 'HH:MM' or 'HH:MM:SS'
--     "playing_area_id": "<uuid>",     -- nullable, must belong to venue
--     "round_name":      "Quarter-final" -- nullable
--   }
--
-- Validation:
--   - Caller resolves to venue_id (resolve_venue_caller)
--   - p_competition_id exists AND its season's league belongs to venue
--   - No existing fixtures for the competition (idempotency guard)
--   - Every home_team_id + away_team_id is an ACTIVE registration in
--     this competition
--   - Every scheduled_date falls within the parent season's window
--   - Every playing_area_id (if provided) belongs to this venue
--   - kickoff_time normalises to HH:MM:SS
--
-- ONE audit_event with metadata.fixture_count (per Phase 2 audit rule:
-- bulk inserts get one row, not one per fixture).
--
-- Returns:
--   { "ok": true, "competition_id": "<uuid>", "fixture_count": N }

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
  -- Resolve caller
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  -- Validate competition belongs to caller's venue
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

  -- Idempotency: no existing fixtures
  IF EXISTS (SELECT 1 FROM fixtures WHERE competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'fixtures_already_exist' USING ERRCODE = 'P0001';
  END IF;

  -- Validate fixtures array
  IF p_fixtures IS NULL OR jsonb_typeof(p_fixtures) <> 'array' THEN
    RAISE EXCEPTION 'fixtures_required' USING ERRCODE = 'P0001';
  END IF;
  v_fixture_count := jsonb_array_length(p_fixtures);
  IF v_fixture_count = 0 THEN
    RAISE EXCEPTION 'fixtures_empty' USING ERRCODE = 'P0001';
  END IF;

  -- Snapshot active team registrations + venue pitches for batch validation
  SELECT array_agg(team_id) INTO v_active_team_ids
  FROM competition_teams
  WHERE competition_id = p_competition_id AND status = 'active';

  IF v_active_team_ids IS NULL OR array_length(v_active_team_ids, 1) < 2 THEN
    RAISE EXCEPTION 'competition_has_too_few_active_teams' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(id) INTO v_venue_pitch_ids
  FROM playing_areas
  WHERE venue_id = v_venue_id;

  -- Validate every fixture
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

  -- Bulk INSERT
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

  -- Audit (one row, not one per fixture)
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

  -- Broadcast
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
