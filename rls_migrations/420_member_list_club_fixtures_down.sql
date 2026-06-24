-- Down — Migration 420
DROP FUNCTION IF EXISTS public.member_list_club_fixtures(text);
SELECT pg_notify('pgrst', 'reload schema');
