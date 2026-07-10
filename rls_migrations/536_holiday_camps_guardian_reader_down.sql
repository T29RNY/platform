-- 536_holiday_camps_guardian_reader_down.sql — restore the pre-536 (mig 429) reader:
-- no camp fields, venue-scoped only (no audience filter).

CREATE OR REPLACE FUNCTION public.guardian_list_child_class_options(p_child_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid            uuid := auth.uid();
  v_caller_profile uuid;
  v_options        jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_caller_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001';
  END IF;

  IF p_child_profile_id <> v_caller_profile AND NOT EXISTS (
    SELECT 1 FROM public.member_guardians
    WHERE guardian_profile_id = v_caller_profile
      AND child_profile_id    = p_child_profile_id
      AND invite_state        = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001';
  END IF;

  WITH child_venues AS (
    SELECT DISTINCT cl.venue_id
    FROM public.club_team_members ctm
    JOIN public.club_teams ct ON ct.id = ctm.team_id
    JOIN public.club_leagues cl ON cl.club_id = ct.club_id AND cl.archived_at IS NULL
    WHERE ctm.member_profile_id = p_child_profile_id
      AND ctm.is_active = true
      AND cl.venue_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id',   s.id,
    'venue_id',     s.venue_id,
    'class_name',   ctp.name,
    'starts_at',    s.starts_at,
    'price_pence',  s.price_pence,
    'payment_mode', s.payment_mode,
    'members_only', COALESCE(ctp.members_only, true),
    'capacity',     s.capacity,
    'spots_left',   GREATEST(s.capacity - (
                      SELECT count(*) FROM public.venue_class_bookings b
                      WHERE b.session_id = s.id
                        AND (b.status = 'confirmed'
                             OR (b.status = 'offered' AND b.offer_expires_at > now()))
                    ), 0),
    'already_booked', EXISTS (
                      SELECT 1 FROM public.venue_class_bookings b
                      WHERE b.session_id = s.id
                        AND b.member_profile_id = p_child_profile_id
                        AND b.status IN ('confirmed','waitlist','offered'))
  ) ORDER BY s.starts_at), '[]'::jsonb)
  INTO v_options
  FROM public.venue_class_sessions s
  JOIN public.venue_class_types ctp ON ctp.id = s.class_type_id
  WHERE s.venue_id IN (SELECT venue_id FROM child_venues)
    AND s.status = 'scheduled'
    AND s.starts_at > now()
    AND COALESCE(ctp.is_active, true) = true;

  RETURN jsonb_build_object('ok', true, 'child_profile_id', p_child_profile_id,
                            'options', COALESCE(v_options, '[]'::jsonb));
END;
$function$;
