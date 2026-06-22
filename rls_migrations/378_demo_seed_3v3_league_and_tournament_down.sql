-- 378_demo_seed_3v3_league_and_tournament_down.sql
-- Teardown for the pilot demo seed (migration 378). Removes everything that
-- migration owns, by stable id, children -> parents. Safe to run repeatedly.

DELETE FROM match_events WHERE fixture_id IN (
  SELECT id FROM fixtures WHERE competition_id IN (
    '3a3a0000-0000-4000-8000-000000000010',   -- 3v3 league competition
    '70000000-0000-4000-8000-000000000010',   -- tournament group stage
    '70000000-0000-4000-8000-000000000020'    -- tournament knockout
  ));
DELETE FROM fixtures WHERE competition_id IN (
  '3a3a0000-0000-4000-8000-000000000010',
  '70000000-0000-4000-8000-000000000010',
  '70000000-0000-4000-8000-000000000020');
DELETE FROM competition_teams WHERE competition_id IN (
  '3a3a0000-0000-4000-8000-000000000010',
  '70000000-0000-4000-8000-000000000010',
  '70000000-0000-4000-8000-000000000020');
DELETE FROM competitions WHERE id IN (
  '3a3a0000-0000-4000-8000-000000000010',
  '70000000-0000-4000-8000-000000000010',
  '70000000-0000-4000-8000-000000000020');
DELETE FROM seasons WHERE id = '3a3a0000-0000-4000-8000-000000000001';
DELETE FROM leagues WHERE id = 'demo_league_3v3';
DELETE FROM players WHERE team LIKE 'team_3v3_%';
DELETE FROM teams WHERE id LIKE 'team_3v3_%';
DELETE FROM tournament_events WHERE id = '70000000-0000-4000-8000-000000000001';
DELETE FROM club_team_managers WHERE id = 'aa3a0000-0000-4000-8000-000000000001';
DELETE FROM venue_memberships WHERE id = 'ab000000-0000-4000-8000-000000000012';
