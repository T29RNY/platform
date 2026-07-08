-- =============================================================================
-- Migration 510 DOWN: remove PA Sports activity (attendance, rsvps, availability,
-- extra fixtures, POTM, announcements)
-- =============================================================================

DELETE FROM club_session_attendance   WHERE session_id::text LIKE 'a5d1%';
DELETE FROM club_session_rsvps        WHERE session_id::text LIKE 'a5d1%';
DELETE FROM club_fixture_availability WHERE fixture_id::text LIKE 'a5b1%';
DELETE FROM club_announcements        WHERE id::text LIKE 'a5c2%';
DELETE FROM club_team_potm            WHERE club_id = 'club_pa_sports';
-- extra played fixtures + the past training sessions added by 510
DELETE FROM club_fixtures WHERE id::text IN ('a5b10000-0000-4000-8000-000000000005','a5b10000-0000-4000-8000-000000000006');
DELETE FROM club_sessions WHERE id::text LIKE 'a5d10000-0000-4000-8000-0000000000004%';
