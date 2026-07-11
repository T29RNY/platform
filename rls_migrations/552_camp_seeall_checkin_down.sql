-- 552 DOWN: drop the two check-in RPCs + restore the two readers to their pre-552 bodies
-- (coach reader target_team-only, no roster booking_id/checked_in_at; session detail no checked_in_at).

DROP FUNCTION IF EXISTS public.venue_class_mark_attended(text, uuid, boolean);
DROP FUNCTION IF EXISTS public.club_manager_mark_camp_attended(uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.club_manager_get_team_camps(p_team_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_profile uuid; v_team_name text; v_camps jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_team_managers WHERE team_id = p_team_id AND member_profile_id = v_profile AND is_active = true)
  THEN RAISE EXCEPTION 'not_manager' USING ERRCODE='P0001'; END IF;
  SELECT name INTO v_team_name FROM public.club_teams WHERE id = p_team_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', s.id, 'class_name', ct.name, 'starts_at', s.starts_at, 'end_date', s.end_date,
    'is_camp', COALESCE(ct.is_camp, false), 'booking_mode', ct.booking_mode, 'capacity', s.capacity,
    'status', s.status, 'price_pence', s.price_pence,
    'booked_count',  (SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = s.id AND b.status = 'confirmed'),
    'waitlist_count',(SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = s.id AND b.status = 'waitlist'),
    'roster', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'member_name', NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), ''),
                 'age', CASE WHEN mp.dob IS NOT NULL THEN date_part('year', age(mp.dob))::int ELSE NULL END,
                 'status', b.status, 'payment_status', b.payment_status, 'waitlist_position', b.waitlist_position
               ) ORDER BY (b.status <> 'confirmed'), b.waitlist_position NULLS FIRST, mp.first_name), '[]'::jsonb)
             FROM public.venue_class_bookings b JOIN public.member_profiles mp ON mp.id = b.member_profile_id
             WHERE b.session_id = s.id AND b.status IN ('confirmed','waitlist'))
  ) ORDER BY s.starts_at), '[]'::jsonb)
  INTO v_camps
  FROM public.venue_class_sessions s JOIN public.venue_class_types ct ON ct.id = s.class_type_id
  WHERE ct.target_team_id = p_team_id AND s.status = 'scheduled' AND s.starts_at >= now() - interval '1 day';
  RETURN jsonb_build_object('ok', true, 'team_id', p_team_id, 'team_name', v_team_name, 'camps', v_camps);
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_get_class_session_detail(p_venue_token text, p_session_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_sess record; v_attendees jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
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
               'dob', mp.dob,
               'age', CASE WHEN mp.dob IS NOT NULL THEN date_part('year', age(mp.dob))::int ELSE NULL END,
               'status', b.status, 'payment_status', b.payment_status,
               'waitlist_position', b.waitlist_position)
               ORDER BY b.status, mp.dob DESC NULLS LAST, b.booked_at), '[]'::jsonb)
        FROM public.venue_class_bookings b JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE b.session_id = %L
    $q$, p_session_id) INTO v_attendees;
  END IF;
  RETURN to_jsonb(v_sess) || jsonb_build_object('attendees', v_attendees);
END;
$function$;
