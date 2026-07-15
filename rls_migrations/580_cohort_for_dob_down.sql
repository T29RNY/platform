-- 580_cohort_for_dob_down.sql
-- Reverses 580_cohort_for_dob.sql. Drops the helper only — no data touched.
-- Explicit signature so a future param-type change can't leave a stale overload.
DROP FUNCTION IF EXISTS public._cohort_for_dob(text, date);
