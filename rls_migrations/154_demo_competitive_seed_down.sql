-- Down for migration 154 — remove the demo COMPETITIVE testbed entirely.
-- Surgically scoped to the dc / p_dc_ / democomp namespace. Verified (seed+down
-- in a rollback txn) to leave the real operator account, their real players, and
-- the existing demo_venue Summer League fully intact. FK-safe deletion order.

DELETE FROM match_events       WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id='dc000000-0000-4000-8000-000000000002');
DELETE FROM fixtures           WHERE competition_id='dc000000-0000-4000-8000-000000000002';
DELETE FROM player_registrations WHERE competition_id='dc000000-0000-4000-8000-000000000002';
DELETE FROM competition_teams   WHERE competition_id='dc000000-0000-4000-8000-000000000002';
DELETE FROM competitions        WHERE id='dc000000-0000-4000-8000-000000000002';
DELETE FROM seasons             WHERE id='dc000000-0000-4000-8000-000000000001';
DELETE FROM leagues             WHERE id='league_democomp';
DELETE FROM team_admins         WHERE team_id IN ('team_dc_fc','team_dc_rovers','team_dc_city','team_dc_athletic');
DELETE FROM team_players        WHERE team_id IN ('team_dc_fc','team_dc_rovers','team_dc_city','team_dc_athletic');
DELETE FROM players
  WHERE id='p_dc_tarny'
     OR id IN (SELECT 'p_dc_fc'||g  FROM generate_series(1,7) g)
     OR id IN (SELECT 'p_dc_rov'||g FROM generate_series(1,5) g)
     OR id IN (SELECT 'p_dc_cit'||g FROM generate_series(1,5) g)
     OR id IN (SELECT 'p_dc_ath'||g FROM generate_series(1,5) g);
DELETE FROM schedule            WHERE team_id IN ('team_dc_fc','team_dc_rovers','team_dc_city','team_dc_athletic');
DELETE FROM settings            WHERE team_id IN ('team_dc_fc','team_dc_rovers','team_dc_city','team_dc_athletic');
DELETE FROM teams               WHERE id IN ('team_dc_fc','team_dc_rovers','team_dc_city','team_dc_athletic');
