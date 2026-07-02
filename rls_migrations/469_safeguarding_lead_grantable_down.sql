-- Down-migration 469: revert venue_update_admin to the pre-469 grantable-caps
-- whitelist (the 5 operational caps only — drops 'safeguarding_lead').
-- ⚠️ Reverting re-breaks Lead designation (cap_not_grantable on safeguarding_lead).

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
    SELECT array_agg(c) INTO v_caps FROM unnest(ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins']) c
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
