-- 525_dbs_preserve_unreturned_fields_on_blank_down.sql
-- Revert venue_upsert_staff_dbs to the mig-305 behaviour: the ON CONFLICT DO UPDATE
-- SET writes certificate_number / issued_date / notes directly from the parameters
-- (a NULL overwrites/clears the stored value). Restores the exact mig-305 body.

CREATE OR REPLACE FUNCTION public.venue_upsert_staff_dbs(
  p_token               text,
  p_member_profile_id   uuid,
  p_club_id             text,
  p_check_type          text,
  p_status              text,
  p_certificate_number  text    DEFAULT NULL,
  p_issued_date         date    DEFAULT NULL,
  p_expiry_date         date    DEFAULT NULL,
  p_notes               text    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_dbs_id   uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF p_check_type NOT IN ('basic','standard','enhanced','enhanced_barred') THEN
    RAISE EXCEPTION 'invalid_check_type' USING ERRCODE='P0001';
  END IF;
  IF p_status NOT IN ('pending','valid','expired','withdrawn') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE='P0001';
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

  INSERT INTO public.club_staff_dbs
    (member_profile_id, club_id, check_type, status, certificate_number,
     issued_date, expiry_date, notes, recorded_by, recorded_at, updated_at)
  VALUES
    (p_member_profile_id, p_club_id, p_check_type, p_status, p_certificate_number,
     p_issued_date, p_expiry_date, p_notes, auth.uid(), now(), now())
  ON CONFLICT (member_profile_id, club_id) DO UPDATE SET
    check_type         = p_check_type,
    status             = p_status,
    certificate_number = p_certificate_number,
    issued_date        = p_issued_date,
    expiry_date        = p_expiry_date,
    notes              = p_notes,
    recorded_by        = auth.uid(),
    updated_at         = now()
  RETURNING id INTO v_dbs_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'staff_dbs_recorded', 'club_staff_dbs', v_dbs_id::text,
          jsonb_build_object('member_profile_id', p_member_profile_id, 'club_id', p_club_id,
                             'check_type', p_check_type, 'status', p_status));

  RETURN jsonb_build_object('ok', true, 'dbs_id', v_dbs_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_upsert_staff_dbs(text, uuid, text, text, text, text, date, date, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_upsert_staff_dbs(text, uuid, text, text, text, text, date, date, text) TO anon, authenticated;
