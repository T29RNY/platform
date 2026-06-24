-- 417_pitch_priority_enforcement_down.sql
-- Reverse mig 417 (pitch priority Phase 2). Restores the mig-414 blind-hard-block triggers
-- and the pre-gate booking RPCs, and drops the Phase-2 helpers + proposal store.
-- NOTE: book_pitch_* / venue_create_booking* bodies below are the mig-414/145/232 versions
-- (no reserved-window gate). notify_venue_change is left with the extended reason list
-- (additive, harmless).

-- 1. Drop public RPCs + readers
DROP FUNCTION IF EXISTS public.club_manager_resolve_bump(uuid, text);
DROP FUNCTION IF EXISTS public.venue_resolve_bump(text, uuid, text);
DROP FUNCTION IF EXISTS public.club_manager_list_bump_proposals();
DROP FUNCTION IF EXISTS public.venue_list_bump_proposals(text);
DROP FUNCTION IF EXISTS public._apply_bump_resolution(uuid, text, text, text);

-- 2. Restore the mig-414 triggers (blind hard block, no resolver)
CREATE OR REPLACE FUNCTION public.tg_sync_club_session_occupancy()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_venue_id text; v_start timestamptz; v_range tstzrange;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.pitch_occupancy SET active=false WHERE source_kind='club_session' AND source_id=OLD.id::text;
    RETURN OLD;
  END IF;
  IF NEW.status='scheduled' AND NEW.playing_area_id IS NOT NULL AND NEW.scheduled_at IS NOT NULL THEN
    SELECT pa.venue_id INTO v_venue_id FROM public.playing_areas pa WHERE pa.id=NEW.playing_area_id;
    IF v_venue_id IS NULL THEN
      UPDATE public.pitch_occupancy SET active=false WHERE source_kind='club_session' AND source_id=NEW.id::text;
      RETURN NEW;
    END IF;
    v_start := NEW.scheduled_at;
    v_range := tstzrange(v_start, v_start + make_interval(mins=>60), '[)');
    BEGIN
      INSERT INTO public.pitch_occupancy (playing_area_id,venue_id,time_range,source_kind,source_id,priority,active)
      VALUES (NEW.playing_area_id,v_venue_id,v_range,'club_session',NEW.id::text,1,true)
      ON CONFLICT (source_kind,source_id) DO UPDATE
        SET playing_area_id=EXCLUDED.playing_area_id, venue_id=EXCLUDED.venue_id,
            time_range=EXCLUDED.time_range, priority=1, active=true;
    EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable' USING ERRCODE='P0001'; END;
  ELSE
    UPDATE public.pitch_occupancy SET active=false WHERE source_kind='club_session' AND source_id=NEW.id::text;
  END IF;
  RETURN NEW;
END; $fn$;

CREATE OR REPLACE FUNCTION public.tg_sync_club_fixture_occupancy()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_venue_id text; v_start timestamptz; v_range tstzrange;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.pitch_occupancy SET active=false WHERE source_kind='club_fixture' AND source_id=OLD.id::text;
    RETURN OLD;
  END IF;
  IF NEW.status IN ('scheduled','completed') AND NEW.playing_area_id IS NOT NULL
     AND NEW.scheduled_date IS NOT NULL AND NEW.kickoff_time IS NOT NULL THEN
    SELECT pa.venue_id INTO v_venue_id FROM public.playing_areas pa WHERE pa.id=NEW.playing_area_id;
    IF v_venue_id IS NULL THEN
      UPDATE public.pitch_occupancy SET active=false WHERE source_kind='club_fixture' AND source_id=NEW.id::text;
      RETURN NEW;
    END IF;
    v_start := (NEW.scheduled_date + NEW.kickoff_time) AT TIME ZONE 'Europe/London';
    v_range := tstzrange(v_start, v_start + make_interval(mins=>60), '[)');
    BEGIN
      INSERT INTO public.pitch_occupancy (playing_area_id,venue_id,time_range,source_kind,source_id,priority,active)
      VALUES (NEW.playing_area_id,v_venue_id,v_range,'club_fixture',NEW.id::text,1,true)
      ON CONFLICT (source_kind,source_id) DO UPDATE
        SET playing_area_id=EXCLUDED.playing_area_id, venue_id=EXCLUDED.venue_id,
            time_range=EXCLUDED.time_range, priority=1, active=true;
    EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable' USING ERRCODE='P0001'; END;
  ELSE
    UPDATE public.pitch_occupancy SET active=false WHERE source_kind='club_fixture' AND source_id=NEW.id::text;
  END IF;
  RETURN NEW;
END; $fn$;

-- 3. Drop Phase-2 helpers + resolver
DROP FUNCTION IF EXISTS public._reserve_club_occupancy(text, text, uuid, text, tstzrange, uuid);
DROP FUNCTION IF EXISTS public._notify_bump(uuid);
DROP FUNCTION IF EXISTS public._upsert_club_occupancy(text, text, uuid, text, tstzrange);
DROP FUNCTION IF EXISTS public._closest_available_slot(text, uuid, int, uuid, text, timestamptz, int);
DROP FUNCTION IF EXISTS public._pitch_window_blocks(uuid, tstzrange, text, int, uuid);
DROP FUNCTION IF EXISTS public._reserved_window_overlaps(smallint, time, time, timestamptz, timestamptz);

-- 4. Drop the proposal store
DROP TABLE IF EXISTS public.pitch_bump_proposals;

-- 4b. Restore the pre-tentative status checks (any tentative rows must be cleared first)
ALTER TABLE public.club_sessions DROP CONSTRAINT club_sessions_status_check;
ALTER TABLE public.club_sessions ADD CONSTRAINT club_sessions_status_check
  CHECK (status = ANY (ARRAY['scheduled'::text,'cancelled'::text]));
ALTER TABLE public.club_fixtures DROP CONSTRAINT club_fixtures_status_check;
ALTER TABLE public.club_fixtures ADD CONSTRAINT club_fixtures_status_check
  CHECK (status = ANY (ARRAY['scheduled'::text,'completed'::text,'postponed'::text,'void'::text]));

-- 5. Restore pre-gate booking RPC bodies (they referenced _pitch_window_blocks, now dropped)
CREATE OR REPLACE FUNCTION public.book_pitch_adhoc(p_team_id text, p_playing_area_id uuid, p_booking_date date, p_kickoff_time time without time zone, p_slot_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_venue_id text; v_slot int; v_start timestamptz; v_booking_id uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='P0001'; END IF;
  IF p_team_id IS NULL OR p_playing_area_id IS NULL OR p_booking_date IS NULL OR p_kickoff_time IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id=p_team_id AND user_id=v_uid AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'not_team_admin' USING ERRCODE='P0001'; END IF;
  SELECT pa.venue_id INTO v_venue_id FROM playing_areas pa JOIN venues v ON v.id=pa.venue_id
    WHERE pa.id=p_playing_area_id AND pa.active AND pa.is_available AND v.bookings_enabled AND v.active;
  IF v_venue_id IS NULL THEN RAISE EXCEPTION 'pitch_unavailable' USING ERRCODE='P0001', DETAIL=p_playing_area_id::text; END IF;
  v_slot := COALESCE(p_slot_minutes,60);
  v_start := (p_booking_date + p_kickoff_time) AT TIME ZONE 'Europe/London';
  INSERT INTO pitch_bookings (id,team_id,venue_id,playing_area_id,booking_date,kickoff_time,slot_minutes,kind,status)
  VALUES (v_booking_id,p_team_id,v_venue_id,p_playing_area_id,p_booking_date,p_kickoff_time,v_slot,'adhoc','requested');
  BEGIN
    INSERT INTO pitch_occupancy (playing_area_id,venue_id,time_range,source_kind,source_id,priority,active)
    VALUES (p_playing_area_id,v_venue_id,tstzrange(v_start,v_start+make_interval(mins=>v_slot),'[)'),'booking',v_booking_id::text,3,true);
  EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable' USING ERRCODE='P0001'; END;
  INSERT INTO audit_events (team_id,actor_user_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
  VALUES (p_team_id,v_uid,'team_admin','user_id:'||v_uid::text,'booking_requested','pitch_booking',v_booking_id::text,
    jsonb_build_object('venue_id',v_venue_id,'playing_area_id',p_playing_area_id,'booking_date',p_booking_date,'kickoff_time',p_kickoff_time,'slot_minutes',v_slot,'kind','adhoc'));
  PERFORM public.notify_venue_change(v_venue_id,'booking_requested');
  PERFORM public.notify_team_change(p_team_id,'booking_requested');
  RETURN jsonb_build_object('ok',true,'booking_id',v_booking_id,'status','requested','kind','adhoc');
END; $function$;

CREATE OR REPLACE FUNCTION public.book_pitch_series(p_team_id text, p_playing_area_id uuid, p_kickoff_time time without time zone, p_start_date date, p_weeks integer, p_slot_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_venue_id text; v_slot int; v_dow smallint; v_series_id uuid := gen_random_uuid();
  v_i int; v_date date; v_start timestamptz; v_booking_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='P0001'; END IF;
  IF p_team_id IS NULL OR p_playing_area_id IS NULL OR p_kickoff_time IS NULL OR p_start_date IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE='P0001'; END IF;
  IF p_weeks IS NULL OR p_weeks<1 OR p_weeks>52 THEN RAISE EXCEPTION 'weeks_out_of_range' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id=p_team_id AND user_id=v_uid AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'not_team_admin' USING ERRCODE='P0001'; END IF;
  SELECT pa.venue_id INTO v_venue_id FROM playing_areas pa JOIN venues v ON v.id=pa.venue_id
    WHERE pa.id=p_playing_area_id AND pa.active AND pa.is_available AND v.bookings_enabled AND v.active;
  IF v_venue_id IS NULL THEN RAISE EXCEPTION 'pitch_unavailable' USING ERRCODE='P0001', DETAIL=p_playing_area_id::text; END IF;
  v_slot := COALESCE(p_slot_minutes,60);
  v_dow := EXTRACT(DOW FROM p_start_date)::smallint;
  INSERT INTO booking_series (id,team_id,venue_id,playing_area_id,day_of_week,kickoff_time,slot_minutes,status,ends_on)
  VALUES (v_series_id,p_team_id,v_venue_id,p_playing_area_id,v_dow,p_kickoff_time,v_slot,'active',p_start_date+(p_weeks-1)*7);
  BEGIN
    FOR v_i IN 0..(p_weeks-1) LOOP
      v_date := p_start_date + v_i*7;
      v_start := (v_date + p_kickoff_time) AT TIME ZONE 'Europe/London';
      v_booking_id := gen_random_uuid();
      INSERT INTO pitch_bookings (id,team_id,venue_id,playing_area_id,booking_date,kickoff_time,slot_minutes,kind,status,series_id)
      VALUES (v_booking_id,p_team_id,v_venue_id,p_playing_area_id,v_date,p_kickoff_time,v_slot,'block','requested',v_series_id);
      INSERT INTO pitch_occupancy (playing_area_id,venue_id,time_range,source_kind,source_id,priority,active)
      VALUES (p_playing_area_id,v_venue_id,tstzrange(v_start,v_start+make_interval(mins=>v_slot),'[)'),'booking',v_booking_id::text,2,true);
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable' USING ERRCODE='P0001', DETAIL=v_date::text; END;
  INSERT INTO audit_events (team_id,actor_user_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
  VALUES (p_team_id,v_uid,'team_admin','user_id:'||v_uid::text,'booking_requested','booking_series',v_series_id::text,
    jsonb_build_object('venue_id',v_venue_id,'playing_area_id',p_playing_area_id,'day_of_week',v_dow,'kickoff_time',p_kickoff_time,'slot_minutes',v_slot,'weeks',p_weeks,'start_date',p_start_date,'kind','block'));
  PERFORM public.notify_venue_change(v_venue_id,'booking_requested');
  PERFORM public.notify_team_change(p_team_id,'booking_requested');
  RETURN jsonb_build_object('ok',true,'series_id',v_series_id,'weeks',p_weeks,'status','requested','kind','block');
END; $function$;

-- venue_create_booking / venue_create_booking_series: re-apply migrations 145 / 232 for the
-- exact pre-warning bodies. The 'warning' return key is additive and harmless if left in place.

SELECT pg_notify('pgrst', 'reload schema');
