-- 170_demo_company_seed_down.sql — remove the Phase 6.1 demo company testbed.
DELETE FROM incidents WHERE venue_id = 'demo_venue'
  AND description IN (
    'Floodlight fault on pitch 2 — half the pitch dim',
    'Changing-room flood — pitch unplayable, fixtures at risk'
  );
DELETE FROM company_admins WHERE company_id = 'company_demo';
DELETE FROM venues WHERE id = 'venue_demo_south';
UPDATE venues SET company_id = NULL, region = NULL WHERE id = 'demo_venue';
DELETE FROM companies WHERE id = 'company_demo';
