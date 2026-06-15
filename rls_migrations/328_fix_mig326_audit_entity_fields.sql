-- Migration 328 — Fix mig 326 audit_events: missing entity_type + entity_id
--
-- Bug: three write RPCs shipped in mig 326 omit entity_type and entity_id
-- from their audit_events INSERT. Both columns are NOT NULL since mig 003.
-- Every call to these RPCs throws a NOT NULL constraint violation at runtime.
-- Event OS is not yet live in production so no users are affected.
--
-- Affected RPCs:
--   1. club_admin_set_performance_config    → entity_type='tournament_event',  entity_id=p_tournament_event_id
--   2. club_admin_add_performance_event     → entity_type='performance_event', entity_id=v_event_id
--   3. club_admin_record_result             → entity_type='performance_result', entity_id=v_result_id
--
-- Fix: CREATE OR REPLACE with corrected audit_events INSERT (bodies otherwise
-- identical to mig 326). No signature change → no DROP required.

-- ─── 1. club_admin_set_performance_config ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_set_performance_config(
  p_tournament_event_id uuid,
  p_points_config       jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile_id  uuid;
  v_club_id     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
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

  IF EXISTS (
    SELECT 1 FROM performance_results pr
    JOIN performance_events pe ON pe.id = pr.performance_event_id
    WHERE pe.tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'results_already_recorded' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_points_config) <> 'object' THEN
    RAISE EXCEPTION 'invalid_points_config' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events
     SET points_config = p_points_config
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin',
          'tournament_performance_config_updated',
          'tournament_event', p_tournament_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id, 'points_config', p_points_config));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_set_performance_config(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_set_performance_config(uuid, jsonb) TO authenticated;

-- ─── 2. club_admin_add_performance_event ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_add_performance_event(
  p_tournament_event_id uuid,
  p_name                text,
  p_measurement_type    text,
  p_unit                text,
  p_attempts_per_athlete int         DEFAULT 1,
  p_category            text         DEFAULT NULL,
  p_scheduled_time      timestamptz  DEFAULT NULL,
  p_display_order       int          DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile_id  uuid;
  v_club_id     text;
  v_event_id    uuid;
  v_name        text := NULLIF(btrim(p_name), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
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

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_measurement_type NOT IN ('time_asc','time_desc','distance','height','weight') THEN
    RAISE EXCEPTION 'invalid_measurement_type' USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(btrim(p_unit), '') IS NULL THEN
    RAISE EXCEPTION 'unit_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO performance_events (
    tournament_event_id, name, sport, measurement_type, unit,
    attempts_per_athlete, category, scheduled_time, display_order
  )
  VALUES (
    p_tournament_event_id, v_name, 'athletics', p_measurement_type, btrim(p_unit),
    COALESCE(p_attempts_per_athlete, 1), p_category, p_scheduled_time, p_display_order
  )
  RETURNING id INTO v_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin',
          'tournament_performance_event_added',
          'performance_event', v_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id,
                             'performance_event_id', v_event_id,
                             'name', v_name));

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_add_performance_event(uuid,text,text,text,int,text,timestamptz,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_add_performance_event(uuid,text,text,text,int,text,timestamptz,int) TO authenticated;

-- ─── 3. club_admin_record_result ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_record_result(
  p_performance_event_id uuid,
  p_athlete_name         text,
  p_competition_team_id  uuid,
  p_value                numeric,
  p_attempt_number       int    DEFAULT 1,
  p_status               text   DEFAULT 'recorded'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_profile_id    uuid;
  v_club_id       text;
  v_tournament_id uuid;
  v_result_id     uuid;
  v_name          text := NULLIF(btrim(p_athlete_name), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT pe.tournament_event_id, te.club_id
    INTO v_tournament_id, v_club_id
    FROM performance_events pe
    JOIN tournament_events te ON te.id = pe.tournament_event_id
   WHERE pe.id = p_performance_event_id
   LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
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

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'athlete_name_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'competition_team_required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    WHERE ct.id = p_competition_team_id
      AND c.tournament_event_id = v_tournament_id
  ) THEN
    RAISE EXCEPTION 'team_not_in_tournament' USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('recorded','dns','dnf','disqualified') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO performance_results (
    performance_event_id, athlete_name, competition_team_id,
    value, attempt_number, status, recorded_by
  )
  VALUES (
    p_performance_event_id, v_name, p_competition_team_id,
    p_value, COALESCE(p_attempt_number, 1), p_status, v_uid
  )
  ON CONFLICT (performance_event_id, competition_team_id, athlete_name, attempt_number)
  DO UPDATE SET
    value       = EXCLUDED.value,
    status      = EXCLUDED.status,
    recorded_at = now(),
    recorded_by = EXCLUDED.recorded_by
  RETURNING id INTO v_result_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin',
          'tournament_result_recorded',
          'performance_result', v_result_id::text,
          jsonb_build_object('performance_event_id', p_performance_event_id,
                             'result_id', v_result_id,
                             'athlete_name', v_name,
                             'value', p_value,
                             'status', p_status));

  RETURN jsonb_build_object('ok', true, 'result_id', v_result_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_record_result(uuid,text,uuid,numeric,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_record_result(uuid,text,uuid,numeric,int,text) TO authenticated;
