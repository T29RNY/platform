-- Migration 141 — Pitch Booking Stage 3 (booking-owned): venue calendar read.
-- The single read behind the resource-timeline calendar grid: one row per
-- active occupancy row, joined to fixture / booking / maintenance detail.
-- Returns PII (team names, walk-in names) → venue-operator only
-- (resolve_venue_caller). Forward consumer: apps/venue calendar (Stage 6).

CREATE OR REPLACE FUNCTION public.get_pitch_occupancy(
  p_venue_token text,
  p_from        date,
  p_to          date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_range    tstzrange;
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

  v_range := tstzrange(
    (p_from::timestamp) AT TIME ZONE 'Europe/London',
    ((p_to + 1)::timestamp) AT TIME ZONE 'Europe/London', '[)');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', po.id,
    'playing_area_id', po.playing_area_id,
    'pitch_name', pa.name,
    'source_kind', po.source_kind,
    'source_id', po.source_id,
    'priority', po.priority,
    'start', lower(po.time_range),
    'end',   upper(po.time_range),
    'detail', CASE po.source_kind
      WHEN 'fixture' THEN (
        SELECT jsonb_build_object('home_team', th.name, 'away_team', ta.name, 'status', f.status)
        FROM fixtures f
        LEFT JOIN teams th ON th.id = f.home_team_id
        LEFT JOIN teams ta ON ta.id = f.away_team_id
        WHERE f.id = po.source_id::uuid)
      WHEN 'booking' THEN (
        SELECT jsonb_build_object(
          'team_id', b.team_id,
          'team_name', COALESCE(tb.name, b.booked_by_name),
          'kind', b.kind, 'status', b.status)
        FROM pitch_bookings b
        LEFT JOIN teams tb ON tb.id = b.team_id
        WHERE b.id = po.source_id::uuid)
      ELSE jsonb_build_object('reason', 'maintenance')
    END
  ) ORDER BY lower(po.time_range), pa.name), '[]'::jsonb)
  INTO v_result
  FROM pitch_occupancy po
  JOIN playing_areas pa ON pa.id = po.playing_area_id
  WHERE po.venue_id = v_venue_id AND po.active AND po.time_range && v_range;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_pitch_occupancy(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pitch_occupancy(text, date, date) TO anon, authenticated;
