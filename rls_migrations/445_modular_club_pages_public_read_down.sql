-- Down for 445 — drop the anon public-read RPC.
DROP FUNCTION IF EXISTS public.get_club_public(text);
