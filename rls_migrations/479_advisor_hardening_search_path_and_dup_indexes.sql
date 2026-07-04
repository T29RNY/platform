-- 479_advisor_hardening_search_path_and_dup_indexes.sql
-- Resolves genuine Supabase advisor findings surfaced by nightly routine D
-- (2026-07-04). Dark-in-prod: no behaviour change, pure security/perf hardening.
--
-- Item 2 — function_search_path_mutable (5 WARN): pin search_path on 5 helper
--   functions that lacked it (proconfig was null), matching every other RPC in
--   this codebase. Prevents search_path-hijack. ALTER only — bodies untouched.
-- Item 3 — duplicate_index (3 WARN): drop 3 redundant indexes created by
--   mig 164_venue_display_columns; the identical originals from
--   mig 055_phase1_new_tables (leagues_venue_id_idx / match_events_fixture_id_idx
--   / seasons_league_id_idx) are kept. Verified 2026-07-04: none unique/primary,
--   none backs a constraint.
--
-- Applied live via mcp__supabase__apply_migration 2026-07-04 (verified:
-- proconfig set on all 5; idx_* dropped, *_id_idx originals retained).

ALTER FUNCTION public._membership_period_interval(text)                 SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public._ref_clock_owner_json(fixtures)                   SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public._venue_has_cap(text, text[], text[], text)        SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public._venue_role_rank(text)                            SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.player_match_propagate_match_type()               SET search_path = 'public', 'pg_temp';

DROP INDEX IF EXISTS public.idx_leagues_venue;
DROP INDEX IF EXISTS public.idx_match_events_fixture;
DROP INDEX IF EXISTS public.idx_seasons_league;
