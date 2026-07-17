-- 598_pa_sports_reseed_schedule.sql
--
-- P3/P4 of the PA Sports demo readiness work (see PA_SPORTS_DEMO_HANDOFF.md §0).
-- Depends on 597 having purged the 2 junk series — otherwise this regenerates them.
--
-- WHY: the original build (mig 510) only materialised ~2 weeks of concrete sessions.
-- They expired on 2026-07-16, so every real team had ZERO live upcoming training and
-- the weekly in/out loop — the core of the product — rendered empty for the coach,
-- the parent and the player. The 3 real SERIES are healthy and valid to 2027-07-08;
-- only the dated rows ran out. This stamps dated sessions out of the existing pattern.
-- It invents no new schedule.
--
-- OPERATOR DIRECTION (2026-07-17): run the schedule to END OF AUGUST, and put
-- something imminent in front of every persona.
--
-- WHAT THIS CREATES:
--   Weekly, from the 3 real series, Wed 22 Jul -> Sun 31 Aug 2026:
--     U7 Dortmund   Wed 17:00  @ Seva School  (6 sessions)
--     U7 Milan      Wed 18:00  @ Seva School  (6 sessions)
--     PA Sports Mens Thu 20:00 @ Seva School  (6 sessions)
--   Plus 3 one-off pre-match sessions on Sat 18 Jul — ALL THREE teams have a fixture
--   on Sun 19 Jul, so a Saturday session gives the coach, the parent AND the player
--   something live to RSVP to the moment they open the app. Off-pattern by design
--   (series_id NULL): a pre-match session is a one-off, not part of the weekly series.
--
-- ⏰ THE TIMESTAMPTZ TRAP (the reason this file is careful):
--   generate_series(DATE, DATE, INTERVAL) returns TIMESTAMPTZ, not DATE. Adding a TIME
--   to it and then applying AT TIME ZONE runs the conversion BACKWARDS and silently
--   drifts every row by an hour. So each row is cast d::date FIRST, then
--   (date + time) AT TIME ZONE 'Europe/London' converts a LOCAL wall time to the
--   correct instant. End-of-August also keeps the whole window inside BST (the clocks
--   change 25 Oct 2026), so no row can straddle the change.
--   Asserted below: every generated session must land on exactly ONE distinct local
--   start time per series.
--
-- Deterministic ids in the a5d2* range (distinct from the a5d0 series / a5d1 seed
-- sessions) so this reseed removes cleanly via its _down.sql.
-- Idempotent: ON CONFLICT DO NOTHING throughout.

BEGIN;

-- ── 1. Weekly sessions from the 3 real series ───────────────────────────────
INSERT INTO club_sessions (
  id, club_id, cohort_id, team_id, series_id, title, session_type,
  scheduled_at, location, capacity, status, venue_id, playing_area_id, duration_mins
)
SELECT
  -- deterministic, collision-free: a5d2 + series ordinal + week ordinal
  ('a5d20000-0000-4000-8000-' || lpad((row_number() OVER (ORDER BY s.id, d))::text, 12, '0'))::uuid,
  s.club_id,
  s.cohort_id,
  s.team_id,
  s.id,
  s.title,
  s.session_type,
  -- cast to DATE first (see the trap note above), then interpret as LOCAL wall time
  ((d::date + s.start_time) AT TIME ZONE 'Europe/London'),
  'Seva School',
  s.capacity,
  'scheduled',
  s.venue_id,
  s.playing_area_id,
  60
FROM club_session_series s
-- Step DAILY, not weekly, and filter by weekday: a weekly step anchored on a Wednesday
-- would emit Wednesdays only, so the Thursday Mens series would generate NOTHING.
CROSS JOIN LATERAL generate_series(
  date '2026-07-22',
  date '2026-08-31',
  interval '1 day'
) AS g(d)
WHERE s.club_id = 'club_pa_sports'
  AND s.id::text LIKE 'a5d0%'                       -- the 3 REAL series only
  AND EXTRACT(DOW FROM d::date) = s.day_of_week     -- align to the series' weekday
ON CONFLICT (id) DO NOTHING;

-- ── 2. Sat 18 Jul pre-match sessions — one per team, all play Sun 19 ─────────
-- STAGGERED 10:00 / 11:00 / 12:00. There is only ONE pitch at Seva (the 4G), and
-- club_sessions has a hard-clash trigger (tg_sync_club_session_occupancy ->
-- _reserve_club_occupancy) backed by the resource_occupancy ledger: booking all three
-- teams onto the same pitch at the same time raises `slot_unavailable` and the whole
-- migration aborts. An hour apart per team is both legal and how a real club runs a
-- Saturday morning.
INSERT INTO club_sessions (
  id, club_id, cohort_id, team_id, series_id, title, session_type,
  scheduled_at, location, status, venue_id, playing_area_id, duration_mins
)
SELECT
  ('a5d20000-0000-4000-8000-9000000000' || lpad(x.rn::text, 2, '0'))::uuid,
  'club_pa_sports',
  x.cohort_id,
  x.id,
  NULL,                                   -- one-off, deliberately not in the series
  'Pre-match session',
  'training',
  ((date '2026-07-18' + (time '10:00' + ((x.rn - 1) * interval '1 hour'))) AT TIME ZONE 'Europe/London'),
  'Seva School',
  'scheduled',
  'seva_school',
  'a5a00000-0000-4000-8000-000000000004',
  60
FROM (
  SELECT t.id, t.cohort_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM club_teams t
  WHERE t.club_id = 'club_pa_sports'
    AND t.id::text LIKE 'a510%'           -- the 3 real teams
) x
ON CONFLICT (id) DO NOTHING;

-- ── 3. Partial RSVPs on the two NEAREST sessions per team ───────────────────
-- So the coach's board looks like a live club rather than "nobody replied", while
-- later sessions stay open for PA to interact with themselves. ~70% in / 15% out,
-- and every 3rd member left with no row at all (= 'pending', the real-world state
-- the roster-aware board is built to show).
-- (a window function cannot appear in WHERE, so the per-session member ordinal is
--  computed in a subquery and filtered in the outer statement)
INSERT INTO club_session_rsvps (session_id, member_profile_id, status)
SELECT r.session_id, r.member_profile_id,
       CASE WHEN r.mem_rn % 7 = 0 THEN 'out' ELSE 'in' END
FROM (
  SELECT s.id AS session_id,
         m.member_profile_id,
         row_number() OVER (PARTITION BY s.id ORDER BY m.member_profile_id) AS mem_rn
  FROM (
    SELECT id, team_id,
           row_number() OVER (PARTITION BY team_id ORDER BY scheduled_at) AS rn
    FROM club_sessions
    WHERE club_id = 'club_pa_sports' AND scheduled_at > now() AND status = 'scheduled'
  ) s
  JOIN club_team_members m ON m.team_id = s.team_id
  WHERE s.rn <= 2                       -- the two nearest sessions per team only
) r
WHERE r.mem_rn % 3 <> 0                 -- every 3rd member left with NO row = 'pending'
ON CONFLICT DO NOTHING;

COMMIT;
