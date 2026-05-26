-- 106_phase2_venue_update_pitch.sql
--
-- Phase 2 (League Mode) — Cycle 2.6 pitch partial-update RPC.
--
--   venue_update_pitch(p_venue_token, p_pitch_id, p_updates jsonb)
--     Updates ONLY the keys present in p_updates. Other columns
--     stay as-is. Soft-delete pattern: pass {"active": false} to
--     retire a pitch rather than DELETE (fixtures.playing_area_id
--     FK uses ON DELETE SET NULL, so hard-delete would orphan
--     historical fixtures).
--
-- Updatable keys (all optional):
--   "name"               text, 1..120
--   "surface"            text or null
--   "capacity"           positive int or null
--   "active"             boolean
--   "is_available"       boolean
--   "sort_order"         int
--   "maintenance_windows" jsonb array of {start_date, end_date, reason?}
--
-- Audit metadata captures the keys actually changed.
-- Broadcast reason: 'pitch_closed' when active flips true→false,
-- else 'pitch_updated'.

CREATE OR REPLACE FUNCTION public.venue_update_pitch(
  p_venue_token text,
  p_pitch_id    uuid,
  p_updates     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_pitch record;
  v_was_active boolean;
  v_will_close boolean := false;
  v_capacity int;
  v_mw jsonb;
  v_w jsonb;
  v_changed text[] := ARRAY[]::text[];
  v_reason text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_pitch_id IS NULL THEN
    RAISE EXCEPTION 'pitch_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object'
     OR p_updates = '{}'::jsonb THEN
    RAISE EXCEPTION 'updates_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, venue_id, active INTO v_pitch
  FROM playing_areas WHERE id = p_pitch_id;
  IF v_pitch.id IS NULL THEN
    RAISE EXCEPTION 'pitch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_pitch.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  v_was_active := v_pitch.active;

  IF p_updates ? 'name' THEN
    IF NULLIF(trim(p_updates->>'name'), '') IS NULL
       OR length(trim(p_updates->>'name')) > 120 THEN
      RAISE EXCEPTION 'pitch_name_invalid' USING ERRCODE = 'P0001';
    END IF;
    UPDATE playing_areas SET name = trim(p_updates->>'name') WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'name');
  END IF;
  IF p_updates ? 'surface' THEN
    UPDATE playing_areas SET surface = NULLIF(p_updates->>'surface', '') WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'surface');
  END IF;
  IF p_updates ? 'capacity' THEN
    IF (p_updates->>'capacity') IS NULL THEN
      UPDATE playing_areas SET capacity = NULL WHERE id = p_pitch_id;
    ELSE
      v_capacity := (p_updates->>'capacity')::int;
      IF v_capacity < 1 THEN
        RAISE EXCEPTION 'pitch_capacity_invalid' USING ERRCODE = 'P0001';
      END IF;
      UPDATE playing_areas SET capacity = v_capacity WHERE id = p_pitch_id;
    END IF;
    v_changed := array_append(v_changed, 'capacity');
  END IF;
  IF p_updates ? 'active' THEN
    IF v_was_active AND NOT (p_updates->>'active')::boolean THEN
      v_will_close := true;
    END IF;
    UPDATE playing_areas SET active = (p_updates->>'active')::boolean WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'active');
  END IF;
  IF p_updates ? 'is_available' THEN
    UPDATE playing_areas SET is_available = (p_updates->>'is_available')::boolean WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'is_available');
  END IF;
  IF p_updates ? 'sort_order' THEN
    UPDATE playing_areas SET sort_order = (p_updates->>'sort_order')::int WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'sort_order');
  END IF;
  IF p_updates ? 'maintenance_windows' THEN
    v_mw := p_updates->'maintenance_windows';
    IF v_mw IS NULL OR v_mw = 'null'::jsonb THEN
      v_mw := '[]'::jsonb;
    END IF;
    IF jsonb_typeof(v_mw) <> 'array' THEN
      RAISE EXCEPTION 'maintenance_windows_invalid' USING ERRCODE = 'P0001';
    END IF;
    FOR v_w IN SELECT * FROM jsonb_array_elements(v_mw) LOOP
      IF (v_w->>'start_date') IS NULL OR (v_w->>'end_date') IS NULL THEN
        RAISE EXCEPTION 'maintenance_window_dates_required' USING ERRCODE = 'P0001';
      END IF;
      IF (v_w->>'start_date')::date > (v_w->>'end_date')::date THEN
        RAISE EXCEPTION 'maintenance_window_dates_inverted' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    UPDATE playing_areas SET maintenance_windows = v_mw WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'maintenance_windows');
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RAISE EXCEPTION 'no_recognised_keys' USING ERRCODE = 'P0001';
  END IF;

  v_reason := CASE WHEN v_will_close THEN 'pitch_closed' ELSE 'pitch_updated' END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    v_reason, 'playing_area', p_pitch_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'changed_keys', v_changed,
                       'updates', p_updates)
  );

  PERFORM public.notify_venue_change(v_venue_id, v_reason);

  RETURN jsonb_build_object('ok', true, 'pitch_id', p_pitch_id,
                            'changed_keys', v_changed,
                            'pitch_closed', v_will_close);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_update_pitch(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_pitch(text, uuid, jsonb) TO anon, authenticated;
