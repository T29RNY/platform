-- Down for 439_tournament_mobile_index_and_follow.sql
DROP FUNCTION IF EXISTS public.tournament_list_my_follows(uuid);
DROP FUNCTION IF EXISTS public.tournament_set_team_follow(uuid, boolean);
DROP TABLE IF EXISTS public.tournament_follows;
DROP FUNCTION IF EXISTS public.list_venue_tournaments(text);
