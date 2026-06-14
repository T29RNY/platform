-- =============================================================================
-- Migration 311: Venue demo reseed (demo_venue)
-- =============================================================================
-- Cleans up stale/malformed pitch bookings and replaces them with realistic
-- named upcoming bookings. Assigns cohort_ids to venue_memberships for
-- club_demo members. ALL writes scoped to venue_id = 'demo_venue'.
-- =============================================================================

-- ─── Guard ────────────────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM venues WHERE id = 'demo_venue') THEN
    RAISE EXCEPTION 'demo_venue not found — aborting mig 311';
  END IF;
END $guard$;

-- ─── 1. Remove stale past bookings with no customer name ─────────────────────
-- These are test-session artifacts (NULL booked_by_name, all in the past).
-- Must remove pitch_occupancy rows first to avoid FK issues.

DELETE FROM pitch_occupancy
WHERE  venue_id    = 'demo_venue'
  AND  source_kind = 'booking'
  AND  source_id::text IN (
         SELECT id::text FROM pitch_bookings
         WHERE  venue_id        = 'demo_venue'
           AND  booked_by_name IS NULL
           AND  booking_date    < current_date
       );

DELETE FROM pitch_bookings
WHERE  venue_id        = 'demo_venue'
  AND  booked_by_name IS NULL
  AND  booking_date    < current_date;

-- Also remove the two bookings with malformed kickoff times (Jun 10, now past).
-- IDs: ec0af169-6c81-4ca1-aff0-c514ba6f4a34, 98528c4b-9d90-4849-8f48-72e84ec9e8a3
DELETE FROM pitch_occupancy
WHERE  venue_id    = 'demo_venue'
  AND  source_kind = 'booking'
  AND  source_id::text IN (
         'ec0af169-6c81-4ca1-aff0-c514ba6f4a34',
         '98528c4b-9d90-4849-8f48-72e84ec9e8a3'
       );

DELETE FROM pitch_bookings
WHERE  venue_id = 'demo_venue'
  AND  id IN (
         'ec0af169-6c81-4ca1-aff0-c514ba6f4a34',
         '98528c4b-9d90-4849-8f48-72e84ec9e8a3'
       );

-- ─── 2. Name the one remaining upcoming null-name booking (Jun 17) ────────────
UPDATE pitch_bookings
SET    booked_by_name = '5-a-Side Monday Club'
WHERE  id      = 'a08c5ef0-6e79-4574-87d3-d38bb470fba6'
  AND  venue_id = 'demo_venue';

-- ─── 3. Insert fresh upcoming named bookings ──────────────────────────────────
-- Playing area IDs (from mig 110 seed):
--   Main Pitch: c0f26961-9dfc-41a1-8e53-9c774d9f1f81
--   Side Pitch: 5b866896-d907-4e6e-b1be-ec23ba7e57c8

-- Booking A: Thursday evening, Main Pitch — confirmed walk-in
INSERT INTO pitch_bookings
  (id, booked_by_name, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
VALUES (
  'aa000000-0311-4000-8000-000000000001',
  'Thornton Dynamos',
  'demo_venue',
  'c0f26961-9dfc-41a1-8e53-9c774d9f1f81',
  current_date + 4,
  '19:00',
  90,
  'adhoc',
  'confirmed'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pitch_occupancy
  (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
VALUES (
  'c0f26961-9dfc-41a1-8e53-9c774d9f1f81',
  'demo_venue',
  tstzrange(
    ((current_date + 4) + time '19:00') AT TIME ZONE 'Europe/London',
    ((current_date + 4) + time '19:00') AT TIME ZONE 'Europe/London' + interval '90 min',
    '[)'
  ),
  'booking', 'aa000000-0311-4000-8000-000000000001', 3, true
)
ON CONFLICT DO NOTHING;

-- Booking B: Friday lunchtime, Side Pitch — confirmed recurring group
INSERT INTO pitch_bookings
  (id, booked_by_name, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
VALUES (
  'aa000000-0311-4000-8000-000000000002',
  'Lunchtime Casuals FC',
  'demo_venue',
  '5b866896-d907-4e6e-b1be-ec23ba7e57c8',
  current_date + 5,
  '12:00',
  60,
  'adhoc',
  'confirmed'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pitch_occupancy
  (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
VALUES (
  '5b866896-d907-4e6e-b1be-ec23ba7e57c8',
  'demo_venue',
  tstzrange(
    ((current_date + 5) + time '12:00') AT TIME ZONE 'Europe/London',
    ((current_date + 5) + time '12:00') AT TIME ZONE 'Europe/London' + interval '60 min',
    '[)'
  ),
  'booking', 'aa000000-0311-4000-8000-000000000002', 3, true
)
ON CONFLICT DO NOTHING;

-- Booking C: Next Sunday morning, Main Pitch — confirmed
INSERT INTO pitch_bookings
  (id, booked_by_name, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
VALUES (
  'aa000000-0311-4000-8000-000000000003',
  'Sunday Rovers',
  'demo_venue',
  'c0f26961-9dfc-41a1-8e53-9c774d9f1f81',
  current_date + 7,
  '10:00',
  60,
  'adhoc',
  'confirmed'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pitch_occupancy
  (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
VALUES (
  'c0f26961-9dfc-41a1-8e53-9c774d9f1f81',
  'demo_venue',
  tstzrange(
    ((current_date + 7) + time '10:00') AT TIME ZONE 'Europe/London',
    ((current_date + 7) + time '10:00') AT TIME ZONE 'Europe/London' + interval '60 min',
    '[)'
  ),
  'booking', 'aa000000-0311-4000-8000-000000000003', 3, true
)
ON CONFLICT DO NOTHING;

-- Booking D: Next Tuesday evening, Main Pitch — REQUESTED (pending approval)
-- This demos the "confirm / reject" flow in the venue dashboard.
INSERT INTO pitch_bookings
  (id, booked_by_name, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
VALUES (
  'aa000000-0311-4000-8000-000000000004',
  'Office United',
  'demo_venue',
  'c0f26961-9dfc-41a1-8e53-9c774d9f1f81',
  current_date + 9,
  '20:00',
  60,
  'adhoc',
  'requested'
)
ON CONFLICT (id) DO NOTHING;

-- No pitch_occupancy for a 'requested' booking — only confirmed slots block.

-- ─── 4. Assign cohort_ids to club_demo venue_memberships ──────────────────────
-- Leo Bennett (0d000000-006) → U12s cohort
-- All other club_demo members → Adults cohort
-- This links the V2 membership records to the Club OS cohort structure.

UPDATE venue_memberships
SET    cohort_id = '0f000000-0000-4000-8000-000000000001'  -- U12s
WHERE  club_id           = 'club_demo'
  AND  member_profile_id = '0d000000-0000-4000-8000-000000000006';  -- Leo

UPDATE venue_memberships
SET    cohort_id = '0f000000-0000-4000-8000-000000000002'  -- Adults
WHERE  club_id           = 'club_demo'
  AND  member_profile_id != '0d000000-0000-4000-8000-000000000006'
  AND  member_profile_id IS NOT NULL;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- [A] Upcoming bookings (expected: ≥4 confirmed/requested, all in the future)
SELECT booking_date, kickoff_time, booked_by_name, status, slot_minutes
FROM   pitch_bookings
WHERE  venue_id      = 'demo_venue'
  AND  booking_date >= current_date
ORDER  BY booking_date, kickoff_time;

-- [B] Cohort assignment (expected: 1 U12s, rest Adults)
SELECT cohort_id, count(*) FROM venue_memberships
WHERE  club_id = 'club_demo'
GROUP  BY cohort_id;
