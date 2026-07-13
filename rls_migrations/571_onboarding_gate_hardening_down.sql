-- 571_onboarding_gate_hardening_down.sql — reverse of 571.
-- Restores member_accept_consent without the invite_state='accepted' guard and
-- re-grants the default table privileges on the two tables. (Access is still
-- RLS-deny-by-default with no policies, so the GRANTs are inert.)

CREATE OR REPLACE FUNCTION public.member_accept_consent(p_document_id uuid, p_typed_signature text, p_on_behalf_of_profile_id uuid DEFAULT NULL::uuid, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
    v_member_prof := v_caller_prof; v_guardian_of := NULL;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.member_guardians WHERE child_profile_id = p_on_behalf_of_profile_id AND guardian_profile_id = v_caller_prof) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_member_prof := p_on_behalf_of_profile_id; v_guardian_of := v_caller_prof;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.policy_documents WHERE id = p_document_id AND is_current) THEN
    RAISE EXCEPTION 'document_not_current' USING ERRCODE='P0001';
  END IF;
  BEGIN
    INSERT INTO public.consent_acceptances (document_id, member_profile_id, signed_on_behalf_of, typed_signature, ip_address, user_agent, auth_user_id)
    VALUES (p_document_id, v_member_prof, v_guardian_of, v_sig, p_ip_address, p_user_agent, v_uid) RETURNING id INTO v_acc_id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_accepted' USING ERRCODE='P0001'; END;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'player', v_caller_prof::text, 'consent_accepted', 'consent_acceptance', v_acc_id::text,
          jsonb_build_object('document_id', p_document_id, 'member_profile_id', v_member_prof, 'signed_on_behalf_of', v_guardian_of));
  RETURN jsonb_build_object('ok', true, 'acceptance_id', v_acc_id);
END;
$function$;

GRANT ALL ON public.people              TO anon, authenticated;
GRANT ALL ON public.member_id_documents TO anon, authenticated;
