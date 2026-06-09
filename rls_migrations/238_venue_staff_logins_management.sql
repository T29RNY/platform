-- 238_venue_staff_logins_management.sql
--
-- Venue staff logins — Phase 3 (invites + access management). The write RPCs an
-- Owner/Manager uses to invite people, change roles + per-person capabilities,
-- and remove access. All authed via resolve_venue_caller (mig 237) and gated on
-- the `manage_logins` capability, with the role-hierarchy guardrails from the
-- settled model (DECISIONS.md "VENUE LOGIN CREDENTIALS → Session 78"):
--   * Owner manages owner/manager/staff; Manager manages STAFF only.
--   * You can only grant a capability you hold yourself.
--   * The last active Owner can't be demoted or removed (no lockout).
-- Email delivery of the invite is deferred (Resend, with booking_confirmation) —
-- the invite works regardless: the invitee is activated on first sign-in by
-- venue_claim_memberships (mig 237) matching their verified email.

-- role rank for the hierarchy checks
CREATE OR REPLACE FUNCTION public._venue_role_rank(p_role text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role WHEN 'owner' THEN 3 WHEN 'manager' THEN 2 WHEN 'staff' THEN 1 ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public._venue_role_rank(text) FROM PUBLIC;

-- ── list the venue's logins (members + pending invites) ─────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_admins(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_self   uuid := auth.uid();
  v_rows   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_logins') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', va.id, 'email', va.email, 'role', va.role, 'status', va.status,
           'caps_grant', va.caps_grant, 'caps_deny', va.caps_deny,
           'is_self', (va.user_id IS NOT NULL AND va.user_id = v_self),
           'granted_at', va.granted_at
         ) ORDER BY public._venue_role_rank(va.role) DESC, va.email), '[]'::jsonb)
    INTO v_rows
  FROM public.venue_admins va
  WHERE va.venue_id = v_caller.venue_id AND va.revoked_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'admins', v_rows);
END;
$function$;

-- ── invite a new login (email + role + optional per-person caps) ────────────
CREATE OR REPLACE FUNCTION public.venue_invite_admin(
  p_venue_token text, p_email text, p_role text,
  p_caps_grant text[] DEFAULT '{}', p_caps_deny text[] DEFAULT '{}')
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_caps     text[];
  v_id       uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_logins') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF p_email IS NULL OR p_email = '' THEN RAISE EXCEPTION 'email_required' USING ERRCODE='P0001'; END IF;
  IF p_role NOT IN ('owner','manager','staff') THEN RAISE EXCEPTION 'bad_role' USING ERRCODE='P0001'; END IF;

  -- assignable role: owner -> any; manager -> staff only
  IF public._venue_role_rank(p_role) >= public._venue_role_rank(v_caller.role)
     AND v_caller.role <> 'owner' THEN
    RAISE EXCEPTION 'role_above_caller' USING ERRCODE='P0001';
  END IF;

  -- grants must be a subset of the caller's own effective caps
  SELECT array_agg(c) INTO v_caps FROM unnest(ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins']) c
   WHERE public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, c);
  IF NOT (COALESCE(p_caps_grant,'{}') <@ COALESCE(v_caps,'{}')) THEN
    RAISE EXCEPTION 'cap_not_grantable' USING ERRCODE='P0001'; END IF;

  IF EXISTS (SELECT 1 FROM public.venue_admins WHERE venue_id=v_caller.venue_id AND lower(email)=lower(p_email) AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.venue_admins (venue_id, email, role, caps_grant, caps_deny, status, granted_by)
  VALUES (v_caller.venue_id, p_email, p_role, COALESCE(p_caps_grant,'{}'), COALESCE(p_caps_deny,'{}'), 'invited', auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_admin_invited', 'venue_admin', v_id::text,
    jsonb_build_object('venue_id', v_caller.venue_id, 'email', lower(p_email), 'role', p_role));

  RETURN jsonb_build_object('ok', true, 'admin_id', v_id, 'status', 'invited');
END;
$function$;

-- ── update a login's role and/or per-person caps ────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_update_admin(
  p_venue_token text, p_admin_id uuid,
  p_role text DEFAULT NULL, p_caps_grant text[] DEFAULT NULL, p_caps_deny text[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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

  -- can only manage people below you (manager -> staff only; owner -> anyone)
  IF v_caller.role <> 'owner' AND public._venue_role_rank(v_t.role) >= public._venue_role_rank(v_caller.role) THEN
    RAISE EXCEPTION 'target_above_caller' USING ERRCODE='P0001'; END IF;

  IF p_role IS NOT NULL THEN
    IF p_role NOT IN ('owner','manager','staff') THEN RAISE EXCEPTION 'bad_role' USING ERRCODE='P0001'; END IF;
    IF public._venue_role_rank(p_role) >= public._venue_role_rank(v_caller.role) AND v_caller.role <> 'owner' THEN
      RAISE EXCEPTION 'role_above_caller' USING ERRCODE='P0001'; END IF;
    -- never strand the last active owner
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

-- ── revoke a login (soft-delete) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_revoke_admin(p_venue_token text, p_admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_t      record;
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

  IF v_t.role='owner' THEN
    SELECT count(*) INTO v_owners FROM public.venue_admins WHERE venue_id=v_caller.venue_id AND role='owner' AND status='active' AND revoked_at IS NULL;
    IF v_owners <= 1 THEN RAISE EXCEPTION 'last_owner' USING ERRCODE='P0001'; END IF;
  END IF;

  UPDATE public.venue_admins
     SET status='revoked', revoked_at=now(), revoked_by=auth.uid()
   WHERE id = p_admin_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_admin_revoked', 'venue_admin', p_admin_id::text,
    jsonb_build_object('venue_id', v_caller.venue_id, 'email', lower(v_t.email), 'role', v_t.role));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_list_admins(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_admins(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_invite_admin(text, text, text, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_invite_admin(text, text, text, text[], text[]) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_update_admin(text, uuid, text, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_admin(text, uuid, text, text[], text[]) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_revoke_admin(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_revoke_admin(text, uuid) TO anon, authenticated;
