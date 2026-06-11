-- Down — Migration 251 (venue_ensure_invite_link)
DROP FUNCTION IF EXISTS public.venue_ensure_invite_link(text, text, text, text);
SELECT pg_notify('pgrst', 'reload schema');
