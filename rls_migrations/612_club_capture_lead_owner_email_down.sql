-- 612_club_capture_lead_owner_email_down.sql
-- Reverts mig 612: restores club_capture_lead to its mig-596 body (no notification_log
-- insert). Signature unchanged, so a plain CREATE OR REPLACE back is sufficient — grants
-- are preserved and re-asserted. Any 'club_lead_captured' notification_log rows already
-- queued/sent survive (harmless — the drain type simply stops being produced); the
-- clubLeadNotificationsJob drain and the _mailer.js template are reverted in the same PR.

BEGIN;

CREATE OR REPLACE FUNCTION public.club_capture_lead(
  p_slug             text,
  p_parent_name      text,
  p_parent_email     text,
  p_parent_phone     text DEFAULT NULL,
  p_child_first_name text DEFAULT NULL,
  p_child_dob        date DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_club_id      text;
  v_recent_email int;
  v_lead_id      uuid;
  v_school_year  smallint;
  v_name         text := btrim(COALESCE(p_parent_name, ''));
  v_email        text := btrim(COALESCE(p_parent_email, ''));
  v_child        text := NULLIF(btrim(COALESCE(p_child_first_name, '')), '');
  v_phone        text := NULLIF(btrim(COALESCE(p_parent_phone, '')), '');
BEGIN
  SELECT cp.club_id INTO v_club_id
    FROM public.club_pages cp
   WHERE cp.slug = p_slug AND COALESCE(cp.published, false) = true;
  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF length(v_name) = 0 THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_email) = 0 OR position('@' IN v_email) = 0 OR length(v_email) > 160 THEN
    RAISE EXCEPTION 'bad_email' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_name) > 120
     OR (v_phone IS NOT NULL AND length(v_phone) > 40)
     OR (v_child IS NOT NULL AND length(v_child) > 120) THEN
    RAISE EXCEPTION 'input_too_long' USING ERRCODE = 'P0001';
  END IF;
  IF p_child_dob IS NOT NULL
     AND (p_child_dob > current_date OR p_child_dob < current_date - INTERVAL '25 years') THEN
    RAISE EXCEPTION 'bad_dob' USING ERRCODE = 'P0001';
  END IF;

  IF p_child_dob IS NOT NULL THEN
    v_school_year := public._school_year_for_dob(p_child_dob, current_date)::smallint;
  END IF;

  SELECT count(*) INTO v_recent_email
    FROM public.club_leads
   WHERE club_id = v_club_id
     AND lower(parent_email) = lower(v_email)
     AND created_at > now() - INTERVAL '10 minutes';
  IF v_recent_email >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_requests');
  END IF;

  INSERT INTO public.club_leads
    (club_id, parent_name, parent_email, parent_phone, child_first_name, child_school_year, source)
  VALUES
    (v_club_id, v_name, v_email, v_phone, v_child, v_school_year, 'public_trial')
  RETURNING id INTO v_lead_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES
    (v_club_id, NULL, 'system', 'public_trial', 'club_lead_captured', 'club_lead', v_lead_id::text,
     jsonb_build_object('slug', p_slug, 'email', v_email, 'has_child_details', v_child IS NOT NULL));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_capture_lead(text, text, text, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_capture_lead(text, text, text, text, text, date)
  TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
