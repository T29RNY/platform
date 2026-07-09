-- 521_venue_list_club_committee_down.sql
-- Reverts mig 521: drops the venue-token committee reader.

DROP FUNCTION IF EXISTS public.venue_list_club_committee(text, text);
