-- 110_phase2_demo_venue_seed_down.sql
--
-- Reverses 110 by deleting the demo venue and everything that
-- cascades from it (leagues → seasons → competitions → fixtures →
-- competition_teams; teams must be deleted separately since they're
-- not venue-scoped; playing_areas + match_officials cascade via
-- venue_id FK).
--
-- audit_events rows generated during the seed are intentionally
-- LEFT IN PLACE — audit history is append-only by design.

DELETE FROM team_players WHERE player_id = 'p_demo_alpha1';
DELETE FROM players WHERE id = 'p_demo_alpha1';

DELETE FROM competition_teams
  WHERE team_id IN ('team_demo_alpha','team_demo_bravo','team_demo_charlie','team_demo_delta');

DELETE FROM teams
  WHERE id IN ('team_demo_alpha','team_demo_bravo','team_demo_charlie','team_demo_delta');

-- Venue cascade handles: leagues, seasons, competitions, fixtures,
-- playing_areas, match_officials, venue_admins (none seeded).
DELETE FROM venues WHERE id = 'demo_venue';
