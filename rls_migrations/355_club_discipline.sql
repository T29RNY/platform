-- Migration 355: Gym/Boxing vertical Phase 0 — club discipline identity.
-- Adds a fixed-pick-list discipline label to clubs (text + CHECK, not enum, not
-- lookup table — per MULTI-SPORT POSTURE mig 050 + session-84 sports-table rejection).
-- Default 'football' → every existing club unchanged, zero footprint on casual football.
-- Extends two read RPCs to surface it; adds one gated+audited write RPC to set it.

-- 1. Column ------------------------------------------------------------------
ALTER TABLE public.clubs
  ADD COLUMN discipline text NOT NULL DEFAULT 'football'
  CHECK (discipline IN ('football','gym','boxing','martial_arts','yoga','dance','fitness','other'));

-- 2. member_get_self — add discipline to each active_clubs[] entry ------------
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
    'discipline',  c.discipline,
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

-- 3. venue_list_clubs — add discipline to each club row ----------------------
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
        'discipline',          c.discipline,
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

-- 4. venue_set_club_discipline — gated (manage_facility) + audited write -----
CREATE OR REPLACE FUNCTION public.venue_set_club_discipline(
  p_venue_token text,
  p_club_id     text,
  p_discipline  text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_linked   boolean;
  v_old      text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'club_id_required' USING ERRCODE = 'P0001';
  END IF;

  -- defence in depth alongside the column CHECK
  IF p_discipline IS NULL OR p_discipline NOT IN
     ('football','gym','boxing','martial_arts','yoga','dance','fitness','other') THEN
    RAISE EXCEPTION 'invalid_discipline' USING ERRCODE = 'P0001';
  END IF;

  -- the club must belong to this caller's venue
  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  SELECT discipline INTO v_old FROM public.clubs WHERE id = p_club_id;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.clubs SET discipline = p_discipline WHERE id = p_club_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_discipline_set', 'club', p_club_id,
          jsonb_build_object('venue_id', v_venue_id, 'old', v_old, 'new', p_discipline));

  RETURN jsonb_build_object('ok', true, 'club_id', p_club_id, 'discipline', p_discipline);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_set_club_discipline(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_set_club_discipline(text, text, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
