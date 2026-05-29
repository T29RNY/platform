-- 167_venue_update_display_config_down.sql — strict revert of 167.
DROP FUNCTION IF EXISTS public.venue_update_display_config(text, jsonb, text);
