-- Migration 133 — Pitch Booking Stage 1 (booking-owned): occupancy foundation.
-- The single source of truth for "this pitch is taken for this time-range".
-- Fixtures, bookings, and maintenance all project rows here; the partial GiST
-- EXCLUDE makes any two ACTIVE rows on the same pitch+overlapping-time mutually
-- exclusive regardless of source. Lands BEFORE the venue fixture-mirror trigger
-- (Stage 2) which writes into this table.
--
-- Displacement model: within one txn set the loser active=false, then insert/
-- activate the winner — the partial EXCLUDE (WHERE active) then cannot fire.
-- Priority: 0=maintenance (top, non-displaceable), 1=fixture, 2=block, 3=ad-hoc.
-- Half-open [) ranges so back-to-back slots don't collide.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.pitch_occupancy (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playing_area_id uuid NOT NULL REFERENCES public.playing_areas(id) ON DELETE CASCADE,
  venue_id        text NOT NULL REFERENCES public.venues(id)        ON DELETE CASCADE,
  time_range      tstzrange NOT NULL,
  source_kind     text     NOT NULL CHECK (source_kind IN ('fixture','booking','maintenance')),
  source_id       text     NOT NULL,   -- fixtures.id::text | pitch_bookings.id::text | venue-defined maint key
  priority        smallint NOT NULL CHECK (priority BETWEEN 0 AND 3),  -- 0=maint,1=fixture,2=block,3=ad-hoc
  active          boolean  NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- partial backstop: two ACTIVE rows can never overlap on a pitch
  CONSTRAINT pitch_occupancy_no_overlap
    EXCLUDE USING gist (playing_area_id WITH =, time_range WITH &&) WHERE (active),
  -- idempotent re-sync / upsert key (ON CONFLICT (source_kind, source_id))
  CONSTRAINT pitch_occupancy_source_uniq UNIQUE (source_kind, source_id)
);

-- venue + date-range reads (the calendar grid)
CREATE INDEX pitch_occupancy_venue_range_idx
  ON public.pitch_occupancy USING gist (venue_id, time_range) WHERE (active);

ALTER TABLE public.pitch_occupancy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pitch_occupancy FROM anon, authenticated;  -- RPC-only, matches Phase 1/2
