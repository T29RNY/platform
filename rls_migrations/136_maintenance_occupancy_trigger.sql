-- Migration 136 — Pitch Booking Stage 2a (venue-owned).
-- Project playing_areas.maintenance_windows into pitch_occupancy as
-- priority-0 (top, non-displaceable) rows. Maintenance blocks fixtures
-- AND bookings via the partial EXCLUDE.
--
-- maintenance_windows shape (mig 106): [{start_date, end_date, reason?}]
-- (absolute date ranges, venue-local). Each merged contiguous range →
-- one occupancy row [start 00:00, (end+1) 00:00) @ Europe/London.
--
-- range_agg merges overlapping/adjacent windows first, so a pitch with
-- overlapping maintenance windows can never trip the EXCLUDE on itself.
-- Re-sync = delete this pitch's maintenance rows, re-insert.

CREATE OR REPLACE FUNCTION public.tg_sync_maintenance_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  DELETE FROM public.pitch_occupancy
   WHERE source_kind = 'maintenance' AND playing_area_id = NEW.id;

  INSERT INTO public.pitch_occupancy (
    playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
  SELECT NEW.id, NEW.venue_id, m.rng, 'maintenance',
         NEW.id::text || '#' || row_number() OVER (ORDER BY lower(m.rng)),
         0, true
  FROM (
    SELECT unnest(range_agg(
      tstzrange(
        ((w->>'start_date')::date)::timestamp AT TIME ZONE 'Europe/London',
        (((w->>'end_date')::date + 1))::timestamp AT TIME ZONE 'Europe/London',
        '[)'
      )
    )) AS rng
    FROM jsonb_array_elements(COALESCE(NEW.maintenance_windows, '[]'::jsonb)) w
    WHERE (w->>'start_date') IS NOT NULL AND (w->>'end_date') IS NOT NULL
  ) m;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_maintenance_occupancy ON public.playing_areas;
CREATE TRIGGER sync_maintenance_occupancy
  AFTER INSERT OR UPDATE OF maintenance_windows ON public.playing_areas
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_maintenance_occupancy();

-- One-time backfill of existing maintenance windows.
INSERT INTO public.pitch_occupancy (
  playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
SELECT pa.id, pa.venue_id, m.rng, 'maintenance',
       pa.id::text || '#' || row_number() OVER (PARTITION BY pa.id ORDER BY lower(m.rng)),
       0, true
FROM public.playing_areas pa
CROSS JOIN LATERAL (
  SELECT unnest(range_agg(
    tstzrange(
      ((w->>'start_date')::date)::timestamp AT TIME ZONE 'Europe/London',
      (((w->>'end_date')::date + 1))::timestamp AT TIME ZONE 'Europe/London',
      '[)'
    )
  )) AS rng
  FROM jsonb_array_elements(COALESCE(pa.maintenance_windows, '[]'::jsonb)) w
  WHERE (w->>'start_date') IS NOT NULL AND (w->>'end_date') IS NOT NULL
) m
ON CONFLICT (source_kind, source_id) DO NOTHING;
