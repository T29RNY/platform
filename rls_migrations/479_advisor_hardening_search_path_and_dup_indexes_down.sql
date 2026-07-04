-- 479_advisor_hardening_search_path_and_dup_indexes_down.sql
-- Inverse of 479: unset the pinned search_path and recreate the dropped
-- duplicate indexes. (Down is for completeness/rollback only — the forward
-- state is the desired one.)

ALTER FUNCTION public._membership_period_interval(text)                 RESET search_path;
ALTER FUNCTION public._ref_clock_owner_json(fixtures)                   RESET search_path;
ALTER FUNCTION public._venue_has_cap(text, text[], text[], text)        RESET search_path;
ALTER FUNCTION public._venue_role_rank(text)                            RESET search_path;
ALTER FUNCTION public.player_match_propagate_match_type()               RESET search_path;

CREATE INDEX IF NOT EXISTS idx_leagues_venue       ON public.leagues      USING btree (venue_id);
CREATE INDEX IF NOT EXISTS idx_match_events_fixture ON public.match_events USING btree (fixture_id);
CREATE INDEX IF NOT EXISTS idx_seasons_league      ON public.seasons      USING btree (league_id);
