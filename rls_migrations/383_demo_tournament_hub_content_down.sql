-- down for 382: remove seeded sponsors + clear info/branding hero (venue address left as-is).
DELETE FROM tournament_sponsors WHERE id IN (
  '70000000-0000-4000-8000-000000000501','70000000-0000-4000-8000-000000000502','70000000-0000-4000-8000-000000000503');
UPDATE tournament_events SET info = '{}'::jsonb WHERE id = '70000000-0000-4000-8000-000000000001';
