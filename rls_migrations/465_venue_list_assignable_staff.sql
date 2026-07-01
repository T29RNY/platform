-- 465_venue_list_assignable_staff.sql
-- Incident Triage — PR #4 support: assignable-staff read for the triage Assign picker.
-- Returns the venue's ACTIVE, ACCEPTED admins (those with an auth user_id) so the
-- desktop/mobile triage UI can offer an assignee list whose user_ids exactly match
-- what venue_triage_incident (mig 462) validates against
-- (venue_admins WHERE status='active' AND revoked_at IS NULL AND user_id present).
--
-- Un-gated (unlike venue_list_admins, which needs manage_logins): any venue caller
-- may load the assignee list to assign an incident. Exposes only user_id + display
-- name + role of the operator's OWN staff to that operator's token — no cross-venue reach.
--
-- Consumers (Hard Rule #14): apps/venue Operations IncidentActions (desktop, PR#4);
-- apps/inorout mobile OperationsTonight (PR#5).

CREATE OR REPLACE FUNCTION public.venue_list_assignable_staff(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_rows   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', va.user_id,
           'name',    COALESCE(up.display_name, va.email),
           'role',    va.role
         ) ORDER BY COALESCE(up.display_name, va.email)), '[]'::jsonb)
    INTO v_rows
  FROM public.venue_admins va
  LEFT JOIN public.user_profiles up ON up.user_id = va.user_id
  WHERE va.venue_id = v_caller.venue_id
    AND va.status = 'active'
    AND va.revoked_at IS NULL
    AND va.user_id IS NOT NULL;

  RETURN jsonb_build_object('ok', true, 'staff', v_rows);
END;
$function$;

-- Any venue caller may assign → anon + authenticated (parity with the triage write RPCs).
-- REVOKE anon-then-nothing: we WANT anon (venue_admin_token flow), so grant it explicitly.
REVOKE ALL ON FUNCTION public.venue_list_assignable_staff(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_assignable_staff(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
