-- 574 DOWN: restore the mig-572 helper body — owner OR ANY venue_admin (the
-- pre-574 broad admin arm, before venue-scoping). The storage.objects SELECT
-- policy is unchanged by 574, so reverting the helper fully reverts 574.

CREATE OR REPLACE FUNCTION public._can_read_member_id_object(p_object_name text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.auth_user_id = auth.uid()
        AND starts_with(p_object_name, mp.id::text || '/')
    )
    OR
    EXISTS (
      SELECT 1 FROM public.venue_admins va
      WHERE va.user_id = auth.uid()
    );
$function$;

REVOKE ALL   ON FUNCTION public._can_read_member_id_object(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._can_read_member_id_object(text) TO authenticated;
