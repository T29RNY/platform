-- 580_cohort_for_dob.sql
--
-- DF Sports Onboarding — PR #3, the DOB→cohort placer.
--
-- _cohort_for_dob(p_club_id, p_dob) returns the id of the club_cohort whose age
-- band best contains the child's age, or NULL when no bounded band fits. It is
-- the auto-placement primitive the single-club member/child import (PR #4) uses
-- to drop a pasted roster into the right age group, and is reusable by the public
-- enrol/trial flow (PR #6, DOB pre-suggests a cohort).
--
-- AGE SEMANTICS — completed years as of TODAY: date_part('year', age(p_dob)).
-- This matches the codebase's uniform convention (migs 362/445/448/449) and the
-- mig-362 class-session roster age this academy's session model was built on.
-- A child flips bands on their actual birthday (turns 8 today → the 8-band, not
-- the 7-band) — the "birthday-cutoff" correctness the scope calls for. It is
-- deliberately NOT an FA "age as of 31 Aug" school-year cutoff: no such cutoff
-- infrastructure exists in the schema, and adding a configurable season anchor is
-- a separate, larger change than this helper. DF's coaching side is mixed-age
-- single sessions (Decision #2), so current-age placement is the right fit.
--
-- BAND MATCHING over club_cohorts.min_age/max_age (both nullable integers):
--   * A cohort matches when (min_age IS NULL OR age >= min_age)
--     AND (max_age IS NULL OR age <= max_age) — NULL bounds are open-ended
--     (e.g. "[8, NULL]" = 8-and-up, "[NULL, 17]" = 17-and-under).
--   * Fully-open catch-all cohorts (min_age IS NULL AND max_age IS NULL — e.g. a
--     "Mens"/adult group, PA Sports mig 506) are EXCLUDED: they carry no age band,
--     so a child who matches only such a cohort returns NULL ("NULL when no band").
--   * When several BOUNDED bands overlap, the NARROWEST wins (most specific age
--     group), then lowest min_age, then oldest cohort — deterministic.
--   * Only active cohorts are considered. p_dob NULL → NULL.
--
-- SECURITY: internal helper, not client-callable. STABLE (reads club_cohorts +
-- depends on current_date via age()), SECURITY DEFINER + search_path pinned so it
-- reads the age bands regardless of the calling RPC's context. REVOKEd from
-- PUBLIC/anon/authenticated — only the SECURITY DEFINER RPCs that call it by name
-- (PR #4 import, PR #6 trial) reach it, in their own definer context.
-- Consumer (HR#14): DF Sports PR #4 single-club import + PR #6 public enrol/trial.

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
    -- exclude fully-open catch-all cohorts (no age band at all)
    AND NOT (c.min_age IS NULL AND c.max_age IS NULL)
    AND (c.min_age IS NULL OR date_part('year', age(p_dob))::int >= c.min_age)
    AND (c.max_age IS NULL OR date_part('year', age(p_dob))::int <= c.max_age)
  ORDER BY
    -- narrowest band first (most specific age group); open bounds treated as wide
    (COALESCE(c.max_age, 200) - COALESCE(c.min_age, 0)) ASC,
    c.min_age ASC NULLS LAST,
    c.created_at ASC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public._cohort_for_dob(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._cohort_for_dob(text, date) FROM anon;
REVOKE ALL ON FUNCTION public._cohort_for_dob(text, date) FROM authenticated;
