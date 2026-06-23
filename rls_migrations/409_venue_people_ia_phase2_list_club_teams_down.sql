-- 409_venue_people_ia_phase2_list_club_teams_down.sql
-- Reverse of 409: drop the venue-wide club-teams reader.

DROP FUNCTION IF EXISTS public.venue_list_club_teams(text);
