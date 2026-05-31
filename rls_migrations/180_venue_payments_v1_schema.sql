-- Migration 180 — Venue Payments Ledger V1 (schema only).
-- Per VENUE_PAYMENTS_SCOPE.md (operator, session 60). V1 = schema + fee columns
-- + venues.payment_link + a demo charge/payment seed. NO RPCs (V2), NO UI (V3).
--
-- Unified ledger (one rollup, no per-surface UNIONs):
--   venue_charges  = what is OWED (one row per booking; per-team per fixture).
--   venue_payments = instalment log (each payment/refund its own row; soft-void).
-- Money owed TO the venue for pitch hire + league/cup fixtures. Separate from
-- payment_ledger (player match-subs) and from Phase 8 SaaS billing.
--
-- Settled calls honoured here: unified two-table model; instalment log; amount due
-- = default fee + per-charge override (fee defaults live on league_config /
-- playing_areas); fixture payer = league_config.fixture_fee_payer; cancellation ≠
-- payment status (status here is purely money); online shares the ledger later (a
-- non-cash venue_payments row). RPC-only access (RLS on, anon/auth revoked) — V2
-- adds SECDEF RPCs; there is no client access in V1.
--
-- source_id is text (unifies booking uuid + fixture uuid, mirrors pitch_occupancy).
-- The UNIQUE(source_type, source_id, team_id) intent ("one charge per booking;
-- one per team per fixture") is enforced via a COALESCE(team_id,'') expression
-- index — a plain UNIQUE would let NULL-team booking rows duplicate.

-- ── fee config columns (defaults; per-charge override comes in V2) ─────────────
ALTER TABLE public.league_config
  ADD COLUMN IF NOT EXISTS fixture_fee_pence int CHECK (fixture_fee_pence IS NULL OR fixture_fee_pence >= 0);
ALTER TABLE public.league_config
  ADD COLUMN IF NOT EXISTS fixture_fee_payer text NOT NULL DEFAULT 'both'
    CHECK (fixture_fee_payer IN ('both','home'));
ALTER TABLE public.playing_areas
  ADD COLUMN IF NOT EXISTS default_fee_pence int CHECK (default_fee_pence IS NULL OR default_fee_pence >= 0);
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS payment_link text;

-- ── venue_charges — what is owed ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,  -- denormalised for rollup
  source_type     text NOT NULL CHECK (source_type IN ('booking','fixture')),
  source_id       text NOT NULL,                                                 -- pitch_bookings.id | fixtures.id (text)
  team_id         text REFERENCES public.teams(id) ON DELETE CASCADE,            -- NULL for booking; set per team for fixture
  competition_id  uuid REFERENCES public.competitions(id) ON DELETE CASCADE,     -- NULL for booking; slices league/cup
  amount_due_pence int NOT NULL CHECK (amount_due_pence >= 0),
  status          text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','refunded')),
  due_date        date,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- one charge per booking (team_id NULL); one per team per fixture
CREATE UNIQUE INDEX IF NOT EXISTS venue_charges_source_uniq
  ON public.venue_charges (source_type, source_id, COALESCE(team_id, ''));
CREATE INDEX IF NOT EXISTS venue_charges_venue_idx       ON public.venue_charges (venue_id);
CREATE INDEX IF NOT EXISTS venue_charges_competition_idx ON public.venue_charges (competition_id) WHERE competition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS venue_charges_team_idx        ON public.venue_charges (team_id) WHERE team_id IS NOT NULL;

-- ── venue_payments — instalment log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id    uuid NOT NULL REFERENCES public.venue_charges(id) ON DELETE CASCADE,
  kind         text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','refund')),
  amount_pence int  NOT NULL CHECK (amount_pence >= 0),
  method       text NOT NULL CHECK (method IN ('cash','bank_transfer','card','other')),
  external_ref text UNIQUE,                       -- processor/transfer ref + webhook idempotency (NULL for cash)
  note         text,
  taken_by     text,
  taken_at     timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz
);
CREATE INDEX IF NOT EXISTS venue_payments_charge_idx ON public.venue_payments (charge_id);

-- ── RLS — RPC-only (V2 adds SECDEF RPCs; no client access in V1) ───────────────
ALTER TABLE public.venue_charges  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_charges  FROM anon, authenticated;
REVOKE ALL ON public.venue_payments FROM anon, authenticated;

-- ── DEMO SEED (demo_venue only) — so V3/V4 UI + reports are testable ───────────
-- Forward-only in production: real venues get no backfilled fees/charges. This
-- block touches ONLY demo_venue / its leagues.
DO $seed$
BEGIN
  -- demo fee defaults
  UPDATE public.playing_areas SET default_fee_pence = 5000
   WHERE venue_id = 'demo_venue' AND default_fee_pence IS NULL;        -- £50 / slot
  UPDATE public.league_config SET fixture_fee_pence = 2000
   WHERE fixture_fee_pence IS NULL
     AND league_id IN (SELECT l.id FROM public.leagues l WHERE l.venue_id = 'demo_venue');  -- £20 / team / fixture

  -- booking charges (one payer; team_id NULL)
  INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  SELECT b.venue_id, 'booking', b.id::text, NULL, NULL,
         COALESCE(pa.default_fee_pence, 5000), 'unpaid', b.booking_date
  FROM public.pitch_bookings b
  JOIN public.playing_areas pa ON pa.id = b.playing_area_id
  WHERE b.venue_id = 'demo_venue' AND b.status = 'confirmed'
  ON CONFLICT DO NOTHING;

  -- fixture charges (per team, per fixture_fee_payer)
  INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  SELECT l.venue_id, 'fixture', f.id::text, tm.team_id, f.competition_id,
         COALESCE(lc.fixture_fee_pence, 2000), 'unpaid', f.scheduled_date
  FROM public.fixtures f
  JOIN public.competitions cp ON cp.id = f.competition_id
  JOIN public.seasons se ON se.id = cp.season_id
  JOIN public.leagues l ON l.id = se.league_id
  LEFT JOIN public.league_config lc ON lc.league_id = l.id
  CROSS JOIN LATERAL (
    SELECT f.home_team_id AS team_id
    UNION ALL
    SELECT f.away_team_id WHERE COALESCE(lc.fixture_fee_payer, 'both') = 'both'
  ) tm
  WHERE l.venue_id = 'demo_venue'
    AND f.status IN ('scheduled','allocated','in_progress','completed')
    AND tm.team_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- instalments: a paid / partial / unpaid mix so collection-rate reports have data
  WITH ranked AS (
    SELECT id, amount_due_pence, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM public.venue_charges WHERE venue_id = 'demo_venue'
  )
  INSERT INTO public.venue_payments (charge_id, kind, amount_pence, method, taken_by, taken_at)
  SELECT id, 'payment',
         CASE WHEN rn % 3 = 1 THEN amount_due_pence ELSE amount_due_pence / 2 END,  -- rn%3=1 full, =2 partial
         CASE WHEN rn % 2 = 0 THEN 'bank_transfer' ELSE 'cash' END,
         'Demo seed', now() - make_interval(hours => rn::int)
  FROM ranked
  WHERE rn % 3 IN (1, 2);  -- rn%3=0 left unpaid

  -- recompute charge status from non-voided instalments
  UPDATE public.venue_charges c SET status = CASE
      WHEN paid.total IS NULL OR paid.total <= 0 THEN 'unpaid'
      WHEN paid.total >= c.amount_due_pence       THEN 'paid'
      ELSE 'partial' END
  FROM (
    SELECT charge_id, SUM(CASE WHEN kind = 'payment' THEN amount_pence ELSE -amount_pence END) AS total
    FROM public.venue_payments WHERE voided_at IS NULL GROUP BY charge_id
  ) paid
  WHERE paid.charge_id = c.id AND c.venue_id = 'demo_venue';
END
$seed$;
