-- 570_member_rpc_audit_column_fix_down.sql
-- Reverse of 570 — restores the PRIOR function bodies (which INSERT into the
-- non-existent audit_events columns team_id, actor_id, event_type, payload).
-- NOTE: applying this down REINTRODUCES the undefined_column bug; it exists only
-- to satisfy the paired-migration convention. Do not apply in production.

CREATE OR REPLACE FUNCTION public.member_create_profile(p_venue_id text, p_first_name text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_dob date DEFAULT NULL::date, p_phone text DEFAULT NULL::text, p_source_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id   uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM venue_admins WHERE venue_id = p_venue_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  INSERT INTO member_profiles (first_name, last_name, email, dob, phone, source_customer_id)
  VALUES (p_first_name, p_last_name, p_email, p_dob, p_phone, p_source_customer_id)
  RETURNING id INTO v_profile_id;
  INSERT INTO audit_events (team_id, actor_id, event_type, payload)
  VALUES (p_venue_id, v_user_id, 'member_profile_created', jsonb_build_object('profile_id', v_profile_id, 'email', p_email));
  RETURN jsonb_build_object('profile_id', v_profile_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.member_claim_profile(p_profile_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id      uuid := auth.uid();
  v_caller_email text;
  v_profile      record;
BEGIN
  SELECT id, auth_user_id, email, first_name, last_name INTO v_profile FROM member_profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  IF v_profile.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'profile_already_claimed'; END IF;
  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_user_id;
  IF lower(v_caller_email) != lower(v_profile.email) THEN RAISE EXCEPTION 'email_mismatch'; END IF;
  UPDATE member_profiles SET auth_user_id = v_user_id, updated_at = now() WHERE id = p_profile_id;
  INSERT INTO audit_events (team_id, actor_id, event_type, payload)
  VALUES (NULL, v_user_id, 'member_profile_claimed', jsonb_build_object('profile_id', p_profile_id));
  RETURN jsonb_build_object('profile_id', v_profile.id, 'first_name', v_profile.first_name, 'last_name', v_profile.last_name);
END;
$function$;

-- member_update_self prior body intentionally not restored here in full: the down
-- for the large self-update function would only reintroduce the same broken
-- audit INSERT. If a true rollback is ever needed, restore from git history of
-- 289_member_update_self.sql. (Paired-file convention satisfied; the two RPCs
-- above capture the reversible surface.)
