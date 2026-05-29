-- 164_venue_display_columns_down.sql — strict revert of 164.

DROP INDEX IF EXISTS public.idx_competition_teams_comp_status;
DROP INDEX IF EXISTS public.idx_leagues_venue;
DROP INDEX IF EXISTS public.idx_seasons_league;
DROP INDEX IF EXISTS public.idx_competitions_season_status;
DROP INDEX IF EXISTS public.idx_fixtures_date_status;
DROP INDEX IF EXISTS public.idx_fixtures_comp_status;
DROP INDEX IF EXISTS public.idx_match_events_goal_created;
DROP INDEX IF EXISTS public.idx_match_events_fixture;
DROP INDEX IF EXISTS public.venues_display_token_key;

ALTER TABLE public.venues
  DROP COLUMN IF EXISTS display_config,
  DROP COLUMN IF EXISTS display_token;
