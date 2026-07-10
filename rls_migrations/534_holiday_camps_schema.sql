-- 534_holiday_camps_schema.sql
-- P9.1 — Holiday Camps: additive schema on the EXISTING class engine.
-- A camp is an `is_camp` flavour of venue_class_types (mirrors is_sparring / members_only),
-- NOT a new subsystem. It reuses venue_class_sessions -> venue_class_bookings ->
-- venue_charges(source_type='class') -> get_my_money(stream='class') -> pay path unchanged.
--
-- Every column is safe-defaulted so existing classes / gym / football rows are untouched.
-- Additive ONLY: no drops, no type changes, no relaxation of any existing CHECK.
-- Re-runnable (IF NOT EXISTS guards on columns + constraints).
-- Applied via Supabase apply_migration (implicit transaction — no explicit BEGIN/COMMIT).

-- ── venue_class_types: camp flavour + camp-detail fields + audience/cohort targeting ──
ALTER TABLE public.venue_class_types
  ADD COLUMN IF NOT EXISTS is_camp          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS camp_info        text,
  ADD COLUMN IF NOT EXISTS camp_dietary     text,
  ADD COLUMN IF NOT EXISTS pickup_time      time,
  ADD COLUMN IF NOT EXISTS dropoff_time     time,
  ADD COLUMN IF NOT EXISTS pickup_location  text,
  ADD COLUMN IF NOT EXISTS dropoff_location text,
  ADD COLUMN IF NOT EXISTS booking_mode     text NOT NULL DEFAULT 'per_day',
  ADD COLUMN IF NOT EXISTS audience         text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS target_team_id   uuid;

DO $$
BEGIN
  -- booking_mode: per_day (N daily bookable sessions) | block (one session spanning end_date)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_class_types_booking_mode_check') THEN
    ALTER TABLE public.venue_class_types
      ADD CONSTRAINT venue_class_types_booking_mode_check
      CHECK (booking_mode = ANY (ARRAY['per_day'::text, 'block'::text]));
  END IF;

  -- audience: all (every guardian) | team (only children active in target_team_id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_class_types_audience_check') THEN
    ALTER TABLE public.venue_class_types
      ADD CONSTRAINT venue_class_types_audience_check
      CHECK (audience = ANY (ARRAY['all'::text, 'team'::text]));
  END IF;

  -- target team FK (nullable; ON DELETE SET NULL so retiring a team never orphans a camp type)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_class_types_target_team_id_fkey') THEN
    ALTER TABLE public.venue_class_types
      ADD CONSTRAINT venue_class_types_target_team_id_fkey
      FOREIGN KEY (target_team_id) REFERENCES public.club_teams(id) ON DELETE SET NULL;
  END IF;

  -- audience integrity: an 'all' camp must NOT name a team. The REVERSE (audience='team'
  -- ⟹ target present) is enforced at WRITE time in the create RPC (P9.2), deliberately NOT
  -- as a CHECK — because target_team_id_fkey ON DELETE SET NULL can legitimately leave a
  -- team-audience row with target_team_id=NULL when its team (or parent club) is hard-deleted.
  -- A biconditional CHECK would make that SET NULL violate the constraint and ABORT the team/
  -- club delete with a cryptic 23514. Instead, (audience='team', target=NULL) is a VALID state
  -- meaning "target gone → camp shows to no one": the guardian reader's EXISTS-active-membership
  -- test yields zero rows → the camp is simply hidden, and the delete proceeds cleanly.
  -- Drop-then-add keeps this deterministic if the migration is re-run.
  ALTER TABLE public.venue_class_types DROP CONSTRAINT IF EXISTS venue_class_types_audience_target_check;
  ALTER TABLE public.venue_class_types
    ADD CONSTRAINT venue_class_types_audience_target_check
    CHECK (audience <> 'all' OR target_team_id IS NULL);
END $$;

-- ── venue_class_sessions: block-camp span end date ──
-- NULL = single-day session (existing behaviour, unchanged).
-- Orthogonal to the existing `ends_at > starts_at` CHECK (that governs the time-of-day
-- window within a day; end_date governs the multi-day span for a `block` camp).
ALTER TABLE public.venue_class_sessions
  ADD COLUMN IF NOT EXISTS end_date date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_class_sessions_end_date_check') THEN
    ALTER TABLE public.venue_class_sessions
      ADD CONSTRAINT venue_class_sessions_end_date_check
      CHECK (end_date IS NULL OR end_date >= (starts_at)::date);
  END IF;
END $$;
