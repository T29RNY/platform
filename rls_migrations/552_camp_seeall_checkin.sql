-- 552: (D1) coach sees ALL camps (venue-wide 'all' + team-targeted) + marks attendance;
--      (D2) operator/club-admin mark attendance from the /hub roster.
--
-- Today the coach roster (club_manager_get_team_camps) shows only target_team camps, no
-- attendance is markable from any /hub roster (desktop check-in is a QR scanner), and neither
-- roster carries booking_id/checked_in_at. This:
--   • extends club_manager_get_team_camps → include audience='all' camps at the team's club's
--     venue(s) (via club_venues) + roster gains booking_id + checked_in_at + member_profile_id
--   • extends venue_get_class_session_detail → attendees gain checked_in_at
--   • NEW venue_class_mark_attended(venue_token, booking_id, attended) — venue-token check-in by
--     booking_id (manage_facility), toggles checked_in_at on a CONFIRMED booking, audited
--   • NEW club_manager_mark_camp_attended(team_id, booking_id, attended) — coach-auth check-in;
--     verifies the booking's camp is in the coach's scope (target_team OR audience='all' at the
--     team's venue) so a coach can't check in a booking for a camp not theirs. Audited.
-- Attendance = checked_in_at IS NOT NULL (mirrors the QR venue_class_checkin write); no charge/
-- status change.
--
-- ⚠ SCOPE NOTE (operator decision 2026-07-11): a coach now sees the FULL roster of an
-- audience='all' venue-wide camp (names/ages/payment_status) and can toggle attendance on it, so
-- they can run whole-camp check-in. Deliberate per "coaches need to see all and mark attended".
-- BLAST RADIUS — venue-scoped, NOT club-scoped: an audience='all' camp has NO club owner
-- (venue_class_types has venue_id + audience only; no club_id, and target_team_id IS NULL for
-- 'all' camps), so it is a VENUE-level open camp by design. Where a venue is shared by ≥2 clubs
-- (club_venues is many-to-many), a coach at that venue sees + can check in children from the OTHER
-- club on that camp. This is DELIBERATE and CONSISTENT with the already-shipped guardian model
-- (mig 536/429: guardian all-audience visibility is likewise venue-scoped — a guardian at a shared
-- venue already sees the other club's 'all' camps). Making the coach club-scoped would DESYNC coach
-- from guardian. The write is audit-logged + reversible + no money/status — at an open shared-venue
-- camp, any present club's staff registering attendance is the intended real-world behaviour.
--
-- Consumers (Hard Rule #14): apps/inorout TeamManagerCamps.jsx (coach) + VenueClassRosterView.jsx
-- (club-admin + operator /hub).

-- ── D1 reader: coach camps see-all + roster booking_id/checked_in_at ──
CREATE OR REPLACE FUNCTION public.club_manager_get_team_camps(p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_profile uuid; v_team_name text; v_camps jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_team_managers WHERE team_id = p_team_id AND member_profile_id = v_profile AND is_active = true)
  THEN RAISE EXCEPTION 'not_manager' USING ERRCODE='P0001'; END IF;
  SELECT name INTO v_team_name FROM public.club_teams WHERE id = p_team_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id',    s.id,
    'class_name',    ct.name,
    'starts_at',     s.starts_at,
    'end_date',      s.end_date,
    'is_camp',       COALESCE(ct.is_camp, false),
    'booking_mode',  ct.booking_mode,
    'audience',      ct.audience,
    'capacity',      s.capacity,
    'status',        s.status,
    'price_pence',   s.price_pence,
    'booked_count',  (SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = s.id AND b.status = 'confirmed'),
    'waitlist_count',(SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = s.id AND b.status = 'waitlist'),
    'roster',        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'booking_id',        b.id,
                         'member_profile_id', b.member_profile_id,
                         'member_name',       NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), ''),
                         'age',               CASE WHEN mp.dob IS NOT NULL THEN date_part('year', age(mp.dob))::int ELSE NULL END,
                         'status',            b.status,
                         'payment_status',    b.payment_status,
                         'checked_in_at',     b.checked_in_at,
                         'waitlist_position', b.waitlist_position
                       ) ORDER BY (b.status <> 'confirmed'), b.waitlist_position NULLS FIRST, mp.first_name), '[]'::jsonb)
                     FROM public.venue_class_bookings b
                     JOIN public.member_profiles mp ON mp.id = b.member_profile_id
                     WHERE b.session_id = s.id AND b.status IN ('confirmed','waitlist'))
  ) ORDER BY s.starts_at), '[]'::jsonb)
  INTO v_camps
  FROM public.venue_class_sessions s
  JOIN public.venue_class_types ct ON ct.id = s.class_type_id
  WHERE s.status = 'scheduled'
    AND s.starts_at >= now() - interval '1 day'
    AND (
      ct.target_team_id = p_team_id
      OR (ct.audience = 'all' AND s.venue_id IN (
            SELECT cv.venue_id FROM public.club_venues cv
            JOIN public.club_teams ct2 ON ct2.club_id = cv.club_id
            WHERE ct2.id = p_team_id))
    );

  RETURN jsonb_build_object('ok', true, 'team_id', p_team_id, 'team_name', v_team_name, 'camps', v_camps);
END;
$function$;

-- ── D2 reader: session detail attendees gain checked_in_at ──
CREATE OR REPLACE FUNCTION public.venue_get_class_session_detail(p_venue_token text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
               'checked_in_at', b.checked_in_at,
               'waitlist_position', b.waitlist_position)
               ORDER BY b.status, mp.dob DESC NULLS LAST, b.booked_at), '[]'::jsonb)
        FROM public.venue_class_bookings b
        JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE b.session_id = %L
    $q$, p_session_id) INTO v_attendees;
  END IF;
  RETURN to_jsonb(v_sess) || jsonb_build_object('attendees', v_attendees);
END;
$function$;

-- ── D2 write: venue-token manual check-in by booking_id ──
CREATE OR REPLACE FUNCTION public.venue_class_mark_attended(p_venue_token text, p_booking_id uuid, p_attended boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_bk record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  SELECT b.id, b.status, b.member_profile_id, s.venue_id INTO v_bk
  FROM public.venue_class_bookings b JOIN public.venue_class_sessions s ON s.id = b.session_id
  WHERE b.id = p_booking_id;
  IF v_bk.id IS NULL OR v_bk.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE='P0001'; END IF;
  IF v_bk.status <> 'confirmed' THEN RAISE EXCEPTION 'not_confirmed' USING ERRCODE='P0001'; END IF;

  UPDATE public.venue_class_bookings SET checked_in_at = CASE WHEN p_attended THEN now() ELSE NULL END WHERE id = p_booking_id;

  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'class_attendance_marked', 'venue_class_booking', p_booking_id::text,
          jsonb_build_object('attended', p_attended, 'member_profile_id', v_bk.member_profile_id));

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'attended', p_attended);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_class_mark_attended(text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_class_mark_attended(text, uuid, boolean) TO anon, authenticated;

-- ── D1 write: coach-auth check-in (scope-verified) ──
CREATE OR REPLACE FUNCTION public.club_manager_mark_camp_attended(p_team_id uuid, p_booking_id uuid, p_attended boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_profile uuid; v_bk record; v_in_scope boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_team_managers WHERE team_id = p_team_id AND member_profile_id = v_profile AND is_active = true)
  THEN RAISE EXCEPTION 'not_manager' USING ERRCODE='P0001'; END IF;

  SELECT b.id, b.status, b.member_profile_id, s.venue_id, ct.target_team_id, ct.audience INTO v_bk
  FROM public.venue_class_bookings b
  JOIN public.venue_class_sessions s ON s.id = b.session_id
  JOIN public.venue_class_types ct ON ct.id = s.class_type_id
  WHERE b.id = p_booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE='P0001'; END IF;

  -- The camp must be in this coach's scope (same predicate as the see-all reader).
  v_in_scope := (v_bk.target_team_id = p_team_id)
             OR (v_bk.audience = 'all' AND v_bk.venue_id IN (
                   SELECT cv.venue_id FROM public.club_venues cv
                   JOIN public.club_teams ct2 ON ct2.club_id = cv.club_id WHERE ct2.id = p_team_id));
  IF NOT v_in_scope THEN RAISE EXCEPTION 'not_in_scope' USING ERRCODE='P0001'; END IF;
  IF v_bk.status <> 'confirmed' THEN RAISE EXCEPTION 'not_confirmed' USING ERRCODE='P0001'; END IF;

  UPDATE public.venue_class_bookings SET checked_in_at = CASE WHEN p_attended THEN now() ELSE NULL END WHERE id = p_booking_id;

  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_bk.venue_id, v_uid, 'player', 'class_attendance_marked', 'venue_class_booking', p_booking_id::text,
          jsonb_build_object('attended', p_attended, 'by_team', p_team_id, 'member_profile_id', v_bk.member_profile_id));

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'attended', p_attended);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_manager_mark_camp_attended(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_mark_camp_attended(uuid, uuid, boolean) TO authenticated;
