-- Migration 319 — Event OS: Phase 4 scheduling & day ops
-- Schema:
--   1. fixtures.home_competition_team_id uuid REFERENCES competition_teams(id) — nullable
--   2. fixtures.away_competition_team_id uuid REFERENCES competition_teams(id) — nullable
--   3. fixtures.home_team_id → nullable + identity CHECK
-- RPCs (all authenticated-only, club-manager gated):
--   club_admin_generate_schedule   — circle-method round-robin fixture generation
--   club_admin_get_schedule        — read competitions + fixtures + venue pitches
--   club_admin_assign_fixture_slot — update a single fixture slot

-- ─── 1. Schema ───────────────────────────────────────────────────────────────

ALTER TABLE public.fixtures
  ADD COLUMN home_competition_team_id uuid REFERENCES public.competition_teams(id),
  ADD COLUMN away_competition_team_id uuid REFERENCES public.competition_teams(id);

ALTER TABLE public.fixtures ALTER COLUMN home_team_id DROP NOT NULL;

ALTER TABLE public.fixtures
  ADD CONSTRAINT fixtures_home_identity
    CHECK (home_team_id IS NOT NULL OR home_competition_team_id IS NOT NULL);

-- ─── 2. club_admin_generate_schedule ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_generate_schedule(
  p_tournament_event_id uuid,
  p_competition_id      uuid,
  p_slot_minutes        int,
  p_start_time          time,
  p_start_date          date,
  p_playing_area_ids    uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile_id  uuid;
  v_club_id     text;
  v_venue_id    text;
  v_teams       uuid[];
  v_n           int;
  v_m           int;
  v_pitch_n     int;
  v_round       int;
  v_slot        int;
  v_home        uuid;
  v_away        uuid;
  v_match_count int := 0;
  v_kickoff     time;
  v_pitch       uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id, te.venue_id
    INTO v_club_id, v_venue_id
    FROM tournament_events te
   WHERE te.id = p_tournament_event_id
   LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM fixtures WHERE competition_id = p_competition_id LIMIT 1) THEN
    RAISE EXCEPTION 'fixtures_already_exist' USING ERRCODE = 'P0001';
  END IF;

  -- Validate all pitches belong to the tournament's venue
  v_pitch_n := COALESCE(array_length(p_playing_area_ids, 1), 0);
  IF v_pitch_n > 0 AND EXISTS (
    SELECT 1 FROM unnest(p_playing_area_ids) AS t(pa_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM playing_areas pa
      WHERE pa.id = t.pa_id AND pa.venue_id = v_venue_id AND pa.active = true
    )
  ) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  -- Load active teams ordered by registration time for determinism
  SELECT ARRAY(
    SELECT id FROM competition_teams
    WHERE competition_id = p_competition_id AND status = 'active'
    ORDER BY registered_at, id
  ) INTO v_teams;

  v_n := COALESCE(array_length(v_teams, 1), 0);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'not_enough_teams' USING ERRCODE = 'P0001';
  END IF;

  -- Odd N: append NULL as bye to make count even
  IF v_n % 2 = 1 THEN
    v_teams := v_teams || ARRAY[NULL::uuid];
    v_n     := v_n + 1;
  END IF;

  v_m := v_n - 1; -- number of rounds

  -- Circle method: v_teams[v_n] is fixed; v_teams[1..v_n-1] rotate each round.
  -- Each round: pair slot k → home=v_teams[k], away=v_teams[v_n-k+1] for k=1..v_n/2.
  -- After each round rotate: new = [v_teams[1], v_teams[v_n], v_teams[2..v_n-1]].
  FOR v_round IN 1..v_m LOOP
    FOR v_slot IN 1..(v_n / 2) LOOP
      v_home := v_teams[v_slot];
      v_away := v_teams[v_n - v_slot + 1];

      -- Skip bye (NULL team)
      IF v_home IS NULL OR v_away IS NULL THEN
        CONTINUE;
      END IF;

      -- Time: concurrent batches of pitch_count matches share the same slot
      v_kickoff := p_start_time
                 + ((v_match_count / GREATEST(v_pitch_n, 1)) * p_slot_minutes
                    * INTERVAL '1 minute');

      -- Pitch: cycle through available pitches
      v_pitch := CASE WHEN v_pitch_n > 0
                      THEN p_playing_area_ids[(v_match_count % v_pitch_n) + 1]
                      ELSE NULL END;

      INSERT INTO fixtures (
        competition_id,
        home_competition_team_id, away_competition_team_id,
        week_number, round_name,
        scheduled_date, kickoff_time,
        playing_area_id, slot_minutes,
        status
      ) VALUES (
        p_competition_id,
        v_home, v_away,
        v_round, 'Round ' || v_round,
        p_start_date, v_kickoff,
        v_pitch, p_slot_minutes,
        'scheduled'
      );

      v_match_count := v_match_count + 1;
    END LOOP;

    -- Rotate: keep v_teams[1] fixed, move v_teams[v_n] to position 2,
    -- shift v_teams[2..v_n-1] one step right.
    v_teams := ARRAY[v_teams[1]] || ARRAY[v_teams[v_n]] || v_teams[2:v_n - 1];
  END LOOP;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier,
     action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_schedule_generated', 'competition', p_competition_id::text,
    jsonb_build_object(
      'tournament_event_id', p_tournament_event_id,
      'fixtures_created',    v_match_count,
      'rounds',              v_m,
      'slot_minutes',        p_slot_minutes
    )
  );

  RETURN jsonb_build_object(
    'ok',               true,
    'fixtures_created', v_match_count,
    'rounds',           v_m
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_generate_schedule(uuid, uuid, int, time, date, uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_generate_schedule(uuid, uuid, int, time, date, uuid[])
  TO authenticated;

-- ─── 3. club_admin_get_schedule ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_get_schedule(
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_venue_id   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id, te.venue_id
    INTO v_club_id, v_venue_id
    FROM tournament_events te
   WHERE te.id = p_tournament_event_id
   LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'tournament_event_id', p_tournament_event_id,
    'venue_playing_areas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',   pa.id,
        'name', pa.name
      ) ORDER BY pa.sort_order, pa.name)
      FROM playing_areas pa
      WHERE pa.venue_id = v_venue_id AND pa.active = true
    ), '[]'::jsonb),
    'competitions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id', comp.id,
        'name',           comp.name,
        'type',           comp.type,
        'format',         comp.format,
        'status',         comp.status,
        'fixtures', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'fixture_id',      fx.id,
            'round',           fx.week_number,
            'round_name',      fx.round_name,
            'home_team_id',    fx.home_competition_team_id,
            'home_team_name',  ht.team_name,
            'away_team_id',    fx.away_competition_team_id,
            'away_team_name',  att.team_name,
            'scheduled_date',  fx.scheduled_date,
            'kickoff_time',    fx.kickoff_time,
            'playing_area_id', fx.playing_area_id,
            'pitch_name',      pa.name,
            'slot_minutes',    fx.slot_minutes,
            'status',          fx.status,
            'ref_token',       fx.ref_token,
            'home_score',      fx.home_score,
            'away_score',      fx.away_score
          ) ORDER BY fx.week_number, fx.kickoff_time NULLS LAST, fx.id)
          FROM fixtures fx
          LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
          LEFT JOIN competition_teams att ON att.id = fx.away_competition_team_id
          LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
          WHERE fx.competition_id = comp.id
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = p_tournament_event_id
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_get_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_schedule(uuid) TO authenticated;

-- ─── 4. club_admin_assign_fixture_slot ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_assign_fixture_slot(
  p_fixture_id      uuid,
  p_scheduled_date  date DEFAULT NULL,
  p_kickoff_time    time DEFAULT NULL,
  p_playing_area_id uuid DEFAULT NULL,
  p_slot_minutes    int  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve owning club via fixture → competition → tournament_event
  SELECT te.club_id INTO v_club_id
    FROM fixtures fx
    JOIN competitions c ON c.id = fx.competition_id
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE fx.id = p_fixture_id
   LIMIT 1;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  UPDATE fixtures
     SET scheduled_date  = COALESCE(p_scheduled_date,  scheduled_date),
         kickoff_time    = COALESCE(p_kickoff_time,    kickoff_time),
         playing_area_id = COALESCE(p_playing_area_id, playing_area_id),
         slot_minutes    = COALESCE(p_slot_minutes,    slot_minutes)
   WHERE id = p_fixture_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier,
     action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_fixture_slot_updated', 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'scheduled_date',  p_scheduled_date,
      'kickoff_time',    p_kickoff_time,
      'playing_area_id', p_playing_area_id,
      'slot_minutes',    p_slot_minutes
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_assign_fixture_slot(uuid, date, time, uuid, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_assign_fixture_slot(uuid, date, time, uuid, int)
  TO authenticated;
