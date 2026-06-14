-- 313_league_ref_display_reseed_down.sql — reverses the league/ref/display reseed

-- Remove match_events seeded by this migration
DELETE FROM match_events WHERE fixture_id IN (
  'e7af0584-5356-45a9-b227-2a62f8dcbff2',
  '04a6ff0c-0ec9-4232-8c93-f31aaf16029d',
  'dc000000-0000-4000-8000-0000000000f3',
  'dc000000-0000-4000-8000-0000000000f4'
);

-- Clear featured fixture from display config
UPDATE venues
SET    display_config = display_config - 'featured_fixture_id'
WHERE  id = 'demo_venue';

-- Restore fixture dates to original Jun 10 (approximate — re-run mig 112 if exact dates needed)
UPDATE fixtures SET scheduled_date = '2026-06-10'
WHERE  id IN (
  '92e4be46-04e5-4635-96aa-43d98e9a3b5c',
  'f42d82ef-7dd5-43af-a272-e636dba6cd11',
  '4db5873b-ea94-4c01-b4c1-230f592ea11a',
  '732c354a-5e5e-40ef-abe4-f7de2bfa1001',
  'db6f21af-f7f4-464d-a409-0c66aec453d7',
  'dc000000-0000-4000-8000-0000000000f5',
  'dc000000-0000-4000-8000-0000000000f6'
);
