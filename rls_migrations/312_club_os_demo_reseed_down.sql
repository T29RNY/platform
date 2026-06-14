-- 312_club_os_demo_reseed_down.sql — reverses the Club OS demo reseed

DELETE FROM club_merchandise WHERE club_id = 'club_demo';
DELETE FROM club_announcements WHERE club_id = 'club_demo';
DELETE FROM club_session_attendance WHERE session_id = '0f100000-0000-4000-8000-000000000003';
DELETE FROM club_sessions WHERE id = '0f100000-0000-4000-8000-000000000003';
DELETE FROM club_session_rsvps csr USING club_sessions cs WHERE csr.session_id = cs.id AND cs.club_id = 'club_demo';
DELETE FROM club_staff_dbs WHERE club_id = 'club_demo';
DELETE FROM club_team_managers ctm USING club_teams ct WHERE ctm.team_id = ct.id AND ct.club_id = 'club_demo';
DELETE FROM club_team_members ctm USING club_teams ct WHERE ctm.team_id = ct.id AND ct.club_id = 'club_demo';
DELETE FROM club_teams WHERE club_id = 'club_demo';
