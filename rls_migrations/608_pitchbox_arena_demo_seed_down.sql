-- 608_pitchbox_arena_demo_seed_down.sql
-- Reverses 608_pitchbox_arena_demo_seed.sql. Leaf-first, FK-safe. Idempotent
-- (each DELETE is a no-op if the rows are already gone). Removes ONLY Pitchbox
-- Arena rows (venue_id='pitchbox_arena' / league_pitchbox / club_pitchbox / the
-- team_pbx_* teams / Joe's auth user) — touches nothing else.

-- fixtures + competition_teams must go before their competitions
DELETE FROM public.fixtures
 WHERE competition_id IN (
   SELECT id FROM public.competitions
    WHERE season_id IN (SELECT id FROM public.seasons WHERE league_id = 'league_pitchbox')
       OR tournament_event_id IN (SELECT id FROM public.tournament_events WHERE venue_id = 'pitchbox_arena'));

DELETE FROM public.competition_teams
 WHERE competition_id IN (
   SELECT id FROM public.competitions
    WHERE season_id IN (SELECT id FROM public.seasons WHERE league_id = 'league_pitchbox')
       OR tournament_event_id IN (SELECT id FROM public.tournament_events WHERE venue_id = 'pitchbox_arena'));

-- bookings + all occupancy (fixture-sync rows are keyed by venue too)
DELETE FROM public.pitch_bookings   WHERE venue_id = 'pitchbox_arena';
DELETE FROM public.pitch_occupancy  WHERE venue_id = 'pitchbox_arena';

-- competitions (before seasons + tournament_events they reference)
DELETE FROM public.competitions
 WHERE season_id IN (SELECT id FROM public.seasons WHERE league_id = 'league_pitchbox')
    OR tournament_event_id IN (SELECT id FROM public.tournament_events WHERE venue_id = 'pitchbox_arena');

DELETE FROM public.seasons            WHERE league_id = 'league_pitchbox';
DELETE FROM public.tournament_events  WHERE venue_id  = 'pitchbox_arena';
DELETE FROM public.league_config      WHERE league_id = 'league_pitchbox';
DELETE FROM public.leagues            WHERE id        = 'league_pitchbox';  -- before playing_areas (default_playing_area_id FK)
DELETE FROM public.teams              WHERE id LIKE 'team_pbx_%';

-- club + link + (defensive) any flag row
DELETE FROM public.club_venues        WHERE venue_id = 'pitchbox_arena';
DELETE FROM public.club_features      WHERE club_id  = 'club_pitchbox';
DELETE FROM public.clubs              WHERE id       = 'club_pitchbox';

-- owner row, then pitches, then venue, then company
DELETE FROM public.venue_admins       WHERE venue_id = 'pitchbox_arena';
DELETE FROM public.playing_areas      WHERE venue_id = 'pitchbox_arena';
DELETE FROM public.venues             WHERE id       = 'pitchbox_arena';
DELETE FROM public.companies          WHERE id       = 'company_pitchbox';

-- Joe's auth user (identities before users)
DELETE FROM auth.identities           WHERE user_id  = 'bbc00000-0000-4000-8000-000000000001';
DELETE FROM auth.users                WHERE id       = 'bbc00000-0000-4000-8000-000000000001';
