-- Migration 255 — Equipment Hire V1 (schema only). Cycle 1 of EQUIPMENT_HIRE_PLAN.md.
-- Sport-agnostic by posture (DECISIONS.md MULTI-SPORT POSTURE / SPORTS LOOKUP REJECTED):
-- neutral naming, no sport column needed (equipment carries no game rules), the
-- venue's own catalogue is the sport adapter.
--
-- Three tables + one constraint extension:
--   equipment              = the catalogue (one row per kit type the venue owns).
--   equipment_bookings     = concrete hires (mirrors pitch_bookings; carries the
--                            session-link FKs booking_id/fixture_id = the cross-sell spine).
--   equipment_demand_misses= turned-away demand (the procurement signal — captured at
--                            the moment of an empty availability check in Cycle 2).
--   venue_charges.source_type CHECK extended to allow 'equipment' (reuses the whole
--                            mig-180/181 ledger; venue_payments needs no change).
--
-- Cycle 1 ships the tables + the catalogue RPCs (mig 256). The hire-flow RPCs that
-- WRITE equipment_bookings / equipment_demand_misses land in Cycle 2.
--
-- RLS on, RPC-only (anon/auth revoked) — same posture as pitch_bookings/venue_charges.
-- FK types verified against live schema: venues.id/teams.id = text; fixtures.id/
-- pitch_bookings.id = uuid.

-- ── catalogue ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id             text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name                 text NOT NULL,                         -- free-text label
  category             text NOT NULL CHECK (category IN
                         ('apparel','balls','goals_targets','nets','training_aids','tech_av','safety')),
  quantity             int  NOT NULL DEFAULT 1 CHECK (quantity >= 0),   -- units owned
  default_fee_pence    int  NOT NULL DEFAULT 0 CHECK (default_fee_pence >= 0),
  deposit_pence        int  NOT NULL DEFAULT 0 CHECK (deposit_pence >= 0),
  hire_unit            text NOT NULL DEFAULT 'per_session'
                         CHECK (hire_unit IN ('per_hour','per_session','per_day')),
  purchase_price_pence int  CHECK (purchase_price_pence IS NULL OR purchase_price_pence >= 0),
  acquired_on          date,
  condition            text NOT NULL DEFAULT 'good'
                         CHECK (condition IN ('new','good','worn','damaged','retired')),
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_venue_active_idx ON public.equipment (venue_id, active);

-- ── concrete hires (mirrors pitch_bookings) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipment_bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id   uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  venue_id       text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  team_id        text REFERENCES public.teams(id) ON DELETE SET NULL,    -- registered booker
  booked_by_name text,                                                   -- walk-in booker
  qty            int  NOT NULL DEFAULT 1 CHECK (qty >= 1),
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL,
  due_back_at    timestamptz,
  returned_at    timestamptz,                                            -- NULL = still out
  booking_id     uuid REFERENCES public.pitch_bookings(id) ON DELETE SET NULL,  -- session linkage
  fixture_id     uuid REFERENCES public.fixtures(id) ON DELETE SET NULL,        -- session linkage
  status         text NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','confirmed','declined','cancelled','out','returned','overdue')),
  amount_pence   int CHECK (amount_pence IS NULL OR amount_pence >= 0),
  contact_email  text,
  contact_phone  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_bookings_time_ck   CHECK (end_at > start_at),
  CONSTRAINT equipment_bookings_booker_ck CHECK (team_id IS NOT NULL OR booked_by_name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS equipment_bookings_item_window_idx  ON public.equipment_bookings (equipment_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS equipment_bookings_venue_status_idx ON public.equipment_bookings (venue_id, status);
CREATE INDEX IF NOT EXISTS equipment_bookings_booking_idx      ON public.equipment_bookings (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS equipment_bookings_fixture_idx      ON public.equipment_bookings (fixture_id) WHERE fixture_id IS NOT NULL;

-- ── turned-away demand (procurement signal) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipment_demand_misses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  category      text NOT NULL,                                           -- what they wanted
  equipment_id  uuid REFERENCES public.equipment(id) ON DELETE SET NULL, -- specific item, else NULL
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  qty_wanted    int  NOT NULL DEFAULT 1 CHECK (qty_wanted >= 1),
  source        text NOT NULL DEFAULT 'venue' CHECK (source IN ('venue','self_qr')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_demand_misses_idx ON public.equipment_demand_misses (venue_id, category, window_start);

-- ── extend the shared ledger to bill equipment (DROP+ADD; CREATE OR REPLACE
--    cannot alter a CHECK) ─────────────────────────────────────────────────────
ALTER TABLE public.venue_charges DROP CONSTRAINT venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD  CONSTRAINT venue_charges_source_type_check
  CHECK (source_type IN ('booking','fixture','equipment'));

-- ── RLS — RPC-only (catalogue RPCs land in mig 256; no client access) ──────────
ALTER TABLE public.equipment              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_bookings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_demand_misses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.equipment               FROM anon, authenticated;
REVOKE ALL ON public.equipment_bookings      FROM anon, authenticated;
REVOKE ALL ON public.equipment_demand_misses FROM anon, authenticated;

-- ── DEMO SEED (demo_venue only) — so the Cycle 1 UI is demonstrable immediately.
--    Forward-only; idempotent by (venue_id, name). Touches ONLY demo_venue. ─────
DO $seed$
BEGIN
  IF EXISTS (SELECT 1 FROM public.venues WHERE id = 'demo_venue') THEN
    INSERT INTO public.equipment (venue_id, name, category, quantity, default_fee_pence, deposit_pence, hire_unit, purchase_price_pence, condition)
    SELECT 'demo_venue', v.name, v.category, v.quantity, v.fee, v.dep, v.unit, v.cost, v.cond
    FROM (VALUES
      ('Bib set (12)',      'apparel',       8, 500,   0,    'per_session', 4000,  'good'),
      ('Match balls',       'balls',        10, 300,   0,    'per_session', 2500,  'good'),
      ('Portable goals',    'goals_targets', 4, 1500,  5000, 'per_session', 40000, 'good'),
      ('Speed/agility set',  'training_aids', 3, 800,   0,    'per_session', 6000,  'worn'),
      ('PA / sound system', 'tech_av',       1, 2500,  10000,'per_day',     30000, 'good')
    ) AS v(name, category, quantity, fee, dep, unit, cost, cond)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.equipment e WHERE e.venue_id = 'demo_venue' AND e.name = v.name
    );
  END IF;
END
$seed$;
