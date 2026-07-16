-- Down-migration for 583_venue_create_coach_profile.sql
DROP FUNCTION IF EXISTS public.venue_create_coach_profile(text, text, text, text, text, text, text);
