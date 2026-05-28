-- Migration 139 — Pitch Booking Stage 3 (booking-owned): booking storage.
-- booking_series = recurring block-booking parent; pitch_bookings = the
-- concrete weekly/one-off rows (block materialises N rows under a series).
-- RPC-only (RLS + REVOKE). Payment is OFF but schema-wired
-- (amount_pence + payment_status default 'not_required', no Stripe yet).
-- Occupancy rows are written by the Stage 4 write RPCs, not here.

CREATE TABLE public.booking_series (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         text NOT NULL REFERENCES public.teams(id)         ON DELETE CASCADE,
  venue_id        text NOT NULL REFERENCES public.venues(id)        ON DELETE CASCADE,
  playing_area_id uuid NOT NULL REFERENCES public.playing_areas(id) ON DELETE CASCADE,
  day_of_week     smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  kickoff_time    time NOT NULL,
  slot_minutes    int CHECK (slot_minutes IS NULL OR slot_minutes > 0),
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','ending','cancelled')),
  ends_on         date,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_series FROM anon, authenticated;

CREATE TABLE public.pitch_bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         text REFERENCES public.teams(id) ON DELETE CASCADE,  -- NULL for walk-ins
  booked_by_name  text,                                                -- walk-in display name
  venue_id        text NOT NULL REFERENCES public.venues(id)        ON DELETE CASCADE,
  playing_area_id uuid NOT NULL REFERENCES public.playing_areas(id) ON DELETE CASCADE,
  booking_date    date NOT NULL,
  kickoff_time    time NOT NULL,
  slot_minutes    int CHECK (slot_minutes IS NULL OR slot_minutes > 0),
  kind            text NOT NULL CHECK (kind IN ('block','adhoc')),
  status          text NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','confirmed','declined','cancelled','superseded','expired')),
  amount_pence    int CHECK (amount_pence IS NULL OR amount_pence >= 0),
  payment_status  text NOT NULL DEFAULT 'not_required'
                    CHECK (payment_status IN ('not_required','pending','paid','refunded')),
  series_id       uuid REFERENCES public.booking_series(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- a booking is either a registered team or a named walk-in
  CONSTRAINT pitch_bookings_booker_present CHECK (team_id IS NOT NULL OR booked_by_name IS NOT NULL)
);
ALTER TABLE public.pitch_bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pitch_bookings FROM anon, authenticated;

CREATE INDEX pitch_bookings_venue_date_idx ON public.pitch_bookings (venue_id, booking_date);
CREATE INDEX pitch_bookings_team_idx       ON public.pitch_bookings (team_id)   WHERE team_id IS NOT NULL;
CREATE INDEX pitch_bookings_series_idx     ON public.pitch_bookings (series_id) WHERE series_id IS NOT NULL;
