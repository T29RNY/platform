-- Migration 134 — Pitch Booking Stage 2a (venue-owned columns).
-- Additive columns the occupancy projection + booking discovery need.
-- All have defaults / are nullable, so existing rows backfill cleanly.
--
--   league_config.slot_minutes  — occupancy length for fixtures (NEVER
--                                 match_duration_mins). Default 60.
--   fixtures.slot_minutes       — per-fixture override (NULL = use league).
--   venues.bookings_enabled     — discovery opt-in (default off).
--   venues.cancellation_policy  — shown on the booking confirm screen.
--   playing_areas.booking_windows — recurring-weekly bookable windows +
--                                 offered slot lengths (jsonb, default []).

ALTER TABLE public.league_config
  ADD COLUMN IF NOT EXISTS slot_minutes int NOT NULL DEFAULT 60
    CHECK (slot_minutes > 0);

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS slot_minutes int
    CHECK (slot_minutes IS NULL OR slot_minutes > 0);

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS bookings_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS cancellation_policy text;

ALTER TABLE public.playing_areas
  ADD COLUMN IF NOT EXISTS booking_windows jsonb NOT NULL DEFAULT '[]'::jsonb;
