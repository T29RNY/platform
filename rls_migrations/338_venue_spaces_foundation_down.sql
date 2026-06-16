-- 338_venue_spaces_foundation_down.sql
-- Reverses 338_venue_spaces_foundation.sql.

DROP FUNCTION IF EXISTS public.venue_list_spaces(text);
DROP FUNCTION IF EXISTS public.venue_update_space(text,uuid,jsonb);
DROP FUNCTION IF EXISTS public.venue_create_space(text,text,int,text,text,boolean,text,text);
DROP FUNCTION IF EXISTS public._space_is_available(uuid, timestamptz, timestamptz);

DROP TABLE IF EXISTS public.venue_spaces;

SELECT pg_notify('pgrst', 'reload schema');
