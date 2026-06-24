-- DOWN 414 — remove Phase 3 pitch-occupancy projection + clash protection.
-- Restores get_pitch_occupancy to its mig-233 inline-detail body, drops the new
-- triggers/helpers/operator reader, removes the club_* occupancy rows, and reverts
-- the source_kind CHECK to the original three sources.

DROP TRIGGER IF EXISTS sync_club_session_occupancy ON public.club_sessions;
DROP TRIGGER IF EXISTS sync_club_fixture_occupancy ON public.club_fixtures;
DROP FUNCTION IF EXISTS public.tg_sync_club_session_occupancy();
DROP FUNCTION IF EXISTS public.tg_sync_club_fixture_occupancy();

-- Remove the projected club rows before tightening the CHECK.
DELETE FROM public.pitch_occupancy WHERE source_kind IN ('club_session','club_fixture');

ALTER TABLE public.pitch_occupancy DROP CONSTRAINT IF EXISTS pitch_occupancy_source_kind_check;
ALTER TABLE public.pitch_occupancy ADD CONSTRAINT pitch_occupancy_source_kind_check
  CHECK (source_kind = ANY (ARRAY['fixture','booking','maintenance']));

DROP FUNCTION IF EXISTS public.get_operator_pitch_occupancy(text, date, date);

-- Restore get_pitch_occupancy to the mig-233 inline-detail body (no shared builder).
CREATE OR REPLACE FUNCTION public.get_pitch_occupancy(p_venue_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
    'id', po.id, 'playing_area_id', po.playing_area_id, 'pitch_name', pa.name,
    'source_kind', po.source_kind, 'source_id', po.source_id, 'priority', po.priority,
    'start', lower(po.time_range), 'end', upper(po.time_range),
    'detail', CASE po.source_kind
      WHEN 'fixture' THEN (
        SELECT jsonb_build_object('home_team', th.name, 'away_team', ta.name, 'status', f.status,
          'owed', public._venue_source_owed('fixture', po.source_id))
        FROM fixtures f LEFT JOIN teams th ON th.id = f.home_team_id LEFT JOIN teams ta ON ta.id = f.away_team_id
        WHERE f.id = po.source_id::uuid)
      WHEN 'booking' THEN (
        SELECT jsonb_build_object('team_id', b.team_id, 'team_name', COALESCE(tb.name, b.booked_by_name),
          'kind', b.kind, 'status', b.status, 'series_id', b.series_id,
          'owed', public._venue_source_owed('booking', po.source_id),
          'is_first', NOT EXISTS (SELECT 1 FROM pitch_bookings b2
            WHERE b2.venue_id = b.venue_id AND b2.id <> b.id AND b2.created_at < b.created_at
              AND ((b.team_id IS NOT NULL AND b2.team_id = b.team_id)
                OR (b.team_id IS NULL AND b.booked_by_name IS NOT NULL AND lower(b2.booked_by_name) = lower(b.booked_by_name)))))
        FROM pitch_bookings b LEFT JOIN teams tb ON tb.id = b.team_id WHERE b.id = po.source_id::uuid)
      ELSE jsonb_build_object('reason', 'maintenance')
    END
  ) ORDER BY lower(po.time_range), pa.name), '[]'::jsonb)
  INTO v_result
  FROM pitch_occupancy po JOIN playing_areas pa ON pa.id = po.playing_area_id
  WHERE po.venue_id = v_venue_id AND po.active AND po.time_range && v_range;
  RETURN v_result;
END;
$function$;

DROP FUNCTION IF EXISTS public._pitch_occupancy_detail(text, text);
DROP FUNCTION IF EXISTS public._club_team_manager_initials(uuid);

SELECT pg_notify('pgrst', 'reload schema');
