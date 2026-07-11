-- 539_venue_club_doc_status_down.sql — drop the P10c venue-token doc-status reader.
DROP FUNCTION IF EXISTS public.venue_get_club_doc_status(text, text);
