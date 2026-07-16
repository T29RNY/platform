-- 588 DOWN — remove school-year grouping and the class age guard.
--
-- ⚠️ ORDER MATTERS: the booking RPCs must be reverted to their pre-588 bodies
-- BEFORE _class_age_eligibility is dropped, or every class booking at every venue
-- raises "function does not exist". Reverting means restoring the LIVE pre-588
-- definitions — mig 399:2704 (member) and mig 429:232 (guardian), NOT mig 340,
-- whose version was already superseded.
--
-- ⚠️ Run 589_down FIRST if it has been applied: it populates the columns this
-- drops, and DF's cohorts depend on school_year_min/max.

-- 1. restore the pre-588 booking RPCs (no age guard) ---------------------------
-- Re-apply the bodies from 399_modular_feature_flags.sql:2704 and
-- 429_guardian_membership_pay_and_classes.sql:232 verbatim. They are unchanged by
-- 588 except for the two _class_age_eligibility blocks and their v_elig /
-- v_target_dob declarations — delete those and the functions are byte-identical.

-- 2. then the helpers ---------------------------------------------------------
DROP FUNCTION IF EXISTS public._class_age_eligibility(uuid, date);

-- 3. restore 580's _cohort_for_dob (age bands only) ---------------------------
CREATE OR REPLACE FUNCTION public._cohort_for_dob(p_club_id text, p_dob date)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT c.id
  FROM public.club_cohorts c
  WHERE c.club_id = p_club_id
    AND c.active = true
    AND p_dob IS NOT NULL
    AND NOT (c.min_age IS NULL AND c.max_age IS NULL)
    AND (c.min_age IS NULL OR date_part('year', age(p_dob))::int >= c.min_age)
    AND (c.max_age IS NULL OR date_part('year', age(p_dob))::int <= c.max_age)
  ORDER BY
    (COALESCE(c.max_age, 200) - COALESCE(c.min_age, 0)) ASC,
    c.min_age ASC NULLS LAST,
    c.created_at ASC,
    c.id ASC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public._cohort_for_dob(text, date) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public._school_year_for_dob(date, date);

-- 4. columns + constraints ----------------------------------------------------
ALTER TABLE public.venue_class_types DROP CONSTRAINT IF EXISTS venue_class_types_year_band_ck;
ALTER TABLE public.venue_class_types DROP CONSTRAINT IF EXISTS venue_class_types_age_band_ck;
ALTER TABLE public.club_cohorts      DROP CONSTRAINT IF EXISTS club_cohorts_year_band_ck;

ALTER TABLE public.venue_class_types DROP COLUMN IF EXISTS school_year_min;
ALTER TABLE public.venue_class_types DROP COLUMN IF EXISTS school_year_max;
ALTER TABLE public.venue_class_types DROP COLUMN IF EXISTS min_age;
ALTER TABLE public.venue_class_types DROP COLUMN IF EXISTS max_age;
ALTER TABLE public.club_cohorts      DROP COLUMN IF EXISTS school_year_min;
ALTER TABLE public.club_cohorts      DROP COLUMN IF EXISTS school_year_max;
