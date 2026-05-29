-- 159_fixture_lineups_and_submit_down.sql
-- Reverses 159 (Cycle 5.6 Stage A). Drops the two RPCs and the fixture_lineups table.
-- NOTE: dropping fixture_lineups discards any submitted lineups; player_registrations
-- rows auto-created by submit are NOT removed (they are legitimate registrations).

DROP FUNCTION IF EXISTS public.get_team_next_fixture_lineup(text);
DROP FUNCTION IF EXISTS public.team_admin_submit_lineup(text, uuid, jsonb);
DROP TABLE IF EXISTS public.fixture_lineups;
