-- 451 DOWN: drop the team-manager fixtures reader + remove the First Team demo seed.
-- The 'Test'->'Northwood United' field curation on a88a9397 is left as-is (demo data;
-- reverting fabricated values adds no value).

DROP FUNCTION IF EXISTS public.club_manager_list_team_fixtures();

DELETE FROM club_fixture_availability WHERE id IN (
  'ca000000-0000-4000-8000-000000000401',
  'ca000000-0000-4000-8000-000000000402',
  'ca000000-0000-4000-8000-000000000403',
  'ca000000-0000-4000-8000-000000000404'
);

DELETE FROM club_fixtures WHERE id IN (
  'cf000000-0000-4000-8000-000000000401',
  'cf000000-0000-4000-8000-000000000403'
);
