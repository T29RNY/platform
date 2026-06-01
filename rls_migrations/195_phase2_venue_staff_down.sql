-- 195_phase2_venue_staff_down.sql — rollback for 195_phase2_venue_staff.sql
DROP FUNCTION IF EXISTS public.venue_update_staff(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.venue_add_staff(text, jsonb);
DROP FUNCTION IF EXISTS public.venue_list_staff(text);
DROP TABLE IF EXISTS public.venue_staff;
