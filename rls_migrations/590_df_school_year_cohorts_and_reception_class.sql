-- 590_df_school_year_cohorts_and_reception_class.sql
-- P2c of the DF Sports trial epic — turn the school-year model ON for DF.
--
-- 588 built the model, 589 made it writable. This is the first migration that puts real
-- data behind it, and the first with a user-visible effect: after this, DF's booking
-- guard actually refuses an out-of-year child.
--
-- ⚠️ THIS TOUCHES A REAL CLUB'S LIVE DATA (club_df_sports_coaching / venue v_ffff5528a0).
-- Safe to run because, verified live 2026-07-16: 0 club_teams reference DF's cohorts and
-- 0 bookings exist on any DF session — so re-banding and re-pointing cohorts cannot
-- strand a team or invalidate a booking. Re-check both before re-running anywhere else.
--
-- OPERATOR DECISIONS BAKED IN HERE (2026-07-16, do not re-litigate):
--   · ONE COHORT PER SCHOOL YEAR (not per class, not re-banded age pairs). A cohort is a
--     register LABEL — Danny's need is "what year group is this child, so groups stay
--     balanced" when he splits a mixed-age session on the day. Per-year is the only shape
--     that answers that precisely. Reception..Year 6 + a Pre-school group for Tots.
--   · The Reception/Year 1 Saturday class runs 10:00–11:00, straight after Tots (09:00).
--
-- WHY THE RECEPTION/Y1 CLASS IS NOT OPTIONAL: DF's children sit at school years
-- 6/4/2/2/2/0. Banding Club Training to Years 2–6 and Tots to pre-school leaves the Year 0
-- child (Mia Bennett, dob 2021-02-03) able to book NOTHING — today, bandless, she can book
-- both. Creating this class in the SAME migration is what stops that regression. It is why
-- P2c was split from P2b and held until the operator gave the time.

BEGIN;

-- ── 1. DF's cohorts: one per school year ────────────────────────────────────
-- Idempotent by (club_id, name) — club_cohorts has no unique constraint on it, so guard
-- with NOT EXISTS rather than ON CONFLICT.
-- Pre-school uses school_year_max = -1 with a NULL floor: Reception is 0, so "< 0" means
-- not yet at school. It ejects a child the moment they start Reception — which is exactly
-- right for a toddler group and is something an age band cannot express.
INSERT INTO public.club_cohorts (club_id, name, category, school_year_min, school_year_max)
SELECT 'club_df_sports_coaching', v.name, 'youth', v.sy_min, v.sy_max
FROM (VALUES
  ('Pre-school', NULL::int, -1),
  ('Reception',  0,          0),
  ('Year 1',     1,          1),
  ('Year 2',     2,          2),
  ('Year 3',     3,          3),
  ('Year 4',     4,          4),
  ('Year 5',     5,          5),
  ('Year 6',     6,          6)
) AS v(name, sy_min, sy_max)
WHERE NOT EXISTS (
  SELECT 1 FROM public.club_cohorts c
  WHERE c.club_id = 'club_df_sports_coaching' AND c.name = v.name
);

-- ── 2. Re-point DF's children at their school-year cohort ───────────────────
-- Resolved from dob via 588's own _school_year_for_dob (31 Aug cutoff), NOT age-today —
-- the whole point of 588. Joining on the year rather than hardcoding member ids keeps this
-- correct if the seed changes and makes the intent readable.
UPDATE public.venue_memberships vm
SET cohort_id = c.id
FROM public.member_profiles mp, public.club_cohorts c
WHERE vm.member_profile_id = mp.id
  AND vm.venue_id  = 'v_ffff5528a0'
  AND c.club_id    = 'club_df_sports_coaching'
  AND c.school_year_min IS NOT NULL
  AND c.school_year_min = c.school_year_max                       -- the per-year cohorts
  AND c.school_year_min = public._school_year_for_dob(mp.dob);

-- Pre-school children (school year < 0) land in the Pre-school group. No DF child is
-- pre-school today (the youngest is Reception), but Tots exists for them, so the mapping
-- must be here rather than discovered later.
UPDATE public.venue_memberships vm
SET cohort_id = c.id
FROM public.member_profiles mp, public.club_cohorts c
WHERE vm.member_profile_id = mp.id
  AND vm.venue_id  = 'v_ffff5528a0'
  AND c.club_id    = 'club_df_sports_coaching'
  AND c.name       = 'Pre-school'
  AND public._school_year_for_dob(mp.dob) < 0;

-- ── 3. Retire the age-band cohorts ──────────────────────────────────────────
-- Deactivated, NOT deleted: they carry history, and `active=false` already means "hide
-- from filters without deleting" everywhere. Safe because 0 club_teams point at them.
-- Their min_age/max_age are left as-is — inert once nothing references them, and 589's
-- band_conflict only fires on a WRITE, never on a resting row.
UPDATE public.club_cohorts
SET active = false
WHERE club_id = 'club_df_sports_coaching'
  AND name IN ('Under 6s', 'Under 8s', 'Under 10s', 'Under 12s');

-- ── 4. Band DF's existing classes ───────────────────────────────────────────
-- This is the switch that makes 588's guard bite for DF.
UPDATE public.venue_class_types
SET school_year_min = 2, school_year_max = 6
WHERE venue_id = 'v_ffff5528a0' AND name = 'Club Training';

UPDATE public.venue_class_types
SET school_year_min = NULL, school_year_max = -1
WHERE venue_id = 'v_ffff5528a0' AND name = 'Tots';

-- ── 5. The Reception & Year 1 class (Sat 10:00–11:00) ───────────────────────
-- Mirrors Tots exactly — same space, same instructor, same six term segments, same
-- door/free setup — shifted one hour later. members_only=false is load-bearing: it
-- DEFAULTS TRUE, and a members-only class is invisible to the prospective parent the
-- whole trial flow exists for.
INSERT INTO public.venue_class_types
  (venue_id, space_id, name, category, duration_minutes, default_capacity,
   members_only, first_session_free, school_year_min, school_year_max)
SELECT 'v_ffff5528a0', '7dd27ddf-e2e3-48f2-abb1-2bdea748ea76',
       'Reception & Year 1', 'other', 60, 30, false, true, 0, 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.venue_class_types
  WHERE venue_id = 'v_ffff5528a0' AND name = 'Reception & Year 1'
);

-- Series + sessions, generated from the same term segments Tots uses. "Term time" = one
-- series per term SEGMENT: venue_class_series has a single continuous start/end and cannot
-- skip a half-term. Each segment ends on the last SCHOOL day (a Friday), which also
-- excludes every break-opening Saturday for free.
-- Kenilworth School 2026/27: Autumn 3 Sep–18 Dec (HT 26–30 Oct) · Spring 4 Jan–25 Mar
-- (HT 15–19 Feb) · Summer 12 Apr–21 Jul (HT 31 May–4 Jun).
DO $seed$
DECLARE
  v_ct_id     uuid;
  v_instr_id  uuid;
  v_space_id  uuid := '7dd27ddf-e2e3-48f2-abb1-2bdea748ea76';
  v_series_id uuid;
  seg         record;
BEGIN
  SELECT id INTO v_ct_id FROM public.venue_class_types
   WHERE venue_id = 'v_ffff5528a0' AND name = 'Reception & Year 1';

  -- Reuse whatever instructor DF's other classes already use (currently the OPERATOR as a
  -- placeholder — swapped to Danny when he is invited LAST). Deriving it rather than
  -- hardcoding means the placeholder swap doesn't have to remember this migration.
  SELECT s.instructor_id INTO v_instr_id
  FROM public.venue_class_series s
  JOIN public.venue_class_types ct ON ct.id = s.class_type_id
  WHERE ct.venue_id = 'v_ffff5528a0' AND ct.name = 'Tots'
  LIMIT 1;

  IF v_ct_id IS NULL OR v_instr_id IS NULL THEN
    RAISE EXCEPTION 'df_reception_class_seed_preconditions_missing (ct=% instr=%)', v_ct_id, v_instr_id;
  END IF;

  FOR seg IN
    SELECT * FROM (VALUES
      (DATE '2026-09-03', DATE '2026-10-23'),
      (DATE '2026-11-02', DATE '2026-12-18'),
      (DATE '2027-01-04', DATE '2027-02-12'),
      (DATE '2027-02-22', DATE '2027-03-25'),
      (DATE '2027-04-12', DATE '2027-05-28'),
      (DATE '2027-06-07', DATE '2027-07-21')
    ) AS t(seg_start, seg_end)
  LOOP
    -- idempotent per segment
    SELECT id INTO v_series_id FROM public.venue_class_series
     WHERE class_type_id = v_ct_id AND series_start = seg.seg_start;

    IF v_series_id IS NULL THEN
      INSERT INTO public.venue_class_series
        (class_type_id, instructor_id, day_of_week, start_time, series_start, series_end,
         price_pence, payment_mode, is_active)
      VALUES (v_ct_id, v_instr_id, 6, TIME '10:00', seg.seg_start, seg.seg_end,
              0, 'door', true)
      RETURNING id INTO v_series_id;

      -- Every Saturday in the segment. dow 6 = Saturday (matches extract(dow):
      -- Club Training is Wednesday = 3).
      --
      -- ⚠️ THE `d::date` CAST IS LOAD-BEARING — without it these sessions drift an hour
      -- mid-term. `generate_series(DATE, DATE, INTERVAL)` resolves to the TIMESTAMPTZ
      -- overload, so `d` is already timezone-aware; `AT TIME ZONE` then runs BACKWARDS
      -- (timestamptz -> naive local timestamp), which the timestamptz column re-reads as
      -- UTC. Measured: 17 Oct 2026 lands at 11:00 local but 31 Oct at 10:00 — the autumn
      -- term straddles the 25 Oct clock change, so half of DF's parents would arrive an
      -- hour early. Casting to DATE first makes `date + time` a naive timestamp, so
      -- `AT TIME ZONE 'Europe/London'` runs the intended direction (local -> timestamptz)
      -- and the wall-clock hour holds year-round. Caught by 590's ephemeral-verify, which
      -- asserts exactly one distinct local start time.
      INSERT INTO public.venue_class_sessions
        (venue_id, class_type_id, series_id, instructor_id, space_id,
         starts_at, ends_at, capacity, status, price_pence, payment_mode)
      SELECT 'v_ffff5528a0', v_ct_id, v_series_id, v_instr_id, v_space_id,
             (d::date + TIME '10:00') AT TIME ZONE 'Europe/London',
             (d::date + TIME '11:00') AT TIME ZONE 'Europe/London',
             30, 'scheduled', 0, 'door'
      FROM generate_series(seg.seg_start, seg.seg_end, INTERVAL '1 day') AS d
      WHERE EXTRACT(DOW FROM d) = 6;
    END IF;
  END LOOP;
END
$seed$;

COMMIT;
