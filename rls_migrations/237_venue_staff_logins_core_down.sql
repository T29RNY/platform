-- 237_venue_staff_logins_core_down.sql
-- Revert Phase 1: restore the 3-column resolve_venue_caller, drop the new RPCs
-- + helper, and drop venue_admins (incl. the demo seed). Restores byte-for-byte
-- the pre-237 resolver (shared-token + platform-admin stages only).

DROP FUNCTION IF EXISTS public.venue_whoami();
DROP FUNCTION IF EXISTS public.venue_claim_memberships();

DROP FUNCTION IF EXISTS public.resolve_venue_caller(text);
CREATE FUNCTION public.resolve_venue_caller(p_token text)
 RETURNS TABLE(venue_id text, actor_type text, actor_ident text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_token IS NOT NULL THEN
    RETURN QUERY
      SELECT v.id::text,
             'venue_admin'::text,
             ('venue_admin_token:' || md5(p_token))::text
      FROM venues v
      WHERE v.venue_admin_token = p_token
        AND v.active = true
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF v_uid IS NOT NULL AND public.is_platform_admin() THEN
    RETURN QUERY
      SELECT NULL::text,
             'platform_admin'::text,
             ('user_id:' || v_uid::text)::text;
    RETURN;
  END IF;
END;
$function$;

DROP FUNCTION IF EXISTS public._venue_has_cap(text, text[], text[], text);
DROP TABLE IF EXISTS public.venue_admins;
