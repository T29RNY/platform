-- 308_multi_venue_activation_down.sql
-- Reverses mig 308: drops new RPCs, restores rewrites to mig 273/274 shapes,
-- restores member_get_self to mig 301 shape, reverts schema changes.

-- Drop new RPCs
DROP FUNCTION IF EXISTS public.venue_search(text,text,text);
DROP FUNCTION IF EXISTS public.venue_list_club_venues(text,text);
DROP FUNCTION IF EXISTS public.venue_remove_club_venue(text,text,text);
DROP FUNCTION IF EXISTS public.venue_add_club_venue(text,text,text);

-- Restore get_member_pass to mig-273 shape (V1 only, no valid_venues, no member_profile_id)
CREATE OR REPLACE FUNCTION public.get_member_pass(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v jsonb; v_m record; v_offers jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT m.id, m.venue_id, m.tier_id INTO v_m FROM public.venue_memberships m WHERE m.pass_token=p_token AND m.status<>'cancelled';
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('offer_id', o.id, 'partner_name', pn.name,
            'title', o.title, 'description', o.description, 'code', o.code) ORDER BY o.created_at), '[]'::jsonb)
    INTO v_offers
    FROM public.partner_offers o JOIN public.venue_partners pn ON pn.id=o.partner_id
   WHERE o.venue_id = v_m.venue_id AND o.active AND pn.active
     AND (o.tier_ids IS NULL OR array_length(o.tier_ids,1) IS NULL OR v_m.tier_id = ANY(o.tier_ids));
  SELECT jsonb_build_object(
    'ok', true,
    'first_name', c.first_name, 'last_name', c.last_name,
    'tier_name', t.name, 'benefits', t.benefits,
    'period', m.period, 'amount_pence', m.amount_pence,
    'status', m.status, 'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until,
    'venue_name', vn.name, 'venue_logo', vn.logo_url,
    'primary_colour', vn.primary_colour, 'secondary_colour', vn.secondary_colour,
    'check_in_code', m.pass_token,
    'offers', v_offers
  ) INTO v
  FROM public.venue_memberships m
  JOIN public.venue_customers c        ON c.id = m.customer_id
  JOIN public.venue_membership_tiers t ON t.id = m.tier_id
  JOIN public.venues vn                ON vn.id = m.venue_id
  WHERE m.id = v_m.id;
  RETURN COALESCE(v, jsonb_build_object('ok', false));
END; $fn$;
REVOKE ALL ON FUNCTION public.get_member_pass(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_pass(text) TO anon, authenticated;

-- Restore member_check_in to mig-274 shape (V1 only, customer_id NOT NULL in INSERT)
CREATE OR REPLACE FUNCTION public.member_check_in(p_display_token text, p_pass_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_venue_id   text;
  v_m          record;
  v_recent     timestamptz;
  v_count      int;
  v_already    boolean := false;
BEGIN
  IF p_display_token IS NULL OR btrim(p_display_token) = '' THEN
    RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001';
  END IF;
  p_pass_token := regexp_replace(COALESCE(p_pass_token, ''), '^.*/m/', '');
  p_pass_token := split_part(p_pass_token, '?', 1);
  p_pass_token := btrim(p_pass_token);
  IF p_pass_token = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_token'); END IF;
  SELECT id INTO v_venue_id FROM public.venues WHERE display_token = p_display_token LIMIT 1;
  IF v_venue_id IS NULL THEN RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001'; END IF;
  SELECT m.id, m.venue_id, m.customer_id, m.status,
         c.first_name, c.last_name, t.name AS tier_name
    INTO v_m
    FROM public.venue_memberships m
    JOIN public.venue_customers c        ON c.id = m.customer_id
    JOIN public.venue_membership_tiers t ON t.id = m.tier_id
   WHERE m.pass_token = p_pass_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'pass_not_found'); END IF;
  IF v_m.venue_id <> v_venue_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_venue'); END IF;
  IF v_m.status = 'cancelled' THEN RETURN jsonb_build_object('ok', false, 'reason', 'cancelled', 'first_name', v_m.first_name); END IF;
  SELECT max(checked_in_at) INTO v_recent
    FROM public.venue_member_checkins WHERE membership_id = v_m.id AND checked_in_at > now() - interval '4 hours';
  IF v_recent IS NOT NULL THEN
    v_already := true;
  ELSE
    INSERT INTO public.venue_member_checkins (venue_id, membership_id, customer_id, source)
    VALUES (v_venue_id, v_m.id, v_m.customer_id, 'display_qr');
  END IF;
  SELECT count(*) INTO v_count FROM public.venue_member_checkins WHERE membership_id = v_m.id;
  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                              action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, NULL, 'system', 'display_token:' || md5(p_display_token),
          'member_checkin', 'venue_membership', v_m.id::text,
          jsonb_build_object('via', 'display_qr', 'already_checked_in', v_already,
                             'status', v_m.status, 'visit_count', v_count));
  RETURN jsonb_build_object('ok', true, 'first_name', v_m.first_name, 'last_name', v_m.last_name,
    'tier_name', v_m.tier_name, 'status', v_m.status, 'frozen', (v_m.status = 'paused'),
    'visit_count', v_count, 'already_checked_in', v_already);
END; $fn$;
REVOKE ALL ON FUNCTION public.member_check_in(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_check_in(text,text) TO anon, authenticated;

-- Restore member_get_self to mig-301 shape (no venues in active_clubs)
CREATE OR REPLACE FUNCTION public.member_get_self()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_profile          record;
  v_id_mandate_clubs jsonb;
  v_active_clubs     jsonb;
  v_managed_teams    jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_user_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('club_id', c.id, 'club_name', c.name)), '[]'::jsonb)
  INTO v_id_mandate_clubs
  FROM public.venue_memberships vm JOIN public.clubs c ON c.id = vm.club_id
  WHERE vm.member_profile_id = v_profile.id AND vm.status = 'active' AND c.id_mandate = true;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id', c.id, 'club_name', c.name, 'cohort_id', vm.cohort_id, 'cohort_name', cc.name
  ) ORDER BY c.name, cc.name), '[]'::jsonb)
  INTO v_active_clubs
  FROM public.venue_memberships vm JOIN public.clubs c ON c.id = vm.club_id
  LEFT JOIN public.club_cohorts cc ON cc.id = vm.cohort_id
  WHERE vm.member_profile_id = v_profile.id AND vm.status IN ('active','ending');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', ct.id, 'team_name', ct.name, 'club_id', ct.club_id, 'role', ctm.role
  ) ORDER BY ct.name), '[]'::jsonb)
  INTO v_managed_teams
  FROM public.club_team_managers ctm JOIN public.club_teams ct ON ct.id = ctm.team_id
  WHERE ctm.member_profile_id = v_profile.id AND ctm.is_active = true;
  RETURN jsonb_build_object(
    'found', true, 'id', v_profile.id, 'member_profile_id', v_profile.id,
    'first_name', v_profile.first_name, 'last_name', v_profile.last_name,
    'email', v_profile.email, 'phone', v_profile.phone, 'dob', v_profile.dob,
    'gender', v_profile.gender, 'address_line1', v_profile.address_line1,
    'address_line2', v_profile.address_line2, 'address_city', v_profile.address_city,
    'address_postcode', v_profile.address_postcode,
    'ec1_name', v_profile.ec1_name, 'ec1_relationship', v_profile.ec1_relationship,
    'ec1_phone', v_profile.ec1_phone, 'ec2_name', v_profile.ec2_name,
    'ec2_relationship', v_profile.ec2_relationship, 'ec2_phone', v_profile.ec2_phone,
    'send_notes', v_profile.send_notes, 'dietary_notes', v_profile.dietary_notes,
    'consent_emergency_treatment', v_profile.consent_emergency_treatment,
    'consent_administer_medication', v_profile.consent_administer_medication,
    'may_leave_unaccompanied', v_profile.may_leave_unaccompanied,
    'authorised_collectors', v_profile.authorised_collectors,
    'photo_consent', v_profile.photo_consent,
    'created_at', v_profile.created_at, 'updated_at', v_profile.updated_at,
    'id_mandate_clubs', v_id_mandate_clubs, 'active_clubs', v_active_clubs,
    'managed_teams', v_managed_teams
  );
END; $$;
REVOKE ALL ON FUNCTION public.member_get_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_get_self() TO authenticated;

-- Restore venue_list_members to mig-272 shape (V1 only, venue_id filter only)
CREATE OR REPLACE FUNCTION public.venue_list_members(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id', m.id, 'status', m.status, 'period', m.period, 'amount_pence', m.amount_pence,
    'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until, 'cancel_at', m.cancel_at,
    'due_soon', (m.status='active' AND m.renews_at <= current_date + 7),
    'pass_token', m.pass_token,
    'customer_id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'email', c.email,
    'tier_id', t.id, 'tier_name', t.name
  ) ORDER BY m.status, c.first_name), '[]'::jsonb)
  INTO v_rows
  FROM public.venue_memberships m
  JOIN public.venue_customers c ON c.id = m.customer_id
  JOIN public.venue_membership_tiers t ON t.id = m.tier_id
  WHERE m.venue_id = v_venue_id AND m.status <> 'cancelled';
  RETURN jsonb_build_object('ok', true, 'members', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_members(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_members(text) TO anon, authenticated;

-- Revert schema changes
DROP INDEX IF EXISTS public.venue_member_checkins_by_profile;
ALTER TABLE public.venue_member_checkins DROP COLUMN IF EXISTS member_profile_id;
ALTER TABLE public.venue_member_checkins ALTER COLUMN customer_id SET NOT NULL;
