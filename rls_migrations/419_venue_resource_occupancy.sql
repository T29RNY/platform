-- 419_venue_resource_occupancy.sql
-- Unified Resource Calendar — PHASE 1 (read-only): one normalised occupancy feed
-- across pitches + rooms (room hires UNION class sessions) + trainers, for EVERY
-- venue this operator runs (same company_id, mirroring get_operator_pitch_occupancy).
-- Read-only: no writes, no schema change. Detail builders mirror _pitch_occupancy_detail.
-- Forward consumers (RPCS.md / Hard Rule #14): venue-app unified calendar (this phase);
-- Phase 2 book-from-calendar tap routing (same feed); a future HQ cross-site utilisation
-- view may reuse it — keep the per-venue {pitches,rooms,trainers,occupancy} shape stable.

-- ── 1. Room occupancy detail (covers BOTH room hires and class sessions) ──────
-- Definer-only. Returns the per-block detail for a room lane. Class blocks lead with
-- the class name (room becomes the subheading on the calendar).
CREATE OR REPLACE FUNCTION public._room_occupancy_detail(p_kind text, p_source_id text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT CASE p_kind
    WHEN 'room_hire' THEN (
      SELECT jsonb_build_object(
        'space_id', h.space_id, 'space_name', sp.name, 'space_type', sp.space_type,
        'booker', COALESCE(h.booker_name,
                  btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,''))),
        'purpose', h.purpose, 'status', h.status, 'attendee_count', h.attendee_count)
      FROM public.venue_room_hires h
      JOIN public.venue_spaces sp ON sp.id = h.space_id
      LEFT JOIN public.member_profiles mp ON mp.id = h.member_profile_id
      WHERE h.id = p_source_id::uuid)
    WHEN 'class' THEN (
      SELECT jsonb_build_object(
        'class_name', ct.name, 'category', ct.category,
        'space_id', cs.space_id, 'space_name', sp.name, 'space_type', sp.space_type,
        'status', cs.status, 'capacity', cs.capacity,
        'instructor', tr.display_name)
      FROM public.venue_class_sessions cs
      JOIN public.venue_class_types ct ON ct.id = cs.class_type_id
      JOIN public.venue_spaces sp ON sp.id = cs.space_id
      LEFT JOIN public.venue_trainers tr ON tr.id = cs.instructor_id
      WHERE cs.id = p_source_id::uuid)
    ELSE NULL
  END;
$fn$;
REVOKE ALL     ON FUNCTION public._room_occupancy_detail(text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public._room_occupancy_detail(text, text) FROM anon, authenticated;

-- ── 2. Trainer occupancy detail (PT appointments) ────────────────────────────
CREATE OR REPLACE FUNCTION public._trainer_occupancy_detail(p_source_id text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'trainer_id', ap.trainer_id, 'trainer_name', tr.display_name,
    'member_name', btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')),
    'status', ap.status, 'payment_mode', ap.payment_mode)
  FROM public.venue_appointments ap
  JOIN public.venue_trainers tr  ON tr.id = ap.trainer_id
  LEFT JOIN public.member_profiles mp ON mp.id = ap.member_profile_id
  WHERE ap.id = p_source_id::uuid;
$fn$;
REVOKE ALL     ON FUNCTION public._trainer_occupancy_detail(text) FROM public;
REVOKE EXECUTE ON FUNCTION public._trainer_occupancy_detail(text) FROM anon, authenticated;

-- ── 3. get_venue_resource_occupancy — unified cross-site, cross-resource feed ─
-- Per venue: resource directories (pitches/rooms/trainers) + a single occupancy[]
-- mixing all lane types. Equipment is NOT here (it's a quantity-over-time strip, read
-- via get_equipment_availability for the visible day). Mirrors get_operator_pitch_occupancy.
CREATE OR REPLACE FUNCTION public.get_venue_resource_occupancy(p_venue_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_company  text;
  v_venue_id text;
  v_range    tstzrange;
  v_lo       timestamptz;
  v_hi       timestamptz;
  v_result   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'date_range_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT company_id INTO v_company FROM public.venues WHERE id = v_venue_id;

  v_lo := (p_from::timestamp) AT TIME ZONE 'Europe/London';
  v_hi := ((p_to + 1)::timestamp) AT TIME ZONE 'Europe/London';
  v_range := tstzrange(v_lo, v_hi, '[)');

  SELECT COALESCE(jsonb_agg(vrow ORDER BY vname), '[]'::jsonb) INTO v_result FROM (
    SELECT v.name AS vname, jsonb_build_object(
      'venue_id', v.id,
      'venue_name', v.name,
      'venue_address', NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''),
      'is_self', (v.id = v_venue_id),
      'pitches', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pa.id, 'name', pa.name)
                         ORDER BY pa.sort_order, pa.name) FILTER (WHERE pa.active), '[]'::jsonb)
        FROM public.playing_areas pa WHERE pa.venue_id = v.id
      ),
      'rooms', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', sp.id, 'name', sp.name, 'space_type', sp.space_type)
                         ORDER BY sp.name) FILTER (WHERE sp.is_active), '[]'::jsonb)
        FROM public.venue_spaces sp WHERE sp.venue_id = v.id
      ),
      'trainers', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', tr.id, 'name', tr.display_name)
                         ORDER BY tr.display_name) FILTER (WHERE tr.active), '[]'::jsonb)
        FROM public.venue_trainers tr WHERE tr.venue_id = v.id
      ),
      'occupancy', (
        SELECT COALESCE(jsonb_agg(orow ORDER BY ostart, oname), '[]'::jsonb) FROM (
          -- pitches (reuse the pitch lane + its detail builder verbatim)
          SELECT lower(po.time_range) AS ostart, pa.name AS oname, jsonb_build_object(
            'id', 'po:' || po.id, 'resource_type', 'pitch', 'resource_id', po.playing_area_id,
            'resource_name', pa.name, 'source_kind', po.source_kind, 'source_id', po.source_id,
            'start', lower(po.time_range), 'end', upper(po.time_range),
            'detail', public._pitch_occupancy_detail(po.source_kind, po.source_id)) AS orow
          FROM public.pitch_occupancy po
          JOIN public.playing_areas pa ON pa.id = po.playing_area_id
          WHERE po.venue_id = v.id AND po.active AND po.time_range && v_range
          UNION ALL
          -- room hires
          SELECT h.starts_at, sp.name, jsonb_build_object(
            'id', 'rh:' || h.id, 'resource_type', 'room', 'resource_id', h.space_id,
            'resource_name', sp.name, 'source_kind', 'room_hire', 'source_id', h.id::text,
            'start', h.starts_at, 'end', h.ends_at,
            'detail', public._room_occupancy_detail('room_hire', h.id::text))
          FROM public.venue_room_hires h
          JOIN public.venue_spaces sp ON sp.id = h.space_id
          WHERE h.venue_id = v.id AND h.status IN ('confirmed','requested')
            AND h.starts_at < v_hi AND h.ends_at > v_lo
          UNION ALL
          -- class sessions (occupy a room/space)
          SELECT cs.starts_at, sp.name, jsonb_build_object(
            'id', 'cs:' || cs.id, 'resource_type', 'room', 'resource_id', cs.space_id,
            'resource_name', sp.name, 'source_kind', 'class', 'source_id', cs.id::text,
            'start', cs.starts_at, 'end', cs.ends_at,
            'detail', public._room_occupancy_detail('class', cs.id::text))
          FROM public.venue_class_sessions cs
          JOIN public.venue_spaces sp ON sp.id = cs.space_id
          WHERE cs.venue_id = v.id AND cs.status = 'scheduled'
            AND cs.starts_at < v_hi AND cs.ends_at > v_lo
          UNION ALL
          -- PT appointments (occupy a trainer)
          SELECT ap.starts_at, tr.display_name, jsonb_build_object(
            'id', 'ap:' || ap.id, 'resource_type', 'trainer', 'resource_id', ap.trainer_id,
            'resource_name', tr.display_name, 'source_kind', 'appointment', 'source_id', ap.id::text,
            'start', ap.starts_at, 'end', ap.ends_at,
            'detail', public._trainer_occupancy_detail(ap.id::text))
          FROM public.venue_appointments ap
          JOIN public.venue_trainers tr ON tr.id = ap.trainer_id
          WHERE ap.venue_id = v.id AND ap.status = 'confirmed'
            AND ap.starts_at < v_hi AND ap.ends_at > v_lo
        ) occ
      )
    ) AS vrow
    FROM public.venues v
    WHERE v.id = v_venue_id
       OR (v_company IS NOT NULL AND v.company_id = v_company)
  ) s;

  RETURN jsonb_build_object('ok', true, 'venues', v_result);
END;
$function$;

REVOKE ALL     ON FUNCTION public.get_venue_resource_occupancy(text, date, date) FROM public;
GRANT EXECUTE  ON FUNCTION public.get_venue_resource_occupancy(text, date, date) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
