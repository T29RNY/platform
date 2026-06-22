-- 394 DOWN — drop Club League + fixtures spine.
DROP FUNCTION IF EXISTS public.venue_get_matchday_info(text);
DROP FUNCTION IF EXISTS public.venue_set_matchday_info(text, jsonb);
DROP FUNCTION IF EXISTS public.venue_list_club_fixtures(text, uuid);
DROP FUNCTION IF EXISTS public.venue_delete_club_fixture(text, uuid);
DROP FUNCTION IF EXISTS public.venue_upsert_club_fixture(text, uuid, uuid, uuid, text, text, boolean, date, time, uuid, uuid, text, integer, integer, text, text);
DROP FUNCTION IF EXISTS public.venue_list_club_leagues(text, text);
DROP FUNCTION IF EXISTS public.venue_update_club_league(text, uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.venue_create_club_league(text, text, text, text);

DROP TABLE IF EXISTS public.club_fixtures;
DROP TABLE IF EXISTS public.club_leagues;

ALTER TABLE public.venues DROP COLUMN IF EXISTS matchday_info;
