-- 238_venue_staff_logins_management_down.sql
DROP FUNCTION IF EXISTS public.venue_list_admins(text);
DROP FUNCTION IF EXISTS public.venue_invite_admin(text, text, text, text[], text[]);
DROP FUNCTION IF EXISTS public.venue_update_admin(text, uuid, text, text[], text[]);
DROP FUNCTION IF EXISTS public.venue_revoke_admin(text, uuid);
DROP FUNCTION IF EXISTS public._venue_role_rank(text);
