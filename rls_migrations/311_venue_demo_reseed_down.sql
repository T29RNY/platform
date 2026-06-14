-- 311_venue_demo_reseed_down.sql — reverses the venue demo reseed

-- Remove the 4 new bookings + their occupancy
DELETE FROM pitch_occupancy
WHERE venue_id = 'demo_venue'
  AND source_id::text IN (
    'aa000000-0311-4000-8000-000000000001',
    'aa000000-0311-4000-8000-000000000002',
    'aa000000-0311-4000-8000-000000000003'
  );

DELETE FROM pitch_bookings
WHERE venue_id = 'demo_venue'
  AND id IN (
    'aa000000-0311-4000-8000-000000000001',
    'aa000000-0311-4000-8000-000000000002',
    'aa000000-0311-4000-8000-000000000003',
    'aa000000-0311-4000-8000-000000000004'
  );

-- Revert June 17 booking name
UPDATE pitch_bookings
SET    booked_by_name = NULL
WHERE  id = 'a08c5ef0-6e79-4574-87d3-d38bb470fba6' AND venue_id = 'demo_venue';

-- Clear cohort_ids
UPDATE venue_memberships SET cohort_id = NULL WHERE club_id = 'club_demo';
