-- Down for migration 189 — drop the player contact setter + reader.
DROP FUNCTION IF EXISTS public.set_player_contact(text, text, text);
DROP FUNCTION IF EXISTS public.get_my_contact(text);
