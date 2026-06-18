-- DOWN 362: restore the mig 360-era attendee shape (no dob/age; ordered by
-- status, booked_at). Reverts venue_get_class_session_detail to the prior body.
CREATE OR REPLACE FUNCTION public.venue_get_class_session_detail(p_venue_token text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_sess record; v_attendees jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT cs.id, cs.venue_id, cs.class_type_id, ct.name AS class_name, ct.category,
         cs.series_id, cs.space_id, sp.name AS space_name, cs.instructor_id, va.email AS instructor_email,
         cs.starts_at, cs.ends_at, cs.capacity, cs.status, cs.price_pence, cs.payment_mode,
         cs.cancellation_reason, cs.completed_at
    INTO v_sess
  FROM public.venue_class_sessions cs
  JOIN public.venue_class_types ct ON ct.id = cs.class_type_id
  JOIN public.venue_spaces sp ON sp.id = cs.space_id
  LEFT JOIN public.venue_admins va ON va.id = cs.instructor_id
  WHERE cs.id = p_session_id AND cs.venue_id = v_caller.venue_id;
  IF v_sess.id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF to_regclass('public.venue_class_bookings') IS NOT NULL THEN
    EXECUTE format($q$
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'booking_id', b.id, 'member_profile_id', b.member_profile_id,
               'member_name', btrim(coalesce(mp.first_name,'') || ' ' || coalesce(mp.last_name,'')),
               'status', b.status, 'payment_status', b.payment_status,
               'waitlist_position', b.waitlist_position) ORDER BY b.status, b.booked_at), '[]'::jsonb)
        FROM public.venue_class_bookings b
        JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE b.session_id = %L
    $q$, p_session_id) INTO v_attendees;
  END IF;
  RETURN to_jsonb(v_sess) || jsonb_build_object('attendees', v_attendees);
END;
$function$;
