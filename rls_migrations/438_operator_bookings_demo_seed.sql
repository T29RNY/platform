-- Migration 438 — demo seed for the Operator "Bookings" mobile screen (no DDL, no RPC).
-- demo_venue (Demo Sports Centre) has 8 pitch bookings + 28 fixtures but EVERY one is
-- past-dated, so the venue calendar renders honestly empty for the next fortnight (the
-- same demo staleness Operations "Tonight" hits — evergreen demo data is an owed
-- follow-up).
--
-- Seed ~6 FUTURE pitch bookings anchored to current_date at apply time: a mix of
-- confirmed + 2 'requested' so the operator can walk Confirm / Decline.
--
-- IMPORTANT: the calendar readers (get_pitch_occupancy / get_venue_resource_occupancy)
-- build the PITCH lane ONLY from the derived `pitch_occupancy` ledger
-- (`WHERE active AND time_range && range`) — NOT from pitch_bookings directly. There is
-- no trigger on pitch_bookings; the ledger is maintained inside the booking RPCs. So a
-- raw INSERT must ALSO write the matching active ledger row (priority 3, source_kind
-- 'booking') or the booking is invisible on the calendar. detail.status is read live
-- from pitch_bookings by _pitch_occupancy_detail, so one active ledger row covers both
-- confirmed and requested bookings. time_range mirrors the RPC:
-- (booking_date + kickoff_time) AT TIME ZONE 'Europe/London' .. + slot_minutes.
--
-- Additive + idempotent (fixed ids + ON CONFLICT DO NOTHING). Demo rows only — never
-- touches production. Pitches: Main Pitch c0f26961…, Side Pitch 5b866896…. kind='adhoc'.

INSERT INTO public.pitch_bookings
  (id, team_id, booked_by_name, venue_id, playing_area_id, booking_date, kickoff_time,
   slot_minutes, kind, status, amount_pence, payment_status, contact_email, contact_phone)
VALUES
  ('b0000000-0000-4000-8000-000000043801', NULL, 'Sunday Rovers (demo)', 'demo_venue',
   'c0f26961-9dfc-41a1-8e53-9c774d9f1f81', current_date, '18:00', 60, 'adhoc',
   'confirmed', 4500, 'paid', NULL, '07700 900118'),
  ('b0000000-0000-4000-8000-000000043802', NULL, 'Thornton Dynamos', 'demo_venue',
   '5b866896-d907-4e6e-b1be-ec23ba7e57c8', current_date, '19:30', 90, 'adhoc',
   'requested', 6750, 'pending', 'captain@thorntondynamos.example', '07700 900119'),
  ('b0000000-0000-4000-8000-000000043803', 'team_demo_alpha', '5-a-Side Monday Club',
   'demo_venue', 'c0f26961-9dfc-41a1-8e53-9c774d9f1f81', current_date, '20:00', 60,
   'adhoc', 'confirmed', 4500, 'pending', NULL, NULL),
  ('b0000000-0000-4000-8000-000000043804', NULL, 'Office United (demo)', 'demo_venue',
   'c0f26961-9dfc-41a1-8e53-9c774d9f1f81', current_date + 1, '19:00', 60, 'adhoc',
   'confirmed', 4500, 'paid', 'bookings@officeunited.example', '07700 900120'),
  ('b0000000-0000-4000-8000-000000043805', NULL, 'Lunchtime Casuals FC', 'demo_venue',
   '5b866896-d907-4e6e-b1be-ec23ba7e57c8', current_date + 2, '11:00', 120, 'adhoc',
   'confirmed', 9000, 'paid', NULL, NULL),
  ('b0000000-0000-4000-8000-000000043806', NULL, 'Greenway U14s', 'demo_venue',
   'c0f26961-9dfc-41a1-8e53-9c774d9f1f81', current_date + 4, '18:00', 60, 'adhoc',
   'requested', 4500, 'pending', 'coach@greenway.example', '07700 900121')
ON CONFLICT (id) DO NOTHING;

-- Matching active occupancy ledger rows so the bookings appear on the calendar.
INSERT INTO public.pitch_occupancy
  (id, playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
SELECT
  led.led_id,
  pb.playing_area_id,
  pb.venue_id,
  tstzrange(
    (pb.booking_date + pb.kickoff_time) AT TIME ZONE 'Europe/London',
    (pb.booking_date + pb.kickoff_time + make_interval(mins => pb.slot_minutes)) AT TIME ZONE 'Europe/London',
    '[)'),
  'booking',
  pb.id::text,
  3,
  true
FROM (VALUES
  ('b0000000-0000-4000-8000-000000043801'::uuid, 'b0000000-0000-4000-8000-0000004380a1'::uuid),
  ('b0000000-0000-4000-8000-000000043802'::uuid, 'b0000000-0000-4000-8000-0000004380a2'::uuid),
  ('b0000000-0000-4000-8000-000000043803'::uuid, 'b0000000-0000-4000-8000-0000004380a3'::uuid),
  ('b0000000-0000-4000-8000-000000043804'::uuid, 'b0000000-0000-4000-8000-0000004380a4'::uuid),
  ('b0000000-0000-4000-8000-000000043805'::uuid, 'b0000000-0000-4000-8000-0000004380a5'::uuid),
  ('b0000000-0000-4000-8000-000000043806'::uuid, 'b0000000-0000-4000-8000-0000004380a6'::uuid)
) AS led(booking_id, led_id)
JOIN public.pitch_bookings pb ON pb.id = led.booking_id
ON CONFLICT (id) DO NOTHING;
