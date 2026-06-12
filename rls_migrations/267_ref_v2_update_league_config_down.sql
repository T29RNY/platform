-- Down for migration 267 — Ref V2 update_league_config.
DROP FUNCTION IF EXISTS public.update_league_config(text, text, jsonb);
