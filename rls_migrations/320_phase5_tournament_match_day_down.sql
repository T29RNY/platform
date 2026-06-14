-- 320_phase5_tournament_match_day_down.sql
-- Reverses mig 320: drop tournament-specific RPCs, revert get_fixture_state_by_ref_token
-- to pre-320 body, drop current_period column.
-- NOTE: get_fixture_state_by_ref_token must be restored from mig 265 body manually
-- if rollback is needed in production.

DROP FUNCTION IF EXISTS public.club_admin_get_standings(uuid, uuid);
DROP FUNCTION IF EXISTS public.ref_confirm_tournament_match(text);
DROP FUNCTION IF EXISTS public.ref_undo_tournament_goal(text, text);
DROP FUNCTION IF EXISTS public.ref_record_tournament_goal(text, text, integer, text, uuid, text, text, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.ref_set_tournament_period(text, text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ref_start_tournament_match(text, uuid, timestamptz);

ALTER TABLE public.fixtures DROP COLUMN IF EXISTS current_period;
