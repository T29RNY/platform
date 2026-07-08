-- 515 DOWN: drop the venue-token club-page twins. The club-manager originals
-- (club_set_page / club_publish_page / club_get_page, migs 446/448) and the public
-- reader (get_club_public) are untouched by 515 and remain.
DROP FUNCTION IF EXISTS public.venue_get_club_page(text,text);
DROP FUNCTION IF EXISTS public.venue_set_club_page(text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.venue_publish_club_page(text,text,boolean);
SELECT pg_notify('pgrst','reload schema');
