-- Down migration for 582_club_coaches_teamless
-- Removes the team-less club coach roster: 3 RPCs then the table.
-- (DBS recording is untouched — it lives in club_staff_dbs / venue_upsert_staff_dbs, mig 305.)

DROP FUNCTION IF EXISTS public.venue_list_club_coaches(text, text);
DROP FUNCTION IF EXISTS public.venue_remove_club_coach(text, uuid, text);
DROP FUNCTION IF EXISTS public.venue_upsert_club_coach(text, uuid, text, text);
DROP TABLE IF EXISTS public.club_coaches;
