-- 473_drop_unused_public_views_down.sql
--
-- Restores the three views in their originally-INTENDED safe form (per
-- migration 019_grants_consolidation.sql's documented column set and grants),
-- NOT the vulnerable form that existed immediately before 473. Deliberately
-- does NOT restore anon access or the `token` column on players_public —
-- rolling back must never resurrect the vulnerability that 473 fixed.

CREATE OR REPLACE VIEW teams_public
WITH (security_invoker = true) AS
SELECT id, name, join_code, onboarding_complete, created_at
FROM teams;

CREATE OR REPLACE VIEW matches_public
WITH (security_invoker = true) AS
SELECT id, team_id, match_date, score_a, score_b, score_type, last_goal_scorer,
       scorers, motm, bib_holder, team_a, team_b, winner, cancelled,
       cancel_reason, voting_open, voting_closes_at, vote_count, total_voters,
       was_admin_decided, admin_decision_pending, tied_candidates, created_at
FROM matches;

CREATE OR REPLACE VIEW players_public
WITH (security_invoker = true) AS
SELECT p.id, p.name, p.nickname, p.status, p.type, p.priority, p.disabled,
       p.injured, p.is_guest, p.guest_of, p.team, p.bib_count, p.note,
       COALESCE(tp.is_vice_captain, false) AS is_vice_captain
FROM players p
LEFT JOIN team_players tp ON tp.player_id = p.id;

REVOKE ALL ON teams_public FROM anon, authenticated, PUBLIC;
REVOKE ALL ON matches_public FROM anon, authenticated, PUBLIC;
REVOKE ALL ON players_public FROM anon, authenticated, PUBLIC;
GRANT SELECT ON teams_public TO authenticated;
GRANT SELECT ON matches_public TO authenticated;
GRANT SELECT ON players_public TO authenticated;
