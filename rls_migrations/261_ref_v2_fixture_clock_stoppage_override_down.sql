-- Down for migration 261 — Ref V2 fixture clock/stoppage/override.
ALTER TABLE public.fixtures
  DROP COLUMN IF EXISTS format_override,
  DROP COLUMN IF EXISTS added_time,
  DROP COLUMN IF EXISTS clock_paused_ms,
  DROP COLUMN IF EXISTS clock_paused_at;
