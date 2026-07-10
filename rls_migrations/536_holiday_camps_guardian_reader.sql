-- 536_holiday_camps_guardian_reader.sql — P9.3a Holiday Camps: guardian reader + cohort filter.
--
-- Extends guardian_list_child_class_options (mig 429) to:
--   1. expose the camp fields on each option (is_camp, booking_mode, end_date + camp detail),
--      so the guardian Sessions "Camps & extras" sheet (P9.3b) can render them;
--   2. apply the AUDIENCE / COHORT filter — the key behaviour change:
--        • audience='all'  → venue-scoped, exactly as before (every existing class + all-audience
--          camp shows to a guardian whose child plays at that venue);
--        • audience='team' → gated PURELY on the child being an ACTIVE member of target_team_id
--          (venue-agnostic — a team camp follows the team, not the league venue). FAIL-CLOSED:
--          a team camp with target_team_id=NULL (its team was deleted → FK SET NULL) matches no
--          child and is hidden (P9.2 security-review requirement).
--
-- Additive to the return shape (new keys only; existing consumers read the same keys unchanged).
-- No existing (audience='all', default) class type changes visibility. CREATE OR REPLACE keeps the
-- signature + grants. STABLE SECURITY DEFINER, search_path pinned — unchanged.

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
                        AND b.status IN ('confirmed','waitlist','offered')),
    -- Holiday Camps (mig 534/535/536, P9.3):
    'is_camp',          COALESCE(ctp.is_camp, false),
    'booking_mode',     ctp.booking_mode,
    'end_date',         s.end_date,
    'camp_info',        ctp.camp_info,
    'camp_dietary',     ctp.camp_dietary,
    'pickup_time',      ctp.pickup_time,
    'dropoff_time',     ctp.dropoff_time,
    'pickup_location',  ctp.pickup_location,
    'dropoff_location', ctp.dropoff_location
  ) ORDER BY s.starts_at), '[]'::jsonb)
  INTO v_options
  FROM public.venue_class_sessions s
  JOIN public.venue_class_types ctp ON ctp.id = s.class_type_id
  WHERE s.status = 'scheduled'
    AND s.starts_at > now()
    AND COALESCE(ctp.is_active, true) = true
    AND (
      -- all-audience: venue-scoped (unchanged from mig 429 — every existing class hits this arm)
      (ctp.audience = 'all' AND s.venue_id IN (SELECT venue_id FROM child_venues))
      OR
      -- team-audience camp: gated on the child's ACTIVE membership of the target team, venue-agnostic.
      -- target_team_id=NULL (deleted team) matches no child → fail-closed / hidden.
      (ctp.audience = 'team' AND EXISTS (
        SELECT 1 FROM public.club_team_members ctm2
        WHERE ctm2.team_id           = ctp.target_team_id
          AND ctm2.member_profile_id = p_child_profile_id
          AND ctm2.is_active         = true))
    );

  RETURN jsonb_build_object('ok', true, 'child_profile_id', p_child_profile_id,
                            'options', COALESCE(v_options, '[]'::jsonb));
END;
$function$;
