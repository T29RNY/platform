-- 598_pa_sports_reseed_schedule_down.sql
--
-- Reverses 598. Everything it created lives in the deterministic a5d2* id range
-- (distinct from the a5d0 series and the a5d1 original seed sessions), so the
-- teardown is an exact inverse and cannot touch the real club.
--
-- RSVPs cascade automatically (club_session_rsvps.session_id -> club_sessions is
-- ON DELETE CASCADE), so deleting the sessions is sufficient.
--
-- ⚠️ Running this returns PA Sports to having ZERO live upcoming training — the
-- state that made the demo unsendable on 2026-07-17. Only run it to undo a bad
-- reseed, and expect to re-run a corrected 598 straight after.

BEGIN;

DELETE FROM club_sessions
WHERE club_id = 'club_pa_sports'
  AND id::text LIKE 'a5d2%';

COMMIT;
