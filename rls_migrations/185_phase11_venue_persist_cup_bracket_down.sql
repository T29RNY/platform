-- Down for migration 185 — drop the cup bracket generation RPC.
DROP FUNCTION IF EXISTS public.venue_persist_cup_bracket(text, uuid, date, time, uuid[], text[]);
