-- Down-migration 355: revert club discipline identity.
-- Restores the pre-355 member_get_self / venue_list_clubs bodies (no discipline),
-- drops venue_set_club_discipline, drops clubs.discipline.

DROP FUNCTION IF EXISTS public.venue_set_club_discipline(text, text, text);

-- member_get_self — pre-355 (no discipline in active_clubs[]) -----------------
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

-- venue_list_clubs — pre-355 (no discipline) ---------------------------------
CREATE OR REPLACE FUNCTION public.venue_list_clubs(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                  c.id,
        'name',                c.name,
        'short_name',          c.short_name,
        'contact_email',       c.contact_email,
        'id_mandate',          c.id_mandate,
        'safeguarding_config', c.safeguarding_config,
        'cohorts_count', (
          SELECT count(*) FROM public.club_cohorts cc
          WHERE cc.club_id = c.id AND cc.active
        )
      ) ORDER BY c.name
    ), '[]'::jsonb)
    FROM public.clubs c
    JOIN public.club_venues cv ON cv.club_id = c.id
    WHERE cv.venue_id = v_venue_id
  );
END;
$function$;

ALTER TABLE public.clubs DROP COLUMN IF EXISTS discipline;

SELECT pg_notify('pgrst', 'reload schema');
