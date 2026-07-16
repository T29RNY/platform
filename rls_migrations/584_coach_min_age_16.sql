-- Migration 584: a session coach must be 16+ — close the PICK path, correct mig 583's rule
--
-- THE BUG (found on-device, DF Sports): PR #5b's "Add session coach → Pick member"
-- picker lists every club member carrying a member_profile_id. DF is a KIDS' coaching
-- academy, so every member IS a child — the sheet offered five children (aged 5–11) as
-- session coaches, one tap from putting a 7-year-old on the coach roster where she'd be
-- flagged serves_youth and shown as staff on the safeguarding board. venue_upsert_club_coach
-- had NO age gate at all.
--
-- This was incoherent with mig 583, which (after an adversarial security review) already
-- refused to REUSE a minor's profile on the create-by-email path. Create refused minors;
-- Pick accepted them.
--
-- THE RULE (operator-confirmed against DF's real model): **a coach must be 16 or older.**
--   • NOT 18. DF genuinely has 16-year-olds coaching (young leaders / assistant coaches —
--     the FA norm). An 18 line would lock out a real part of their model.
--   • Only a KNOWN under-16 dob is rejected. A NULL dob is allowed: an identity-only coach
--     shell (mig 583) carries no dob, and the picker/admin is naming a person deliberately.
--   • mig 583's `NOT EXISTS (member_guardians …)` exclusion is REMOVED, not ported. It
--     conflated "has a guardian on file" with "is a child". DF's 16-year-old coaches are
--     overwhelmingly academy graduates — kids who came up through the club and now coach —
--     so they have guardians on file AND are legitimate coaches. That rule would have
--     refused to reuse their profile and silently minted a DUPLICATE person for them.
--     The age gate alone is the correct, sufficient rule.
--
-- Server-side is the authoritative gate (the picker also filters client-side, but a
-- client-only filter leaves the RPC open to any venue-token caller).

-- ─── 1. venue_upsert_club_coach (mig 582) — add the 16+ gate ─────────────────

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
  v_dob      date;
  v_found    boolean;
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

  -- Confirm club is linked to this caller's venue (same gate as club-staff).
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  -- Confirm member profile exists (a session coach need NOT be an enrolled member)
  -- and capture dob for the age gate in the same read.
  SELECT true, mp.dob INTO v_found, v_dob
    FROM public.member_profiles mp WHERE mp.id = p_member_profile_id;
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE='P0001';
  END IF;

  -- A coach must be 16+. Rejects only a KNOWN under-16 dob (see header).
  IF v_dob IS NOT NULL AND v_dob > (current_date - interval '16 years') THEN
    RAISE EXCEPTION 'coach_must_be_16' USING ERRCODE='P0001';
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

-- ─── 2. venue_create_coach_profile (mig 583) — 18 → 16, drop guardian-link rule ───

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

  -- Reuse ONLY a member_profile already tied to THIS club (member or coach), ONLY when
  -- the match is unambiguous (exactly one), and ONLY when they are 16+ (a known under-16
  -- dob is never reused onto the coach roster). Never a global email lookup — see mig 583's
  -- header (cross-tenant enumeration). The guardian-link exclusion mig 583 carried is
  -- REMOVED here: DF's 16-year-old coaches are academy graduates who legitimately have
  -- guardians on file, and excluding them minted duplicate people (see header).
  IF v_email IS NOT NULL THEN
    SELECT array_agg(mp.id) INTO v_ids
    FROM public.member_profiles mp
    WHERE lower(mp.email) = v_email
      AND (mp.dob IS NULL OR mp.dob <= current_date - interval '16 years')
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
