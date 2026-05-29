-- 161_league_config_squad_size_down.sql — revert mig 161.
ALTER TABLE public.league_config DROP CONSTRAINT IF EXISTS league_config_min_starting_check;
ALTER TABLE public.league_config DROP CONSTRAINT IF EXISTS league_config_max_subs_check;
ALTER TABLE public.league_config DROP COLUMN IF EXISTS min_starting;
ALTER TABLE public.league_config DROP COLUMN IF EXISTS max_subs;
