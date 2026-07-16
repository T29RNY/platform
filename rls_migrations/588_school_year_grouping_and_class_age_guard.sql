-- 588: group children by SCHOOL YEAR, and refuse a booking outside a class's band.
--
-- ─── WHY THIS SUPERSEDES MIG 580's DELIBERATE CHOICE ────────────────────────
-- 580's header explicitly rejected an "age as of 31 Aug" cutoff, on the stated
-- grounds that "DF's coaching side is mixed-age single sessions (Decision #2)"
-- so current-age placement was the right fit. The mixed-age half of that is still
-- true — DF runs ONE open session per slot (Club Training, Wed 5:30-6:30) that
-- coaches split by age on the day. What changed (operator, 2026-07-16) is that the
-- groups they split into are SCHOOL YEARS (Year 2 to Year 6), and Danny needs each
-- child's year group to keep those groups balanced. So the cutoff infrastructure
-- 580 deferred is now load-bearing, and this migration adds it.
--
-- ─── THE BUG, REPRODUCED ────────────────────────────────────────────────────
-- date_part('year', age(dob)) is completed years TODAY, which is not school year.
-- Two children in the SAME school year get different groups purely by birthday:
--   dob 2018-09-09 → age 7 today → Under 8s   ┐ both are school Year 2
--   dob 2019-08-20 → age 6 today → Under 6s   ┘
-- and the younger silently jumps U6→U8 on 20 Aug, mid-season. A register split on
-- age-today is therefore wrong on any day of the year, which is exactly the signal
-- Danny is meant to balance against.
--
-- ─── THE RULE ───────────────────────────────────────────────────────────────
-- English/Welsh school year is fixed by age on 31 Aug preceding the academic year
-- (Reception = 4 → year 0, Y1 = 5, Y2 = 6 …). It does not move on a birthday. This
-- is also the FA's age-group anchor, so it is the right primitive for youth sport.
-- _school_year_for_dob(dob, ref) implements it; ref defaults to today so the answer
-- rolls up automatically every 1 September.
--
-- ─── SHIPS DARK ─────────────────────────────────────────────────────────────
-- Every new column is NULLABLE and every rule is "enforce ONLY when set". No cohort
-- has a school year and no class type has a band until the DF data migration (589),
-- so _cohort_for_dob returns exactly what it returns today and NO booking changes
-- behaviour for any venue, gym or club.
--
-- ─── CONSUMERS (Hard Rule 14) ───────────────────────────────────────────────
-- _school_year_for_dob   → 589 (DF cohorts), the coach register age-spread view,
--                          PR #6 public trial flow (shows the parent their child's
--                          year group), superadmin_import_club_roster (via
--                          _cohort_for_dob).
-- _class_age_eligibility → member_book_class_session, guardian_book_class_session
--                          (both below), and PR #6's trial booking.

-- ── 1. the cutoff rule ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._school_year_for_dob(p_dob date, p_ref date DEFAULT current_date)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  -- Academic year runs 1 Sep → 31 Aug. The anchor is the 31 Aug BEFORE the current
  -- academic year: on/after 1 Sep it is this calendar year's, otherwise last's.
  -- Reception (age 4 at the anchor) = year 0, so subtract 4.
  -- A child born after the anchor yields a negative year — correctly matching no
  -- school-year band rather than erroring.
  SELECT CASE WHEN p_dob IS NULL THEN NULL ELSE
    date_part('year', age(
      make_date(
        CASE WHEN extract(month FROM p_ref) >= 9
             THEN extract(year FROM p_ref)::int
             ELSE extract(year FROM p_ref)::int - 1
        END, 8, 31),
      p_dob
    ))::int - 4
  END;
$function$;

REVOKE ALL ON FUNCTION public._school_year_for_dob(date, date) FROM PUBLIC, anon, authenticated;

-- ── 2. cohorts can be defined by school year, not just age ───────────────────
-- Kept alongside min_age/max_age rather than replacing them: boxing, gym and adult
-- classes genuinely group by age, and PA Sports' open "Mens" cohort has no band at
-- all. A cohort uses whichever pair is populated.
ALTER TABLE public.club_cohorts ADD COLUMN IF NOT EXISTS school_year_min int;
ALTER TABLE public.club_cohorts ADD COLUMN IF NOT EXISTS school_year_max int;

COMMENT ON COLUMN public.club_cohorts.school_year_min IS
  'Lowest school year in this cohort (Reception=0, Y1=1...). NULL = open-ended. When either school_year bound is set, school year (31 Aug cutoff) is used INSTEAD of min_age/max_age.';
COMMENT ON COLUMN public.club_cohorts.school_year_max IS
  'Highest school year in this cohort. NULL = open-ended.';

-- ── 3. a class type can carry an eligibility band ────────────────────────────
-- This is the "#7" guard's data. NOT a cohort_id: DF's ONE session is open to five
-- year groups at once, so a single cohort link cannot express it. The band lives on
-- the class; the cohort stays a per-child LABEL for the register.
ALTER TABLE public.venue_class_types ADD COLUMN IF NOT EXISTS school_year_min int;
ALTER TABLE public.venue_class_types ADD COLUMN IF NOT EXISTS school_year_max int;
ALTER TABLE public.venue_class_types ADD COLUMN IF NOT EXISTS min_age int;
ALTER TABLE public.venue_class_types ADD COLUMN IF NOT EXISTS max_age int;

COMMENT ON COLUMN public.venue_class_types.school_year_min IS
  'Youngest school year allowed (Reception=0). NULL = no lower bound. Takes precedence over min_age/max_age. All four NULL = no age check at all.';
COMMENT ON COLUMN public.venue_class_types.min_age IS
  'Youngest age (completed years, today) allowed. For venues that group by age rather than school year. Ignored when a school_year bound is set.';

ALTER TABLE public.venue_class_types DROP CONSTRAINT IF EXISTS venue_class_types_year_band_ck;
ALTER TABLE public.venue_class_types ADD CONSTRAINT venue_class_types_year_band_ck
  CHECK (school_year_min IS NULL OR school_year_max IS NULL OR school_year_min <= school_year_max);
ALTER TABLE public.venue_class_types DROP CONSTRAINT IF EXISTS venue_class_types_age_band_ck;
ALTER TABLE public.venue_class_types ADD CONSTRAINT venue_class_types_age_band_ck
  CHECK (min_age IS NULL OR max_age IS NULL OR min_age <= max_age);

ALTER TABLE public.club_cohorts DROP CONSTRAINT IF EXISTS club_cohorts_year_band_ck;
ALTER TABLE public.club_cohorts ADD CONSTRAINT club_cohorts_year_band_ck
  CHECK (school_year_min IS NULL OR school_year_max IS NULL OR school_year_min <= school_year_max);

-- ── 4. _cohort_for_dob: prefer school-year cohorts when the club has them ────
-- Backward compatible by construction: a club with no school_year cohorts takes the
-- identical age-band path 580 shipped. Only a club that opts in (589) changes.
CREATE OR REPLACE FUNCTION public._cohort_for_dob(p_club_id text, p_dob date)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH candidate AS (
    SELECT c.id, c.min_age, c.max_age, c.school_year_min, c.school_year_max, c.created_at,
           (c.school_year_min IS NOT NULL OR c.school_year_max IS NOT NULL) AS is_year_based
    FROM public.club_cohorts c
    WHERE c.club_id = p_club_id
      AND c.active = true
      AND p_dob IS NOT NULL
  )
  SELECT id FROM (
    -- school-year cohorts (preferred: exact, immune to birthday drift)
    SELECT id,
           0 AS tier,
           (COALESCE(school_year_max, 50) - COALESCE(school_year_min, -5)) AS width,
           school_year_min AS lo,
           created_at
    FROM candidate
    WHERE is_year_based
      AND (school_year_min IS NULL OR public._school_year_for_dob(p_dob) >= school_year_min)
      AND (school_year_max IS NULL OR public._school_year_for_dob(p_dob) <= school_year_max)

    UNION ALL

    -- age-band cohorts (580's behaviour, unchanged). Fully-open catch-alls (a
    -- "Mens" group with no band) stay EXCLUDED — they carry no band to match on.
    SELECT id,
           1 AS tier,
           (COALESCE(max_age, 200) - COALESCE(min_age, 0)) AS width,
           min_age AS lo,
           created_at
    FROM candidate
    WHERE NOT is_year_based
      AND NOT (min_age IS NULL AND max_age IS NULL)
      AND (min_age IS NULL OR date_part('year', age(p_dob))::int >= min_age)
      AND (max_age IS NULL OR date_part('year', age(p_dob))::int <= max_age)
  ) m
  -- school-year match wins outright; then narrowest band, lowest bound, oldest.
  ORDER BY tier ASC, width ASC, lo ASC NULLS LAST, created_at ASC, id ASC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public._cohort_for_dob(text, date) FROM PUBLIC, anon, authenticated;

-- ── 5. the eligibility check ─────────────────────────────────────────────────
-- Returns NULL when the child may book (including when no rule is set), else a
-- reason code. A NULL dob NEVER rejects — the mig-584 coach_must_be_16 precedent:
-- only a KNOWN out-of-band dob is refused, an unknown one is allowed through.
CREATE OR REPLACE FUNCTION public._class_age_eligibility(p_class_type_id uuid, p_dob date)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  ct     public.venue_class_types;
  v_year int;
  v_age  int;
BEGIN
  SELECT * INTO ct FROM public.venue_class_types WHERE id = p_class_type_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_dob IS NULL THEN RETURN NULL; END IF;

  IF ct.school_year_min IS NOT NULL OR ct.school_year_max IS NOT NULL THEN
    v_year := public._school_year_for_dob(p_dob);
    IF ct.school_year_min IS NOT NULL AND v_year < ct.school_year_min THEN RETURN 'too_young_for_class'; END IF;
    IF ct.school_year_max IS NOT NULL AND v_year > ct.school_year_max THEN RETURN 'too_old_for_class';  END IF;
    RETURN NULL;
  END IF;

  IF ct.min_age IS NOT NULL OR ct.max_age IS NOT NULL THEN
    v_age := date_part('year', age(p_dob))::int;
    IF ct.min_age IS NOT NULL AND v_age < ct.min_age THEN RETURN 'too_young_for_class'; END IF;
    IF ct.max_age IS NOT NULL AND v_age > ct.max_age THEN RETURN 'too_old_for_class';  END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;  -- no band set → no check
END;
$function$;

REVOKE ALL ON FUNCTION public._class_age_eligibility(uuid, date) FROM PUBLIC, anon, authenticated;

-- ── 6. enforce it in BOTH live booking RPCs ──────────────────────────────────
-- NB: member_book_class_session is defined by mig 340 in the source tree, but 340's
-- version was SUPERSEDED (341 → 360 → 399). The live definer is
-- 399_modular_feature_flags.sql:2704 — patching 340 would be a silent no-op. Both
-- bodies below were pulled from the LIVE DB with pg_get_functiondef and are byte-
-- identical except for the guard. 429's guardian copy is a COPY, not a caller, so
-- it needs the same edit independently.
-- Placement: after the members_only/membership gate, before the no-show gate.

CREATE OR REPLACE FUNCTION public.member_book_class_session(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   public.member_profiles;
  v_sess      public.venue_class_sessions;
  v_members_only boolean;
  v_threshold int;
  v_occupied  int;
  v_existing  public.venue_class_bookings;
  v_status    text;
  v_wpos      int;
  v_booking_id uuid;
  v_connected boolean;
  v_elig      text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status <> 'scheduled' OR v_sess.starts_at <= now() THEN
    RAISE EXCEPTION 'session_not_bookable' USING ERRCODE='P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_sess.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  -- members_only lever (per class type; default true). An ACCOUNT is always required
  -- (enforced above); a paid MEMBERSHIP is required only when the type is members_only.
  SELECT members_only INTO v_members_only FROM public.venue_class_types WHERE id = v_sess.class_type_id;
  IF COALESCE(v_members_only, true) THEN
    IF NOT public._member_entitled_at_venue(v_profile.id, v_sess.venue_id) THEN
      RAISE EXCEPTION 'membership_required' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- age/school-year band (mig 588). No-op unless the class type carries a band.
  v_elig := public._class_age_eligibility(v_sess.class_type_id, v_profile.dob);
  IF v_elig IS NOT NULL THEN RAISE EXCEPTION '%', v_elig USING ERRCODE='P0001'; END IF;

  SELECT no_show_suspension_threshold INTO v_threshold FROM public.venues WHERE id = v_sess.venue_id;
  IF v_threshold IS NOT NULL AND v_profile.no_show_count >= v_threshold THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'suspended', 'no_show_count', v_profile.no_show_count);
  END IF;

  IF v_sess.payment_mode = 'prepay' THEN
    SELECT EXISTS (SELECT 1 FROM public.venue_integrations
                    WHERE venue_id = v_sess.venue_id AND provider = 'stripe' AND status = 'connected')
      INTO v_connected;
    IF NOT v_connected THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'payment_method_unavailable');
    END IF;
  END IF;

  SELECT * INTO v_existing FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_profile.id;
  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed','waitlist','offered') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_booked',
                              'booking_id', v_existing.id, 'status', v_existing.status);
  END IF;

  SELECT count(*) INTO v_occupied FROM public.venue_class_bookings
   WHERE session_id = p_session_id
     AND (status = 'confirmed'
          OR (status = 'offered' AND offer_expires_at > now()));
  IF v_sess.capacity > 0 AND v_occupied < v_sess.capacity THEN
    v_status := 'confirmed'; v_wpos := NULL;
  ELSE
    v_status := 'waitlist';
    SELECT COALESCE(max(waitlist_position), 0) + 1 INTO v_wpos
      FROM public.venue_class_bookings WHERE session_id = p_session_id AND status = 'waitlist';
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.venue_class_bookings
       SET status = v_status, waitlist_position = v_wpos, booked_at = now(),
           cancelled_at = NULL, offer_expires_at = NULL,
           payment_status = 'pending', payment_method = 'not_yet'
     WHERE id = v_existing.id
     RETURNING id INTO v_booking_id;
  ELSE
    INSERT INTO public.venue_class_bookings (session_id, member_profile_id, status, waitlist_position)
    VALUES (p_session_id, v_profile.id, v_status, v_wpos)
    RETURNING id INTO v_booking_id;
  END IF;

  IF v_status = 'confirmed' THEN
    PERFORM public._apply_class_booking_charge(v_booking_id);
  END IF;

  SELECT * INTO v_existing FROM public.venue_class_bookings WHERE id = v_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_sess.venue_id, v_uid, 'player', 'member_class_booked', 'venue_class_booking', v_booking_id::text,
          jsonb_build_object('session_id', p_session_id, 'status', v_status,
                             'member_profile_id', v_profile.id, 'waitlist_position', v_wpos));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', v_status,
                            'payment_status', v_existing.payment_status,
                            'payment_method', v_existing.payment_method,
                            'waitlist_position', v_wpos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guardian_book_class_session(p_session_id uuid, p_for_profile_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_caller       public.member_profiles;
  v_target       uuid;
  v_target_ns    int;
  v_target_dob   date;
  v_sess         public.venue_class_sessions;
  v_members_only boolean;
  v_threshold    int;
  v_occupied     int;
  v_existing     public.venue_class_bookings;
  v_status       text;
  v_wpos         int;
  v_booking_id   uuid;
  v_connected    boolean;
  v_charge_id    uuid;
  v_amount       int;
  v_manual_url   text;
  v_elig         text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_caller FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  IF p_for_profile_id IS NOT NULL AND p_for_profile_id <> v_caller.id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
      WHERE guardian_profile_id = v_caller.id
        AND child_profile_id    = p_for_profile_id
        AND invite_state        = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_target := p_for_profile_id;
  ELSE
    v_target := v_caller.id;
  END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status <> 'scheduled' OR v_sess.starts_at <= now() THEN
    RAISE EXCEPTION 'session_not_bookable' USING ERRCODE='P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_sess.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT members_only INTO v_members_only FROM public.venue_class_types WHERE id = v_sess.class_type_id;
  IF COALESCE(v_members_only, true) THEN
    IF NOT public._member_entitled_at_venue(v_target, v_sess.venue_id) THEN
      RAISE EXCEPTION 'membership_required' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- age/school-year band (mig 588) — checked against the CHILD (v_target), not the
  -- booking guardian. No-op unless the class type carries a band.
  SELECT dob INTO v_target_dob FROM public.member_profiles WHERE id = v_target;
  v_elig := public._class_age_eligibility(v_sess.class_type_id, v_target_dob);
  IF v_elig IS NOT NULL THEN RAISE EXCEPTION '%', v_elig USING ERRCODE='P0001'; END IF;

  SELECT no_show_suspension_threshold INTO v_threshold FROM public.venues WHERE id = v_sess.venue_id;
  SELECT no_show_count INTO v_target_ns FROM public.member_profiles WHERE id = v_target;
  IF v_threshold IS NOT NULL AND COALESCE(v_target_ns,0) >= v_threshold THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'suspended', 'no_show_count', v_target_ns);
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.venue_integrations
                  WHERE venue_id = v_sess.venue_id AND provider = 'stripe' AND status = 'connected')
    INTO v_connected;

  SELECT * INTO v_existing FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_target;
  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed','waitlist','offered') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_booked',
                              'booking_id', v_existing.id, 'status', v_existing.status);
  END IF;

  SELECT count(*) INTO v_occupied FROM public.venue_class_bookings
   WHERE session_id = p_session_id
     AND (status = 'confirmed'
          OR (status = 'offered' AND offer_expires_at > now()));
  IF v_sess.capacity > 0 AND v_occupied < v_sess.capacity THEN
    v_status := 'confirmed'; v_wpos := NULL;
  ELSE
    v_status := 'waitlist';
    SELECT COALESCE(max(waitlist_position), 0) + 1 INTO v_wpos
      FROM public.venue_class_bookings WHERE session_id = p_session_id AND status = 'waitlist';
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.venue_class_bookings
       SET status = v_status, waitlist_position = v_wpos, booked_at = now(),
           cancelled_at = NULL, offer_expires_at = NULL,
           payment_status = 'pending', payment_method = 'not_yet'
     WHERE id = v_existing.id
     RETURNING id INTO v_booking_id;
  ELSE
    INSERT INTO public.venue_class_bookings (session_id, member_profile_id, status, waitlist_position)
    VALUES (p_session_id, v_target, v_status, v_wpos)
    RETURNING id INTO v_booking_id;
  END IF;

  IF v_status = 'confirmed' THEN
    PERFORM public._apply_class_booking_charge(v_booking_id);
  END IF;

  SELECT * INTO v_existing FROM public.venue_class_bookings WHERE id = v_booking_id;

  SELECT id, amount_due_pence INTO v_charge_id, v_amount
    FROM public.venue_charges
   WHERE source_type = 'class' AND source_id = v_booking_id::text AND status <> 'refunded'
   ORDER BY created_at DESC LIMIT 1;
  SELECT payment_link INTO v_manual_url FROM public.venues WHERE id = v_sess.venue_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_sess.venue_id, v_uid, 'player', 'guardian_class_booked', 'venue_class_booking', v_booking_id::text,
          jsonb_build_object('session_id', p_session_id, 'status', v_status,
                             'member_profile_id', v_target,
                             'booked_by_profile_id', v_caller.id,
                             'for_child', (v_target <> v_caller.id),
                             'waitlist_position', v_wpos));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', v_status,
                            'payment_status', v_existing.payment_status,
                            'payment_method', v_existing.payment_method,
                            'waitlist_position', v_wpos,
                            'charge_id', v_charge_id,
                            'amount_pence', COALESCE(v_amount, 0),
                            'stripe_available', COALESCE(v_connected, false),
                            'manual_pay_url', v_manual_url);
END;
$function$;
