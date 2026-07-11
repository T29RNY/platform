-- 544_coach_camp_roster.sql — camp-booking SYNC to the coach /hub (on-device walk).
-- Guardians book children into camp/class sessions (venue_class_bookings); the DESKTOP operator
-- + club-admin already see the roster via venue_get_class_session_detail (venue-token auth). The
-- COACH (team_manager) had NO way to see who's booked into their team's camp — the coach session
-- board (mig 528) only reads club_sessions (training/fixtures), never venue_class_bookings.
--
-- club_manager_get_team_camps(team_id): coach-authed (auth.uid → club_team_managers, active) reader
-- returning the team's upcoming camp/class sessions, each with its booked ROSTER embedded. Same
-- attendee CONTRACT as the desktop (member_name / age / status / payment_status / waitlist_position)
-- so the two surfaces genuinely sync. Scope = camps TARGETED at this team (class_types.target_team_id
-- = team) — venue-wide (audience='all') camps stay operator/club-admin territory. READ-ONLY.

CREATE OR REPLACE FUNCTION public.club_manager_get_team_camps(p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   uuid;
  v_team_name text;
  v_camps     jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile AND is_active = true
  ) THEN RAISE EXCEPTION 'not_manager' USING ERRCODE='P0001'; END IF;

  SELECT name INTO v_team_name FROM public.club_teams WHERE id = p_team_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id',    s.id,
    'class_name',    ct.name,
    'starts_at',     s.starts_at,
    'end_date',      s.end_date,
    'is_camp',       COALESCE(ct.is_camp, false),
    'booking_mode',  ct.booking_mode,
    'capacity',      s.capacity,
    'status',        s.status,
    'price_pence',   s.price_pence,
    'booked_count',  (SELECT count(*) FROM public.venue_class_bookings b
                       WHERE b.session_id = s.id AND b.status = 'confirmed'),
    'waitlist_count',(SELECT count(*) FROM public.venue_class_bookings b
                       WHERE b.session_id = s.id AND b.status = 'waitlist'),
    'roster',        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'member_name',       NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), ''),
                         'age',               CASE WHEN mp.dob IS NOT NULL THEN date_part('year', age(mp.dob))::int ELSE NULL END,
                         'status',            b.status,
                         'payment_status',    b.payment_status,
                         'waitlist_position', b.waitlist_position
                       ) ORDER BY (b.status <> 'confirmed'), b.waitlist_position NULLS FIRST, mp.first_name), '[]'::jsonb)
                     FROM public.venue_class_bookings b
                     JOIN public.member_profiles mp ON mp.id = b.member_profile_id
                     WHERE b.session_id = s.id AND b.status IN ('confirmed','waitlist'))
  ) ORDER BY s.starts_at), '[]'::jsonb)
  INTO v_camps
  FROM public.venue_class_sessions s
  JOIN public.venue_class_types ct ON ct.id = s.class_type_id
  WHERE ct.target_team_id = p_team_id
    AND s.status = 'scheduled'
    AND s.starts_at >= now() - interval '1 day';

  RETURN jsonb_build_object('ok', true, 'team_id', p_team_id, 'team_name', v_team_name, 'camps', v_camps);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_manager_get_team_camps(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_get_team_camps(uuid) TO authenticated;
