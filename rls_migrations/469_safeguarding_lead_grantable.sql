-- Migration 469: make 'safeguarding_lead' grantable through venue_update_admin.
-- (Incident Triage Phase 2, PR #4 — the venue desktop UI's designation path.)
--
-- GAP FIX. Mig 466 added 'safeguarding_lead' to the venue_admins_caps_known CHECK
-- constraint, but venue_update_admin (the ONLY caps-editing RPC — the staff
-- screen's designation path) has a HARD-CODED grantable-caps whitelist of the 5
-- operational caps. Granting 'safeguarding_lead' therefore hit
-- `p_caps_grant <@ v_caps` = false → RAISE 'cap_not_grantable', so no Lead could
-- EVER be designated in the live system. This is exactly the "grep every
-- hard-coded 5-cap array and update same-commit" step the handoff flagged.
--
-- Body reproduced VERBATIM from live (pg_get_functiondef 2026-07-02). The ONLY
-- change is 'safeguarding_lead' appended to the grantable-caps unnest array
-- (marked /* SG469 */). Grantability still routes through _venue_has_cap, so an
-- OWNER (owner⇒true) or a MANAGER-with-manage_logins (manager⇒true) can designate
-- a Lead; a plain staff member cannot. This governs only WHO MAY DESIGNATE — the
-- separate grant-only _venue_is_safeguarding_lead still governs WHO IS a Lead
-- (unchanged; owner/manager are NOT auto-leads).

CREATE OR REPLACE FUNCTION public.venue_update_admin(p_venue_token text, p_admin_id uuid, p_role text DEFAULT NULL::text, p_caps_grant text[] DEFAULT NULL::text[], p_caps_deny text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_t      record;
  v_caps   text[];
  v_owners int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_logins') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_t FROM public.venue_admins WHERE id=p_admin_id AND venue_id=v_caller.venue_id AND revoked_at IS NULL;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'admin_not_found' USING ERRCODE='P0001'; END IF;

  IF v_caller.role <> 'owner' AND public._venue_role_rank(v_t.role) >= public._venue_role_rank(v_caller.role) THEN
    RAISE EXCEPTION 'target_above_caller' USING ERRCODE='P0001'; END IF;

  IF p_role IS NOT NULL THEN
    IF p_role NOT IN ('owner','manager','staff') THEN RAISE EXCEPTION 'bad_role' USING ERRCODE='P0001'; END IF;
    IF public._venue_role_rank(p_role) >= public._venue_role_rank(v_caller.role) AND v_caller.role <> 'owner' THEN
      RAISE EXCEPTION 'role_above_caller' USING ERRCODE='P0001'; END IF;
    IF v_t.role='owner' AND p_role<>'owner' THEN
      SELECT count(*) INTO v_owners FROM public.venue_admins WHERE venue_id=v_caller.venue_id AND role='owner' AND status='active' AND revoked_at IS NULL;
      IF v_owners <= 1 THEN RAISE EXCEPTION 'last_owner' USING ERRCODE='P0001'; END IF;
    END IF;
  END IF;

  IF p_caps_grant IS NOT NULL THEN
    SELECT array_agg(c) INTO v_caps FROM unnest(ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','safeguarding_lead' /* SG469 */]) c
     WHERE public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, c);
    IF NOT (p_caps_grant <@ COALESCE(v_caps,'{}')) THEN RAISE EXCEPTION 'cap_not_grantable' USING ERRCODE='P0001'; END IF;
  END IF;

  UPDATE public.venue_admins
     SET role       = COALESCE(p_role, role),
         caps_grant = COALESCE(p_caps_grant, caps_grant),
         caps_deny  = COALESCE(p_caps_deny, caps_deny)
   WHERE id = p_admin_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_admin_updated', 'venue_admin', p_admin_id::text,
    jsonb_build_object('venue_id', v_caller.venue_id, 'role', COALESCE(p_role, v_t.role)));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
