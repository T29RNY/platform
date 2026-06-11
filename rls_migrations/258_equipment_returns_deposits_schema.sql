-- Migration 258 — Equipment Hire V1 returns/deposits schema. Cycle 3 of EQUIPMENT_HIRE_PLAN.md.
-- Adds deposit-hold + return tracking to equipment_bookings. Builds on mig 255/257.
--
-- Deposits are modelled ON THE HIRE ROW (not venue_charges) because a deposit is a
-- refundable HOLD, not revenue owed — it never belongs in the owed/collected ledger.
-- It is snapshotted at hire time, released on return, or forfeited if kit is lost/damaged.
--
--   deposit_pence       — snapshot of the deposit taken at hire (0 = none).
--   deposit_status      — none | held | released | forfeited.
--   deposit_resolved_at — when held→released/forfeited.
--   handed_out_at       — when the kit was physically handed over (status→out).
--   returned_condition  — condition logged at return (feeds the asset's condition).
--
-- Overdue is DERIVED on read (status in confirmed/out AND due_back_at < now() AND
-- not returned) — never stored — so overdue kit keeps its committed status and still
-- blocks availability.

ALTER TABLE public.equipment_bookings
  ADD COLUMN IF NOT EXISTS deposit_pence       int  NOT NULL DEFAULT 0 CHECK (deposit_pence >= 0),
  ADD COLUMN IF NOT EXISTS deposit_status      text NOT NULL DEFAULT 'none'
      CHECK (deposit_status IN ('none','held','released','forfeited')),
  ADD COLUMN IF NOT EXISTS deposit_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS handed_out_at       timestamptz,
  ADD COLUMN IF NOT EXISTS returned_condition  text;
