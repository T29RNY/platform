-- 456_down: revert the Match Workout Tracking Phase 1 storage extension.
-- Restores the mig-375 state: 11-arg save_match_health_summary, no routes table, no source
-- column, no consent column, no new readers, no under-18 helper.

-- Drop the new readers first.
DROP FUNCTION IF EXISTS get_match_route(uuid);
DROP FUNCTION IF EXISTS get_match_health_for_match(text);

-- Drop the extended save (13-arg) and the route table it writes, then the helper it calls.
DROP FUNCTION IF EXISTS save_match_health_summary(text,text,text,int,numeric,numeric,int,int,jsonb,timestamptz,timestamptz,text,jsonb);
DROP TABLE IF EXISTS match_health_routes;
DROP FUNCTION IF EXISTS _health_is_under_18(uuid);

-- Restore the original mig-375 11-arg save_match_health_summary verbatim.
CREATE OR REPLACE FUNCTION save_match_health_summary(
  p_match_context     text,
  p_match_ref         text,
  p_client_session_id text,
  p_duration_seconds  int         DEFAULT NULL,
  p_active_energy_kcal numeric     DEFAULT NULL,
  p_distance_meters   numeric      DEFAULT NULL,
  p_avg_hr            int          DEFAULT NULL,
  p_max_hr            int          DEFAULT NULL,
  p_hr_zones          jsonb        DEFAULT NULL,
  p_started_at        timestamptz  DEFAULT NULL,
  p_ended_at          timestamptz  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id  uuid := auth.uid();
  v_existing uuid;
  v_id       uuid;
  v_updated  boolean;
  v_team_id  text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_match_context IS NULL OR p_match_context NOT IN ('league','casual','cohort') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_match_context';
  END IF;
  IF p_match_ref IS NULL OR p_client_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT id INTO v_existing
    FROM match_health_sessions
   WHERE user_id = v_user_id AND client_session_id = p_client_session_id;

  INSERT INTO match_health_sessions (
    user_id, match_context, match_ref, client_session_id,
    duration_seconds, active_energy_kcal, distance_meters,
    avg_hr, max_hr, hr_zones, started_at, ended_at
  ) VALUES (
    v_user_id, p_match_context, p_match_ref, p_client_session_id,
    p_duration_seconds, p_active_energy_kcal, p_distance_meters,
    p_avg_hr, p_max_hr, p_hr_zones, p_started_at, p_ended_at
  )
  ON CONFLICT (user_id, client_session_id) DO UPDATE SET
    match_context      = EXCLUDED.match_context,
    match_ref          = EXCLUDED.match_ref,
    duration_seconds   = EXCLUDED.duration_seconds,
    active_energy_kcal = EXCLUDED.active_energy_kcal,
    distance_meters    = EXCLUDED.distance_meters,
    avg_hr             = EXCLUDED.avg_hr,
    max_hr             = EXCLUDED.max_hr,
    hr_zones           = EXCLUDED.hr_zones,
    started_at         = EXCLUDED.started_at,
    ended_at           = EXCLUDED.ended_at
  RETURNING id INTO v_id;

  v_updated := (v_existing IS NOT NULL);

  IF p_match_context = 'casual' THEN
    SELECT team_id INTO v_team_id FROM matches WHERE id = p_match_ref;
  ELSE
    BEGIN
      SELECT home_team_id INTO v_team_id FROM fixtures WHERE id = p_match_ref::uuid;
    EXCEPTION WHEN others THEN
      v_team_id := NULL;
    END;
  END IF;
  v_team_id := COALESCE(v_team_id, 'health');

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', v_user_id, 'auth_uid:' || v_user_id::text,
    CASE WHEN v_updated THEN 'match_health_updated' ELSE 'match_health_saved' END,
    'match_health_session', v_id::text,
    jsonb_build_object(
      'match_context', p_match_context,
      'match_ref', p_match_ref,
      'client_session_id', p_client_session_id,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'updated', v_updated);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION save_match_health_summary(text,text,text,int,numeric,numeric,int,int,jsonb,timestamptz,timestamptz) FROM anon, public;
GRANT EXECUTE ON FUNCTION save_match_health_summary(text,text,text,int,numeric,numeric,int,int,jsonb,timestamptz,timestamptz) TO authenticated;

-- Reset the generalised comment.
COMMENT ON FUNCTION get_my_match_health() IS NULL;

-- Drop the added columns last (after the functions that referenced source are gone).
ALTER TABLE match_health_sessions DROP CONSTRAINT IF EXISTS mhs_source_check;
ALTER TABLE match_health_sessions DROP COLUMN IF EXISTS source;
ALTER TABLE players DROP COLUMN IF EXISTS share_match_fitness;

SELECT pg_notify('pgrst', 'reload schema');
