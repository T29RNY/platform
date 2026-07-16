-- 590_df_school_year_cohorts_and_reception_class_down.sql
-- Reverses 590: puts DF back on its age-band cohorts and removes every band, so 588's
-- guard stops refusing anyone at DF and the club behaves exactly as it did pre-590.
--
-- ⚠️ Reverse 590 BEFORE 589. 589's down makes the band columns unwritable again; rolling
-- it back first would strand DF's year bands as data no RPC can edit or clear, while
-- 588's guard is still enforcing them — an invisible, unfixable band that silently
-- refuses children.
--
-- ⚠️ This DELETES the Reception & Year 1 class and its sessions. Safe only while that
-- class has NO bookings — check first:
--     SELECT count(*) FROM venue_class_bookings b
--     JOIN venue_class_sessions s ON s.id = b.session_id
--     JOIN venue_class_types ct ON ct.id = s.class_type_id
--     WHERE ct.venue_id='v_ffff5528a0' AND ct.name='Reception & Year 1';
-- Non-zero means real families have booked. STOP — deactivate the class
-- (is_active=false) instead of deleting it, and leave the rest of this file unrun.

BEGIN;

-- ── 1. Unband DF's classes (stops 588's guard biting) ───────────────────────
UPDATE public.venue_class_types
SET school_year_min = NULL, school_year_max = NULL
WHERE venue_id = 'v_ffff5528a0' AND name IN ('Club Training', 'Tots');

-- ── 2. Remove the Reception & Year 1 class, sessions first ──────────────────
DELETE FROM public.venue_class_sessions s
USING public.venue_class_types ct
WHERE ct.id = s.class_type_id
  AND ct.venue_id = 'v_ffff5528a0' AND ct.name = 'Reception & Year 1';

DELETE FROM public.venue_class_series ser
USING public.venue_class_types ct
WHERE ct.id = ser.class_type_id
  AND ct.venue_id = 'v_ffff5528a0' AND ct.name = 'Reception & Year 1';

DELETE FROM public.venue_class_types
WHERE venue_id = 'v_ffff5528a0' AND name = 'Reception & Year 1';

-- ── 3. Re-activate the age-band cohorts ─────────────────────────────────────
UPDATE public.club_cohorts
SET active = true
WHERE club_id = 'club_df_sports_coaching'
  AND name IN ('Under 6s', 'Under 8s', 'Under 10s', 'Under 12s');

-- ── 4. Re-point the children back onto their age cohort ─────────────────────
-- Age-today (date_part on age()) is 580's original placement rule — deliberately restored
-- here, wrong though 588 proved it to be, because this file's job is to undo 590, not to
-- improve on it.
UPDATE public.venue_memberships vm
SET cohort_id = c.id
FROM public.member_profiles mp, public.club_cohorts c
WHERE vm.member_profile_id = mp.id
  AND vm.venue_id = 'v_ffff5528a0'
  AND c.club_id   = 'club_df_sports_coaching'
  AND c.active
  AND c.min_age IS NOT NULL
  AND date_part('year', age(mp.dob))::int BETWEEN c.min_age AND c.max_age;

-- ── 5. Drop the school-year cohorts ─────────────────────────────────────────
-- Only once nothing points at them — a membership still referencing one would FK-fail
-- (and correctly so: it means step 4 missed a child).
DELETE FROM public.club_cohorts c
WHERE c.club_id = 'club_df_sports_coaching'
  AND c.name IN ('Pre-school','Reception','Year 1','Year 2','Year 3','Year 4','Year 5','Year 6')
  AND NOT EXISTS (SELECT 1 FROM public.venue_memberships vm WHERE vm.cohort_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.club_teams t WHERE t.cohort_id = c.id);

COMMIT;
