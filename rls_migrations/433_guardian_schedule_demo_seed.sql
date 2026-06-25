-- Migration 433 — Guardian app Phase 1: demo seed for the Schedule screen.
--
-- WHY: the Guardian Schedule screen (apps/inorout /hub → More → Schedule) blends
-- the child's training sessions (club_sessions) + league fixtures (club_fixtures)
-- + booked classes (venue_class_bookings) into one chronological agenda, entirely
-- from existing readers (guardian_list_children_sessions / guardian_list_child_fixtures
-- / guardian_list_child_class_options). No new backend — this is a pure-frontend
-- cycle. But the demo child Charlie Carter has 0 upcoming training sessions and
-- his only class booking is in the past, so the agenda would show fixtures alone
-- and not demonstrate the blend. This seed is ADDITIVE + deterministic + ON
-- CONFLICT DO NOTHING — it never mutates existing rows.
--
-- WHAT (all for Charlie Carter, member_profiles 0d…0013, U12 Falcons c0…0002,
-- club_demo / demo_venue):
--   1. Two upcoming U12 Falcons training club_sessions (Tue + Thu next week).
--   2. One upcoming Junior Boxing venue_class_session + a confirmed booking for
--      Charlie (so a booked class shows in the agenda; display-only there).
-- Charlie already has an active club_demo venue_membership (a0…430, mig 430) so
-- the team sessions pass guardian_list_children_sessions' membership guard.

-- ─── 1. Two upcoming U12 Falcons training sessions ───────────────────────────
INSERT INTO public.club_sessions
  (id, club_id, team_id, session_type, title, scheduled_at, location, capacity, status)
VALUES
  ('aa000000-0000-4000-8000-000000000433', 'club_demo',
   'c0000000-0000-4000-8000-000000000002', 'training',
   'U12 Falcons Training', '2026-06-30 18:00:00+01', 'Main Astro 3G', 16, 'scheduled'),
  ('aa000000-0000-4000-8000-000000000434', 'club_demo',
   'c0000000-0000-4000-8000-000000000002', 'training',
   'U12 Falcons Training', '2026-07-02 18:00:00+01', 'Main Astro 3G', 16, 'scheduled')
ON CONFLICT (id) DO NOTHING;

-- ─── 2. One upcoming Junior Boxing class + Charlie booked in ──────────────────
INSERT INTO public.venue_class_sessions
  (id, venue_id, class_type_id, instructor_id, space_id, starts_at, ends_at,
   capacity, status, price_pence, payment_mode)
VALUES
  ('e5000000-0000-4000-8000-000000000433', 'demo_venue',
   'c7000000-0000-4000-8000-000000000002',           -- Junior Boxing class type
   '12b18c95-2508-450b-9118-34d98877bff6',            -- existing demo instructor
   '5b000000-0000-4000-8000-000000000001',            -- existing demo space
   '2026-07-01 17:30:00+01', '2026-07-01 18:30:00+01',
   12, 'scheduled', 500, 'door')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venue_class_bookings
  (id, session_id, member_profile_id, status, payment_status, payment_method)
VALUES
  ('b0000000-0000-4000-8000-000000000433',
   'e5000000-0000-4000-8000-000000000433',
   '0d000000-0000-4000-8000-000000000013',            -- Charlie Carter
   'confirmed', 'pending', 'not_yet')
ON CONFLICT (id) DO NOTHING;
