-- 105_phase2_venue_add_pitch.sql
--
-- Phase 2 (League Mode) — Cycle 2.6 pitch CRUD.
--
--   venue_add_pitch(p_venue_token, p_pitch jsonb)
--     Creates a new playing_areas row owned by the caller's venue.
--
-- p_pitch shape:
--   {
--     "name":              "Pitch A",          -- required, max 120 chars
--     "surface":           "3g",               -- optional
--     "capacity":          10,                 -- optional positive int
--     "is_available":      true,               -- optional, default true
--     "sort_order":        1,                  -- optional
--     "maintenance_windows": [                 -- optional, see mig 109
--       {"start_date":"2026-05-01","end_date":"2026-05-07","reason":"resurface"}
--     ]
--   }
--
-- Validation:
--   - Caller resolves to venue (resolve_venue_caller)
--   - name required + length 1..120
--   - capacity, if present, is a positive int
--   - maintenance_windows, if present, is a jsonb array of objects
--     each with start_date <= end_date (string compare ok for ISO dates)
--
-- Audit + venue broadcast 'pitch_added'.
--
-- Returns: { "ok": true, "pitch_id": "<uuid>", "venue_id": "..." }

CREATE OR REPLACE FUNCTION public.venue_add_pitch(
  p_venue_token text,
  p_pitch       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_name text;
  v_pitch_id uuid;
  v_capacity int;
  v_mw jsonb;
  v_w jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  v_name := NULLIF(trim(p_pitch->>'name'), '');
  IF v_name IS NULL OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'pitch_name_required' USING ERRCODE = 'P0001';
  END IF;

  IF (p_pitch->>'capacity') IS NOT NULL THEN
    v_capacity := (p_pitch->>'capacity')::int;
    IF v_capacity IS NULL OR v_capacity < 1 THEN
      RAISE EXCEPTION 'pitch_capacity_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_mw := p_pitch->'maintenance_windows';
  IF v_mw IS NOT NULL AND v_mw <> 'null'::jsonb THEN
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
  END IF;

  INSERT INTO playing_areas (
    venue_id, name, surface, capacity, active, sort_order,
    is_available, maintenance_windows
  )
  VALUES (
    v_venue_id,
    v_name,
    NULLIF(p_pitch->>'surface', ''),
    v_capacity,
    true,
    COALESCE((p_pitch->>'sort_order')::int, 0),
    COALESCE((p_pitch->>'is_available')::boolean, true),
    COALESCE(v_mw, '[]'::jsonb)
  )
  RETURNING id INTO v_pitch_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'pitch_added', 'playing_area', v_pitch_id::text,
    jsonb_build_object('name', v_name, 'venue_id', v_venue_id)
  );

  PERFORM public.notify_venue_change(v_venue_id, 'pitch_added');

  RETURN jsonb_build_object('ok', true, 'pitch_id', v_pitch_id, 'venue_id', v_venue_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_add_pitch(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_add_pitch(text, jsonb) TO anon, authenticated;
