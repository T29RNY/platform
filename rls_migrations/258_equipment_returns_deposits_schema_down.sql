-- Down for migration 258 — Equipment Hire returns/deposits schema.
ALTER TABLE public.equipment_bookings
  DROP COLUMN IF EXISTS returned_condition,
  DROP COLUMN IF EXISTS handed_out_at,
  DROP COLUMN IF EXISTS deposit_resolved_at,
  DROP COLUMN IF EXISTS deposit_status,
  DROP COLUMN IF EXISTS deposit_pence;
