-- 084_phase2_venue_league_helpers_down.sql
--
-- Reverses 084. Drops all four Phase 2 Cycle 2.1 helpers.

DROP FUNCTION IF EXISTS public.notify_league_change(text, text);
DROP FUNCTION IF EXISTS public.notify_venue_change(text, text);
DROP FUNCTION IF EXISTS public.resolve_league_caller(text);
DROP FUNCTION IF EXISTS public.resolve_venue_caller(text);
