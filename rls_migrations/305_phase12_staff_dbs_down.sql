-- Down migration for 305_phase12_staff_dbs
-- Removes club_staff_dbs table and all five Phase 12 venue RPCs

DROP FUNCTION IF EXISTS public.expire_staff_dbs();
DROP FUNCTION IF EXISTS public.venue_upsert_staff_dbs(text, uuid, text, text, text, text, date, date, text);
DROP FUNCTION IF EXISTS public.venue_list_club_staff(text, text);
DROP FUNCTION IF EXISTS public.venue_remove_team_manager(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.venue_assign_team_manager(text, uuid, uuid, text);
DROP TABLE IF EXISTS public.club_staff_dbs;
