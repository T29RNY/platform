-- Down migration 260 — drop the equipment insights RPC.
DROP FUNCTION IF EXISTS public.venue_equipment_insights(text, date, date);
