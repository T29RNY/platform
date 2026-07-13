-- 571_onboarding_gate_hardening.sql
-- Defense-in-depth hardening surfaced by the player+guardian onboarding
-- go-live check (2026-07-13). Two independent, strictly-tightening changes:
--
-- (a) member_accept_consent — the on-behalf-of-child guardian check did not
--     require invite_state='accepted', unlike its siblings
--     (member_update_child, guardian_submit_id_document, member_list_children).
--     No-op on today's data (every member_guardians row is 'accepted'); this
--     closes the latent gap where a future 'pending' guardian could sign a
--     child's consent while being blocked from the child's medical/ID paths.
--
-- (b) 'people' and 'member_id_documents' enable RLS with no policies but omit
--     the explicit REVOKE ALL FROM anon, authenticated that every sibling
--     onboarding table carries. They rely solely on RLS-deny-by-default. All
--     real access is via SECURITY DEFINER RPCs (which bypass grants), so
--     revoking the table grants is pure belt-and-braces with no behaviour
--     change.
--
-- NOTE: the matching invite_state filter on get_my_world()'s guardian arm is a
-- separate follow-up — get_my_world is the app-wide role resolver, so that
-- change is being handled deliberately, not bundled here.

-- ── (a) member_accept_consent: require an ACCEPTED guardianship on-behalf ─────
CREATE OR REPLACE FUNCTION public.member_accept_consent(p_document_id uuid, p_typed_signature text, p_on_behalf_of_profile_id uuid DEFAULT NULL::uuid, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_caller_prof  uuid;
  v_member_prof  uuid;
  v_guardian_of  uuid;
  v_sig          text := NULLIF(btrim(p_typed_signature), '');
  v_acc_id       uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF v_sig IS NULL THEN RAISE EXCEPTION 'signature_required' USING ERRCODE='P0001'; END IF;

  SELECT id INTO v_caller_prof FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_prof IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001'; END IF;

  IF p_on_behalf_of_profile_id IS NULL THEN
    v_member_prof := v_caller_prof;
    v_guardian_of := NULL;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
       WHERE child_profile_id = p_on_behalf_of_profile_id
         AND guardian_profile_id = v_caller_prof
         AND invite_state = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_member_prof := p_on_behalf_of_profile_id;
    v_guardian_of := v_caller_prof;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.policy_documents WHERE id = p_document_id AND is_current) THEN
    RAISE EXCEPTION 'document_not_current' USING ERRCODE='P0001';
  END IF;

  BEGIN
    INSERT INTO public.consent_acceptances
      (document_id, member_profile_id, signed_on_behalf_of, typed_signature,
       ip_address, user_agent, auth_user_id)
    VALUES
      (p_document_id, v_member_prof, v_guardian_of, v_sig,
       p_ip_address, p_user_agent, v_uid)
    RETURNING id INTO v_acc_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_accepted' USING ERRCODE='P0001';
  END;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'player', v_caller_prof::text,
          'consent_accepted', 'consent_acceptance', v_acc_id::text,
          jsonb_build_object('document_id', p_document_id,
                             'member_profile_id', v_member_prof,
                             'signed_on_behalf_of', v_guardian_of));
  RETURN jsonb_build_object('ok', true, 'acceptance_id', v_acc_id);
END;
$function$;

-- ── (b) defense-in-depth REVOKE on two onboarding tables ─────────────────────
REVOKE ALL ON public.people              FROM anon, authenticated;
REVOKE ALL ON public.member_id_documents FROM anon, authenticated;
