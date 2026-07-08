-- =============================================================================
-- Migration 508 DOWN: remove PA Sports schedule (series, sessions, leagues, fixtures)
-- =============================================================================
-- Run before 506_down (fixtures/sessions reference teams). pitch_occupancy rows
-- are cleaned automatically by the club_sessions/club_fixtures delete triggers.
-- =============================================================================

DELETE FROM club_fixtures       WHERE id::text LIKE 'a5b1%';
DELETE FROM club_leagues        WHERE id::text LIKE 'a5b0%';
DELETE FROM club_sessions       WHERE id::text LIKE 'a5d1%';
DELETE FROM club_session_series WHERE id::text LIKE 'a5d0%';
