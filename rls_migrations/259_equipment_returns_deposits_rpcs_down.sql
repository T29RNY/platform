-- Down for migration 259 — Equipment Hire returns/deposits RPCs.
-- Drops the two NEW functions. NOTE: venue_create_equipment_hire and
-- venue_list_equipment_hires were CREATE OR REPLACE here — to fully revert their
-- bodies to the pre-259 (Cycle 2) versions, re-apply mig 257's definitions of those
-- two functions. (The 259 versions are harmless without the mig-258 columns only if
-- those columns still exist; revert 259 RPCs before 258 schema.)
DROP FUNCTION IF EXISTS public.venue_mark_equipment_returned(text, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.venue_mark_equipment_out(text, uuid);
