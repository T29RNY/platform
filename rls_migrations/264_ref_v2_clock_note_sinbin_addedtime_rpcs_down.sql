-- Down for migration 264 — Ref V2 new ref write RPCs.
DROP FUNCTION IF EXISTS public.ref_set_added_time(text, text, integer, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ref_record_sin_bin(text, text, integer, text, integer, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ref_record_note(text, text, text, integer, text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ref_set_clock(text, text, uuid, timestamptz);
