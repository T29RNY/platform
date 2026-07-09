-- 518_self_serve_create_club_down.sql
-- Reverses 518_self_serve_create_club.sql. Drops the function only — the venues
-- columns it reuses (verification_status/origin/created_by_user) are owned by
-- mig 484 and are NOT dropped here. Any rows already created by the writer are
-- left in place (dropping the function does not un-provision real clubs/venues).
DROP FUNCTION IF EXISTS public.self_serve_create_club(text, text, text, text);
