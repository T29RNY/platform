-- 446 DOWN: drop the Phase 3 club-manager admin write RPCs.
DROP FUNCTION IF EXISTS public.club_set_page(text,text,text,text,text,text,text,text,text,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.club_publish_page(text,boolean);
DROP FUNCTION IF EXISTS public.club_add_sponsor(text,text,text,text,int);
DROP FUNCTION IF EXISTS public.club_update_sponsor(uuid,text,text,text,int,boolean);
DROP FUNCTION IF EXISTS public.club_remove_sponsor(uuid);
DROP FUNCTION IF EXISTS public.club_list_sponsors(text);
DROP FUNCTION IF EXISTS public.club_create_post(text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.club_update_post(uuid,text,text,text,text);
DROP FUNCTION IF EXISTS public.club_delete_post(uuid);
DROP FUNCTION IF EXISTS public.club_publish_post(uuid,boolean);
DROP FUNCTION IF EXISTS public.club_list_posts(text);
DROP FUNCTION IF EXISTS public.club_set_safeguarding(text,int,boolean);
