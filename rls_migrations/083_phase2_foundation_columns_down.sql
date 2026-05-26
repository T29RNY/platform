-- 083_phase2_foundation_columns_down.sql
--
-- Reverses 083. Drops added columns + helper function. Restores
-- competition_teams.status DEFAULT to 'active'.
--
-- Safe to run; all Phase 1 tables are empty so no data loss risk.

------------------------------------------------------------------
-- 7. playing_areas
------------------------------------------------------------------
ALTER TABLE public.playing_areas
  DROP COLUMN IF EXISTS maintenance_windows,
  DROP COLUMN IF EXISTS is_available;

------------------------------------------------------------------
-- 6. match_officials
------------------------------------------------------------------
ALTER TABLE public.match_officials
  DROP CONSTRAINT IF EXISTS match_officials_employment_type_check;

ALTER TABLE public.match_officials
  DROP COLUMN IF EXISTS overall_rating,
  DROP COLUMN IF EXISTS employment_type;

------------------------------------------------------------------
-- 5. competition_teams DEFAULT restore
------------------------------------------------------------------
ALTER TABLE public.competition_teams
  ALTER COLUMN status SET DEFAULT 'active';

------------------------------------------------------------------
-- 4. leagues — squad mode + standings visibility
------------------------------------------------------------------
ALTER TABLE public.leagues
  DROP CONSTRAINT IF EXISTS leagues_standings_visibility_check,
  DROP CONSTRAINT IF EXISTS leagues_squad_mode_check;

ALTER TABLE public.leagues
  DROP COLUMN IF EXISTS standings_visibility,
  DROP COLUMN IF EXISTS squad_mode_locked_at,
  DROP COLUMN IF EXISTS squad_mode;

------------------------------------------------------------------
-- 3. leagues.live_channel_key
------------------------------------------------------------------
DROP INDEX IF EXISTS public.leagues_live_channel_key_key;

ALTER TABLE public.leagues
  DROP COLUMN IF EXISTS live_channel_key;

------------------------------------------------------------------
-- 2. leagues.league_code + generator
------------------------------------------------------------------
DROP INDEX IF EXISTS public.leagues_league_code_key;

ALTER TABLE public.leagues
  ALTER COLUMN league_code DROP DEFAULT,
  ALTER COLUMN league_code DROP NOT NULL;

ALTER TABLE public.leagues
  DROP COLUMN IF EXISTS league_code;

DROP FUNCTION IF EXISTS public.generate_league_code();

------------------------------------------------------------------
-- 1. venues.live_channel_key
------------------------------------------------------------------
DROP INDEX IF EXISTS public.venues_live_channel_key_key;

ALTER TABLE public.venues
  DROP COLUMN IF EXISTS live_channel_key;
