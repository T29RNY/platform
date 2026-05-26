-- 094_phase2_venue_assign_pitch.sql
--
-- Phase 2 (League Mode) — Cycle 2.4 fixture pitch assignment RPC.
--
--   venue_assign_pitch(p_venue_token, p_fixture_id, p_playing_area_id)
--     Sets fixtures.playing_area_id. Pass NULL playing_area_id to
--     clear (un-allocate) the pitch.
--
-- Validation:
--   - Caller resolves to venue (resolve_venue_caller)
--   - Fixture exists AND its competition's league belongs to caller's venue
--   - Fixture.status IN ('scheduled','allocated') — pitches can't be
--     reassigned on in-progress, completed, postponed, void, walkover,
--     or forfeit fixtures
--   - p_playing_area_id (if non-NULL): belongs to caller's venue,
--     active=true, is_available=true
--
-- Behaviour:
--   - When assigning a pitch to a 'scheduled' fixture, status auto-
--     bumps to 'allocated'. When clearing the last pitch (passing NULL),
--     status reverts to 'scheduled' if it was 'allocated'.
--   - Idempotent: re-assigning the same pitch is a no-op write but
--     still emits an audit + broadcast (operator UI relies on the
--     broadcast for live confirmation).
--
-- Maintenance-window enforcement on playing_areas.maintenance_windows
-- is deferred to Cycle 2.6 (pitch CRUD) where the validator naturally
-- belongs alongside the pitch editor.
--
-- Returns:
--   { "ok": true, "fixture_id": "<uuid>", "playing_area_id": "<uuid|null>",
--     "status": "scheduled|allocated" }

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
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.id, f.status, f.playing_area_id, f.competition_id,
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
    IF NOT EXISTS (
      SELECT 1 FROM playing_areas
      WHERE id = p_playing_area_id
        AND venue_id = v_venue_id
        AND active = true
        AND is_available = true
    ) THEN
      RAISE EXCEPTION 'pitch_unavailable' USING ERRCODE = 'P0001',
        DETAIL = p_playing_area_id::text;
    END IF;
    v_new_status := 'allocated';
  ELSE
    -- Clearing the pitch: revert to 'scheduled' if it was 'allocated'.
    v_new_status := CASE WHEN v_fixture.status = 'allocated'
                         THEN 'scheduled' ELSE v_fixture.status END;
  END IF;

  UPDATE fixtures
     SET playing_area_id = p_playing_area_id,
         status = v_new_status
   WHERE id = p_fixture_id;

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
