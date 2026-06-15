-- Returns the caller's active membership pass_token for a given venue invite link.
-- Used by MembershipSignup on Stripe checkout return (?checkout=done) to surface
-- the "Open your membership pass" link without requiring the client to hold state
-- across the external Stripe redirect. Also used on initial load to detect
-- already-enrolled members and skip straight to their pass.

CREATE OR REPLACE FUNCTION public.member_get_venue_membership_pass(p_invite_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_venue_id   text;
  v_row        record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT id INTO v_profile_id
  FROM public.member_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT entity_id INTO v_venue_id
  FROM public.invite_links
  WHERE code = btrim(p_invite_code)
    AND entity_type = 'venue'
    AND action = 'venue_landing'
  LIMIT 1;

  IF v_venue_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT id, pass_token, status, tier_id, period
  INTO v_row
  FROM public.venue_memberships
  WHERE member_profile_id = v_profile_id
    AND venue_id = v_venue_id
    AND status IN ('active', 'ending')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found',         true,
    'pass_token',    v_row.pass_token,
    'membership_id', v_row.id,
    'status',        v_row.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_get_venue_membership_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_get_venue_membership_pass(text) TO authenticated;
