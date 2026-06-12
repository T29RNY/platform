-- Down for migration 262 — Ref V2 match_events note/sin-bin columns.
ALTER TABLE public.match_events
  DROP COLUMN IF EXISTS duration,
  DROP COLUMN IF EXISTS note_text;
