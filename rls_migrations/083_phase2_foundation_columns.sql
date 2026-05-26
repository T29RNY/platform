-- 083_phase2_foundation_columns.sql
--
-- Phase 2 (League Mode) — Cycle 2.1 foundation columns.
--
-- ADDITIVE ONLY. No DROPs, no RENAMEs, no behaviour change on
-- existing rows. Every Phase 1 table targeted here is empty in
-- production (mig 055 shipped the schema, no rows yet), with the
-- one exception of competition_teams.status DEFAULT change — also
-- safe because the table is empty.
--
-- Changes:
--   1. venues.live_channel_key — realtime broadcast topology
--   2. leagues.league_code     — 8-char alphanumeric /join/CODE
--   3. leagues.live_channel_key
--   4. leagues.squad_mode + squad_mode_locked_at + standings_visibility
--   5. competition_teams.status DEFAULT 'active' → 'pending'
--   6. match_officials.employment_type + overall_rating
--   7. playing_areas.is_available + maintenance_windows
--   8. NEW FUNCTION public.generate_league_code() — 8-char alphanumeric
--      excluding visually ambiguous chars (0/O/1/I/L). 31^8 ≈ 852bn
--      combinations; collision-retry up to 10 attempts.

------------------------------------------------------------------
-- 1. venues.live_channel_key
------------------------------------------------------------------
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS live_channel_key text NOT NULL
    DEFAULT (gen_random_uuid())::text;

CREATE UNIQUE INDEX IF NOT EXISTS venues_live_channel_key_key
  ON public.venues (live_channel_key);

------------------------------------------------------------------
-- 2/3. leagues — league_code + live_channel_key
------------------------------------------------------------------
-- generate_league_code() lives below; declare here first so the
-- DEFAULT can reference it.
CREATE OR REPLACE FUNCTION public.generate_league_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code     text;
  v_attempts int := 0;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet, (floor(random() * 31)::int) + 1, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE league_code = v_code) THEN
      RETURN v_code;
    END IF;
    v_attempts := v_attempts + 1;
    IF v_attempts > 10 THEN
      RAISE EXCEPTION 'league_code_generation_exhausted';
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_league_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_league_code() TO service_role;

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS league_code text;

-- Backfill (no-op today; safe for any future re-run on populated table)
UPDATE public.leagues
  SET league_code = public.generate_league_code()
  WHERE league_code IS NULL;

ALTER TABLE public.leagues
  ALTER COLUMN league_code SET NOT NULL,
  ALTER COLUMN league_code SET DEFAULT public.generate_league_code();

CREATE UNIQUE INDEX IF NOT EXISTS leagues_league_code_key
  ON public.leagues (league_code);

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS live_channel_key text NOT NULL
    DEFAULT (gen_random_uuid())::text;

CREATE UNIQUE INDEX IF NOT EXISTS leagues_live_channel_key_key
  ON public.leagues (live_channel_key);

------------------------------------------------------------------
-- 4. leagues — squad mode + standings visibility
------------------------------------------------------------------
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS squad_mode text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS squad_mode_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS standings_visibility text NOT NULL DEFAULT 'public';

ALTER TABLE public.leagues
  ADD CONSTRAINT leagues_squad_mode_check
    CHECK (squad_mode IN ('registered','open','mid_rigid')) NOT VALID;
ALTER TABLE public.leagues VALIDATE CONSTRAINT leagues_squad_mode_check;

ALTER TABLE public.leagues
  ADD CONSTRAINT leagues_standings_visibility_check
    CHECK (standings_visibility IN ('public','private')) NOT VALID;
ALTER TABLE public.leagues VALIDATE CONSTRAINT leagues_standings_visibility_check;

------------------------------------------------------------------
-- 5. competition_teams.status DEFAULT flip 'active' → 'pending'
------------------------------------------------------------------
-- Table is empty; safe to change default. Phase 2 manual-approval
-- flow requires new registrations to start pending.
ALTER TABLE public.competition_teams
  ALTER COLUMN status SET DEFAULT 'pending';

------------------------------------------------------------------
-- 6. match_officials — employment_type + overall_rating
------------------------------------------------------------------
ALTER TABLE public.match_officials
  ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'freelance',
  ADD COLUMN IF NOT EXISTS overall_rating numeric;

ALTER TABLE public.match_officials
  ADD CONSTRAINT match_officials_employment_type_check
    CHECK (employment_type IN ('freelance','in_house')) NOT VALID;
ALTER TABLE public.match_officials VALIDATE CONSTRAINT match_officials_employment_type_check;

------------------------------------------------------------------
-- 7. playing_areas — is_available + maintenance_windows
------------------------------------------------------------------
-- `active` (already present) = exists at all / retired vs in-use.
-- `is_available` = currently bookable (could be retired-for-maintenance).
-- Different semantics; keep both.
ALTER TABLE public.playing_areas
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maintenance_windows jsonb NOT NULL DEFAULT '[]'::jsonb;
