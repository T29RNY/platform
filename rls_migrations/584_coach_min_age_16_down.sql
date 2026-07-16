-- Down for 584_coach_min_age_16.sql — restores the pre-584 bodies:
--   venue_upsert_club_coach   → mig 582 (NO age gate)
--   venue_create_coach_profile → mig 583 (18-year rule + guardian-link exclusion)
-- NOTE: reverting re-opens the on-device bug this migration closed — the "Pick member"
-- picker can again add a CHILD as a session coach. Only run this to unwind 584 itself.

CREATE OR REPLACE FUNCTION public.venue_upsert_club_coach(
  p_token             text,
  p_member_profile_id uuid,
  p_club_id           text,
  p_role              text DEFAULT 'coach'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_coach_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF p_role NOT IN ('coach','assistant_coach','session_lead','other') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.member_profiles WHERE id = p_member_profile_id) THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.club_coaches (club_id, member_profile_id, role, is_active, added_by, created_at, updated_at)
  VALUES (p_club_id, p_member_profile_id, p_role, true, auth.uid(), now(), now())
  ON CONFLICT (club_id, member_profile_id) DO UPDATE SET
    role       = p_role,
    is_active  = true,
    updated_at = now()
  RETURNING id INTO v_coach_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_coach_added', 'club_coach', v_coach_id::text,
          jsonb_build_object('club_id', p_club_id, 'member_profile_id', p_member_profile_id, 'role', p_role));

  RETURN jsonb_build_object('ok', true, 'coach_id', v_coach_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.venue_create_coach_profile(
  p_token       text,
  p_club_id     text,
  p_first_name  text,
  p_last_name   text DEFAULT NULL,
  p_email       text DEFAULT NULL,
  p_phone       text DEFAULT NULL,
  p_role        text DEFAULT 'coach'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_first    text := NULLIF(btrim(p_first_name), '');
  v_last     text := NULLIF(btrim(p_last_name), '');
  v_email    text := NULLIF(lower(btrim(p_email)), '');
  v_phone    text := NULLIF(btrim(p_phone), '');
  v_profile  uuid;
  v_ids      uuid[];
  v_coach_id uuid;
  v_reused   boolean := false;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name_required' USING ERRCODE='P0001';
  END IF;
  IF p_role NOT IN ('coach','assistant_coach','session_lead','other') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT array_agg(mp.id) INTO v_ids
    FROM public.member_profiles mp
    WHERE lower(mp.email) = v_email
      AND (mp.dob IS NULL OR mp.dob <= current_date - interval '18 years')
      AND NOT EXISTS (SELECT 1 FROM public.member_guardians mg WHERE mg.child_profile_id = mp.id)
      AND (
        EXISTS (SELECT 1 FROM public.venue_memberships vm
                 WHERE vm.member_profile_id = mp.id
                   AND vm.club_id = p_club_id
                   AND vm.status <> 'cancelled')
        OR EXISTS (SELECT 1 FROM public.club_coaches cc
                    WHERE cc.member_profile_id = mp.id
                      AND cc.club_id = p_club_id)
      );
    IF v_ids IS NOT NULL AND array_length(v_ids, 1) = 1 THEN
      v_profile := v_ids[1];
    END IF;
  END IF;

  IF v_profile IS NOT NULL THEN
    v_reused := true;
  ELSE
    INSERT INTO public.member_profiles (first_name, last_name, email, phone)
    VALUES (v_first, v_last, v_email, v_phone)
    RETURNING id INTO v_profile;
    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'member_profile_created', 'member_profile', v_profile::text,
            jsonb_build_object('via', 'club_coach_create', 'club_id', p_club_id, 'has_email', v_email IS NOT NULL));
  END IF;

  INSERT INTO public.club_coaches (club_id, member_profile_id, role, is_active, added_by, created_at, updated_at)
  VALUES (p_club_id, v_profile, p_role, true, auth.uid(), now(), now())
  ON CONFLICT (club_id, member_profile_id) DO UPDATE SET
    role       = p_role,
    is_active  = true,
    updated_at = now()
  RETURNING id INTO v_coach_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_coach_added', 'club_coach', v_coach_id::text,
          jsonb_build_object('club_id', p_club_id, 'member_profile_id', v_profile, 'role', p_role, 'created_profile', NOT v_reused));

  RETURN jsonb_build_object('ok', true, 'coach_id', v_coach_id, 'member_profile_id', v_profile, 'reused', v_reused);
END;
$fn$;
