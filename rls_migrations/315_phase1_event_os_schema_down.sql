-- Down migration for 315 — Event OS Phase 1 schema

ALTER TABLE public.playing_areas   DROP COLUMN IF EXISTS sport_types;
ALTER TABLE public.league_config   DROP COLUMN IF EXISTS ref_ui_config;
ALTER TABLE public.competition_teams DROP COLUMN IF EXISTS waitlist_position;
ALTER TABLE public.competitions    DROP COLUMN IF EXISTS tournament_event_id;

DROP TABLE IF EXISTS public.performance_results;
DROP TABLE IF EXISTS public.performance_events;
DROP TABLE IF EXISTS public.tournament_events;
