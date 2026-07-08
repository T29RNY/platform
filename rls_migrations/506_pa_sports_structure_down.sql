-- =============================================================================
-- Migration 506 DOWN: remove PA Sports cohorts + teams + staff + managers + DBS
-- =============================================================================
-- Run before 505_down, after 507/508/509 downs (rosters/sessions reference teams).
-- =============================================================================

DELETE FROM club_staff_dbs     WHERE club_id = 'club_pa_sports';
DELETE FROM club_team_managers WHERE id::text LIKE 'a5300000%';
DELETE FROM member_profiles    WHERE id::text LIKE 'a5040000%';
DELETE FROM club_teams         WHERE club_id = 'club_pa_sports';
DELETE FROM club_cohorts       WHERE club_id = 'club_pa_sports';
