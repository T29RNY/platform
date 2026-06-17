-- Migration 351 — Multi-context nav (Phase 1): per-team kill-switch + pass token.
--
-- (1) FEATURE FLAG. teams.multi_context_nav gates the new context-aware nav on
--     SQUAD routes (header-avatar switcher etc) so it can ship dark and enable
--     per team during the active pilot, rolled back instantly from the DB with no
--     redeploy. Default false = the footballer's app is byte-identical to today
--     (casual-regression safety). The new CLUB/GUARDIAN nav is pure-additive
--     (those users were stranded before) and is NOT gated.
--     Delivered via a dedicated lightweight RPC rather than threading the flag
--     through the load-bearing team-state functions — feature toggles are an ops
--     concern, kept separate from data, and one place to add future flags.
--
-- (2) PASS TOKEN. member_get_self.active_clubs now carries pass_token so the
--     club-context "Pass" nav tab can deep-link to /m/<pass_token>. Additive
--     return-shape change; the JS mapper picks it up the same commit.
--
-- Consumers (Hard Rule #14): apps/inorout App.jsx (flag) + club NavBar (pass).

-- ── (1) flag column + reader RPC ─────────────────────────────────────────────
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS multi_context_nav boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_team_feature_flags(p_team_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'multi_context_nav', COALESCE(t.multi_context_nav, false)
  )
  FROM public.teams t
  WHERE t.id = p_team_id;
$function$;

REVOKE ALL ON FUNCTION public.get_team_feature_flags(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_team_feature_flags(text) TO anon, authenticated;

-- ── (2) member_get_self.active_clubs[].pass_token ────────────────────────────
CREATE OR REPLACE FUNCTION public.member_get_self()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id          uuid := auth.uid();
  v_profile          record;
  v_id_mandate_clubs jsonb;
  v_active_clubs     jsonb;
  v_managed_teams    jsonb;
BEGIN
  SELECT * INTO v_profile
  FROM public.member_profiles
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',   c.id,
    'club_name', c.name
  )), '[]'::jsonb)
  INTO v_id_mandate_clubs
  FROM public.venue_memberships vm
  JOIN public.clubs c ON c.id = vm.club_id
  WHERE vm.member_profile_id = v_profile.id
    AND vm.status = 'active'
    AND c.id_mandate = true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',     c.id,
    'club_name',   c.name,
    'cohort_id',   vm.cohort_id,
    'cohort_name', cc.name,
    'pass_token',  vm.pass_token,
    'venues',      (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('venue_id', v.id, 'venue_name', v.name)
        ORDER BY v.name
      ), '[]'::jsonb)
      FROM public.club_venues cv
      JOIN public.venues v ON v.id = cv.venue_id
      WHERE cv.club_id = c.id
    )
  ) ORDER BY c.name, cc.name), '[]'::jsonb)
  INTO v_active_clubs
  FROM public.venue_memberships vm
  JOIN public.clubs c ON c.id = vm.club_id
  LEFT JOIN public.club_cohorts cc ON cc.id = vm.cohort_id
  WHERE vm.member_profile_id = v_profile.id
    AND vm.status IN ('active', 'ending');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id',   ct.id,
    'team_name', ct.name,
    'club_id',   ct.club_id,
    'role',      ctm.role
  ) ORDER BY ct.name), '[]'::jsonb)
  INTO v_managed_teams
  FROM public.club_team_managers ctm
  JOIN public.club_teams ct ON ct.id = ctm.team_id
  WHERE ctm.member_profile_id = v_profile.id
    AND ctm.is_active = true;

  RETURN jsonb_build_object(
    'found',                          true,
    'id',                             v_profile.id,
    'member_profile_id',              v_profile.id,
    'first_name',                     v_profile.first_name,
    'last_name',                      v_profile.last_name,
    'email',                          v_profile.email,
    'phone',                          v_profile.phone,
    'dob',                            v_profile.dob,
    'gender',                         v_profile.gender,
    'address_line1',                  v_profile.address_line1,
    'address_line2',                  v_profile.address_line2,
    'address_city',                   v_profile.address_city,
    'address_postcode',               v_profile.address_postcode,
    'ec1_name',                       v_profile.ec1_name,
    'ec1_relationship',               v_profile.ec1_relationship,
    'ec1_phone',                      v_profile.ec1_phone,
    'ec2_name',                       v_profile.ec2_name,
    'ec2_relationship',               v_profile.ec2_relationship,
    'ec2_phone',                      v_profile.ec2_phone,
    'send_notes',                     v_profile.send_notes,
    'dietary_notes',                  v_profile.dietary_notes,
    'consent_emergency_treatment',    v_profile.consent_emergency_treatment,
    'consent_administer_medication',  v_profile.consent_administer_medication,
    'may_leave_unaccompanied',        v_profile.may_leave_unaccompanied,
    'authorised_collectors',          v_profile.authorised_collectors,
    'photo_consent',                  v_profile.photo_consent,
    'created_at',                     v_profile.created_at,
    'updated_at',                     v_profile.updated_at,
    'id_mandate_clubs',               v_id_mandate_clubs,
    'active_clubs',                   v_active_clubs,
    'managed_teams',                  v_managed_teams
  );
END;
$function$;
