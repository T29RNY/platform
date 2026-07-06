-- 484_self_serve_create_venue_down.sql
--
-- Reverse of 484_self_serve_create_venue.sql.
--
-- NOTE: dropping verification_status / origin / created_by_user is destructive
-- if any self-serve venue was created after the up-migration applied. Run this
-- down only if no self-serve venue exists yet, or after migrating those rows.

DROP FUNCTION IF EXISTS public.self_serve_create_venue(text, text, text);

ALTER TABLE public.venues DROP COLUMN IF EXISTS created_by_user;
ALTER TABLE public.venues DROP COLUMN IF EXISTS origin;
ALTER TABLE public.venues DROP COLUMN IF EXISTS verification_status;
