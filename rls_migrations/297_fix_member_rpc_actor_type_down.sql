-- Down migration for 297 — restores actor_type='member' (broken) in 5 RPCs.
-- NOTE: This restores the broken state from migs 295+296. Only run if rolling
-- back 297 specifically — the RPCs will break again at runtime.

CREATE OR REPLACE FUNCTION public.member_register_child(
  p_first_name   text,
  p_last_name    text,
  p_dob          date    DEFAULT NULL,
  p_relationship text    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_caller_profile uuid;
  v_child_id       uuid;
BEGIN
  SELECT id INTO v_caller_profile FROM member_profiles WHERE auth_user_id = v_user_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  INSERT INTO member_profiles (first_name, last_name, dob)
  VALUES (p_first_name, p_last_name, p_dob) RETURNING id INTO v_child_id;

  INSERT INTO member_guardians (child_profile_id, guardian_profile_id, relationship, is_primary, can_collect, invite_state, accepted_at)
  VALUES (v_child_id, v_caller_profile, p_relationship, true, true, 'accepted', now());

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_user_id, 'member', 'member_child_registered', 'member_profile', v_child_id::text,
          jsonb_build_object('child_profile_id', v_child_id, 'guardian_profile_id', v_caller_profile));

  RETURN jsonb_build_object('child_profile_id', v_child_id);
END; $$;
REVOKE ALL ON FUNCTION public.member_register_child(text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_register_child(text, text, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.member_update_child(p_child_profile_id uuid, p_updates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ BEGIN RAISE EXCEPTION 'rolled_back_to_mig_295_body'; END; $$;
REVOKE ALL ON FUNCTION public.member_update_child(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_update_child(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.member_accept_consent(p_document_id uuid, p_typed_signature text, p_on_behalf_of_profile_id uuid DEFAULT NULL, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ BEGIN RAISE EXCEPTION 'rolled_back_to_mig_295_body'; END; $$;
REVOKE ALL ON FUNCTION public.member_accept_consent(uuid,text,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_accept_consent(uuid,text,uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.member_self_create_profile(p_first_name text, p_last_name text DEFAULT NULL, p_email text DEFAULT NULL, p_dob date DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ BEGIN RAISE EXCEPTION 'rolled_back_to_mig_296_body'; END; $$;
REVOKE ALL ON FUNCTION public.member_self_create_profile(text,text,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_self_create_profile(text,text,text,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.member_enrol_membership(p_invite_code text, p_tier_id uuid, p_period text, p_for_profile_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ BEGIN RAISE EXCEPTION 'rolled_back_to_mig_296_body'; END; $$;
REVOKE ALL ON FUNCTION public.member_enrol_membership(text,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_enrol_membership(text,uuid,text,uuid) TO authenticated;
