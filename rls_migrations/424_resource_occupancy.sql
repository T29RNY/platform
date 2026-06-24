-- Migration 424 — Resource-calendar Phase 3: hard room/trainer clash protection.
--
-- Pitches already have path-independent double-booking protection: a true Postgres
-- EXCLUDE constraint on the pitch_occupancy ledger, kept in sync by per-table triggers
-- across every write path (mig 414). Rooms and trainers did NOT — they only had an
-- inline _space_is_available() (rooms) / inline overlap-count (trainers) called inside
-- the create RPCs, so any other write path could still double-book.
--
-- This lands the same mechanism for rooms + trainers in ONE shared ledger
-- (resource_occupancy), mirroring pitch_occupancy's single-table shape. Because a room
-- can be occupied by EITHER a room hire OR a class session, both land in the same
-- (resource_type='room', resource_id=space_id) lane and therefore exclude each other —
-- which also hard-closes the room-hire-vs-class cross-table gap. Trainers occupy the
-- (resource_type='trainer', resource_id=trainer_id) lane via appointments.
--
-- Write paths covered by the 3 triggers (audited s203 against pg_proc — these are ALL
-- of them; no fourth table occupies a room/trainer):
--   rooms (venue_room_hires)    : member_request_room_hire, public_enquire_room_hire,
--                                 venue_create_room_hire, venue_confirm_room_hire,
--                                 venue_cancel_room_hire
--   classes (venue_class_sessions): venue_create_class_series, venue_schedule_class_session,
--                                 venue_cancel_class_series, venue_cancel_class_session,
--                                 venue_mark_class_completed
--   trainers (venue_appointments): member_book_appointment, venue_create_appointment,
--                                 member_cancel_appointment, venue_mark_appointment_completed
--
-- Occupy semantics = status <> 'cancelled' (byte-identical to _space_is_available and the
-- inline appointment guard → no behaviour change on the common path; the inline guards
-- stay as a fast-path belt-and-braces, the trigger is the real guarantee for the race).
-- Friendly surfacing: exclusion_violation → 'slot_unavailable' (rooms) / 'slot_taken'
-- (trainers) to match the existing client copy.
--
-- The ledger is clash-protection ONLY — the Phase-1 reader get_venue_resource_occupancy
-- reads the source tables directly, so this table never feeds the calendar and only needs
-- FUTURE occupying rows. Live pre-flight (s203): zero existing future overlaps in either
-- lane → the backfill + EXCLUDE cannot reject on apply.

-- ─── 1. The shared ledger ────────────────────────────────────────────────────
-- btree_gist already installed (used by pitch_occupancy). RLS enabled with NO policies
-- + no anon/authenticated grants — exactly mirrors pitch_occupancy; only the SECDEF
-- triggers (definer = postgres) and SECDEF readers ever touch it.
CREATE TABLE IF NOT EXISTS public.resource_occupancy (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      text        NOT NULL,
  resource_type text        NOT NULL,                      -- 'room' | 'trainer'
  resource_id   uuid        NOT NULL,                      -- space_id | trainer_id
  time_range    tstzrange   NOT NULL,
  source_kind   text        NOT NULL,                      -- 'room_hire' | 'class_session' | 'appointment'
  source_id     text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_occupancy_resource_type_check
    CHECK (resource_type = ANY (ARRAY['room','trainer'])),
  CONSTRAINT resource_occupancy_source_kind_check
    CHECK (source_kind = ANY (ARRAY['room_hire','class_session','appointment'])),
  CONSTRAINT resource_occupancy_source_uniq UNIQUE (source_kind, source_id),
  CONSTRAINT resource_occupancy_no_overlap
    EXCLUDE USING gist (resource_type WITH =, resource_id WITH =, time_range WITH &&)
    WHERE (active)
);

ALTER TABLE public.resource_occupancy ENABLE ROW LEVEL SECURITY;
-- Supabase auto-grants new public tables to anon/authenticated via ALTER DEFAULT
-- PRIVILEGES; RLS (0 policies) already denies them, but revoke explicitly so the table
-- privileges match pitch_occupancy exactly (only postgres/service_role + the SECDEF
-- triggers ever touch it).
REVOKE ALL ON TABLE public.resource_occupancy FROM anon, authenticated;

-- ─── 2. venue_room_hires → occupancy ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_sync_room_hire_occupancy()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.resource_occupancy SET active = false
      WHERE source_kind = 'room_hire' AND source_id = OLD.id::text;
    RETURN OLD;
  END IF;

  IF NEW.status <> 'cancelled'
     AND NEW.space_id IS NOT NULL
     AND NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL
     AND NEW.ends_at > NEW.starts_at THEN
    BEGIN
      INSERT INTO public.resource_occupancy
        (venue_id, resource_type, resource_id, time_range, source_kind, source_id, active)
      VALUES (NEW.venue_id, 'room', NEW.space_id,
              tstzrange(NEW.starts_at, NEW.ends_at, '[)'), 'room_hire', NEW.id::text, true)
      ON CONFLICT (source_kind, source_id) DO UPDATE
        SET venue_id    = EXCLUDED.venue_id,
            resource_id = EXCLUDED.resource_id,
            time_range  = EXCLUDED.time_range,
            active      = true;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
    END;
  ELSE
    UPDATE public.resource_occupancy SET active = false
      WHERE source_kind = 'room_hire' AND source_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_room_hire_occupancy ON public.venue_room_hires;
CREATE TRIGGER sync_room_hire_occupancy
  AFTER INSERT OR DELETE OR UPDATE OF status, space_id, starts_at, ends_at
  ON public.venue_room_hires FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_room_hire_occupancy();

-- ─── 3. venue_class_sessions → occupancy (a class is a room booking) ─────────
CREATE OR REPLACE FUNCTION public.tg_sync_class_session_occupancy()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.resource_occupancy SET active = false
      WHERE source_kind = 'class_session' AND source_id = OLD.id::text;
    RETURN OLD;
  END IF;

  IF NEW.status <> 'cancelled'
     AND NEW.space_id IS NOT NULL
     AND NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL
     AND NEW.ends_at > NEW.starts_at THEN
    BEGIN
      INSERT INTO public.resource_occupancy
        (venue_id, resource_type, resource_id, time_range, source_kind, source_id, active)
      VALUES (NEW.venue_id, 'room', NEW.space_id,
              tstzrange(NEW.starts_at, NEW.ends_at, '[)'), 'class_session', NEW.id::text, true)
      ON CONFLICT (source_kind, source_id) DO UPDATE
        SET venue_id    = EXCLUDED.venue_id,
            resource_id = EXCLUDED.resource_id,
            time_range  = EXCLUDED.time_range,
            active      = true;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
    END;
  ELSE
    UPDATE public.resource_occupancy SET active = false
      WHERE source_kind = 'class_session' AND source_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_class_session_occupancy ON public.venue_class_sessions;
CREATE TRIGGER sync_class_session_occupancy
  AFTER INSERT OR DELETE OR UPDATE OF status, space_id, starts_at, ends_at
  ON public.venue_class_sessions FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_class_session_occupancy();

-- ─── 4. venue_appointments → occupancy (trainer lane) ────────────────────────
CREATE OR REPLACE FUNCTION public.tg_sync_appointment_occupancy()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.resource_occupancy SET active = false
      WHERE source_kind = 'appointment' AND source_id = OLD.id::text;
    RETURN OLD;
  END IF;

  IF NEW.status <> 'cancelled'
     AND NEW.trainer_id IS NOT NULL
     AND NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL
     AND NEW.ends_at > NEW.starts_at THEN
    BEGIN
      INSERT INTO public.resource_occupancy
        (venue_id, resource_type, resource_id, time_range, source_kind, source_id, active)
      VALUES (NEW.venue_id, 'trainer', NEW.trainer_id,
              tstzrange(NEW.starts_at, NEW.ends_at, '[)'), 'appointment', NEW.id::text, true)
      ON CONFLICT (source_kind, source_id) DO UPDATE
        SET venue_id    = EXCLUDED.venue_id,
            resource_id = EXCLUDED.resource_id,
            time_range  = EXCLUDED.time_range,
            active      = true;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'slot_taken' USING ERRCODE = 'P0001';
    END;
  ELSE
    UPDATE public.resource_occupancy SET active = false
      WHERE source_kind = 'appointment' AND source_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_appointment_occupancy ON public.venue_appointments;
CREATE TRIGGER sync_appointment_occupancy
  AFTER INSERT OR DELETE OR UPDATE OF status, trainer_id, starts_at, ends_at
  ON public.venue_appointments FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_appointment_occupancy();

REVOKE ALL     ON FUNCTION public.tg_sync_room_hire_occupancy()      FROM public;
REVOKE EXECUTE ON FUNCTION public.tg_sync_room_hire_occupancy()      FROM anon, authenticated;
REVOKE ALL     ON FUNCTION public.tg_sync_class_session_occupancy()  FROM public;
REVOKE EXECUTE ON FUNCTION public.tg_sync_class_session_occupancy()  FROM anon, authenticated;
REVOKE ALL     ON FUNCTION public.tg_sync_appointment_occupancy()    FROM public;
REVOKE EXECUTE ON FUNCTION public.tg_sync_appointment_occupancy()    FROM anon, authenticated;

-- ─── 5. Backfill future occupying rows (clash-only ledger → future is enough) ─
INSERT INTO public.resource_occupancy (venue_id, resource_type, resource_id, time_range, source_kind, source_id, active)
SELECT venue_id, 'room', space_id, tstzrange(starts_at, ends_at, '[)'), 'room_hire', id::text, true
FROM public.venue_room_hires
WHERE status <> 'cancelled' AND ends_at > now() AND ends_at > starts_at
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO public.resource_occupancy (venue_id, resource_type, resource_id, time_range, source_kind, source_id, active)
SELECT venue_id, 'room', space_id, tstzrange(starts_at, ends_at, '[)'), 'class_session', id::text, true
FROM public.venue_class_sessions
WHERE status <> 'cancelled' AND ends_at > now() AND ends_at > starts_at
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO public.resource_occupancy (venue_id, resource_type, resource_id, time_range, source_kind, source_id, active)
SELECT venue_id, 'trainer', trainer_id, tstzrange(starts_at, ends_at, '[)'), 'appointment', id::text, true
FROM public.venue_appointments
WHERE status <> 'cancelled' AND ends_at > now() AND ends_at > starts_at
ON CONFLICT (source_kind, source_id) DO NOTHING;

-- Schema cache refresh (PostgREST serves stale signatures after function changes).
SELECT pg_notify('pgrst', 'reload schema');
