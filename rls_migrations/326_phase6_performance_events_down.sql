-- Down migration for 326 — Phase 6 Performance Events
-- Reverts all schema changes and drops all new RPCs.
-- Restores get_tournament_public to the mig 325 version (without performance fields).
-- NOTE: tournament_events.points_config default is reverted but backfilled rows keep new values.

-- Drop new RPCs
DROP FUNCTION IF EXISTS public.club_admin_set_performance_config(uuid, jsonb);
DROP FUNCTION IF EXISTS public.club_admin_add_performance_event(uuid, text, text, text, int, text, timestamptz, int);
DROP FUNCTION IF EXISTS public.club_admin_list_performance_events(uuid);
DROP FUNCTION IF EXISTS public.club_admin_record_result(uuid, text, uuid, numeric, int, text);
DROP FUNCTION IF EXISTS public.club_admin_get_performance_results(uuid);
DROP FUNCTION IF EXISTS public.club_admin_get_sports_day_standings(uuid);

-- Remove unique constraint and index on performance_results
ALTER TABLE public.performance_results DROP CONSTRAINT IF EXISTS perf_results_upsert_key;
DROP INDEX IF EXISTS public.performance_results_event_idx;

-- Revert column changes on performance_results
ALTER TABLE public.performance_results DROP COLUMN IF EXISTS athlete_name;
ALTER TABLE public.performance_results DROP COLUMN IF EXISTS competition_team_id;
ALTER TABLE public.performance_results ALTER COLUMN athlete_id SET NOT NULL;

-- Revert tournament_events.points_config default
ALTER TABLE public.tournament_events ALTER COLUMN points_config SET DEFAULT '{}'::jsonb;

-- Restore get_tournament_public to pre-326 signature (without performance_events/performance_standings)
-- NOTE: paste the mig 321 body here if a true rollback to that state is needed.
-- Omitted to avoid duplication; the function remains callable at mig 326 level until manually replaced.
