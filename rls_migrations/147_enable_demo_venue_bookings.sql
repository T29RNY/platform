-- Migration 147 — DEMO DATA (test enablement, fully reversible).
-- Switches bookings ON for the existing demo_venue so the Stage 5/6 booking UI
-- can be exercised against real data. Purely additive: a flag + cancellation
-- policy on the venue, booking_windows jsonb on its two pitches, and two
-- confirmed walk-in demo bookings on weekend slots (clear of the Wed fixtures
-- and the Jul maintenance window). Down reverts all of it.
-- Not customer data — demo_venue is the only venue and is a demo.

UPDATE public.venues
   SET bookings_enabled = true,
       cancellation_policy = 'Free cancellation up to 24 hours before kick-off. Within 24 hours the booking is non-refundable.'
 WHERE id = 'demo_venue';

-- Main Pitch: all week 08:00-22:00, 60 + 90 min slots offered
UPDATE public.playing_areas
   SET booking_windows = (
     SELECT jsonb_agg(jsonb_build_object(
       'day_of_week', d, 'open_time', '08:00', 'close_time', '22:00',
       'slot_lengths', jsonb_build_array(60, 90)) ORDER BY d)
     FROM generate_series(0,6) d)
 WHERE id = 'c0f26961-9dfc-41a1-8e53-9c774d9f1f81';

-- Side Pitch: all week 08:00-22:00, 60 min only
UPDATE public.playing_areas
   SET booking_windows = (
     SELECT jsonb_agg(jsonb_build_object(
       'day_of_week', d, 'open_time', '08:00', 'close_time', '22:00',
       'slot_lengths', jsonb_build_array(60)) ORDER BY d)
     FROM generate_series(0,6) d)
 WHERE id = '5b866896-d907-4e6e-b1be-ec23ba7e57c8';

-- Two confirmed walk-in demo bookings (weekend, clear of existing occupancy).
INSERT INTO public.pitch_bookings (id, team_id, booked_by_name, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000147', NULL, 'Sunday Rovers (demo)', 'demo_venue', 'c0f26961-9dfc-41a1-8e53-9c774d9f1f81', current_date + 2, '18:00', 60, 'adhoc', 'confirmed'),
  ('bbbbbbbb-0000-4000-8000-000000000147', NULL, 'Office United (demo)', 'demo_venue', '5b866896-d907-4e6e-b1be-ec23ba7e57c8', current_date + 3, '10:00', 60, 'adhoc', 'confirmed');

INSERT INTO public.pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
VALUES
  ('c0f26961-9dfc-41a1-8e53-9c774d9f1f81', 'demo_venue',
   tstzrange(((current_date + 2) + time '18:00') AT TIME ZONE 'Europe/London',
             ((current_date + 2) + time '18:00') AT TIME ZONE 'Europe/London' + interval '60 min', '[)'),
   'booking', 'aaaaaaaa-0000-4000-8000-000000000147', 3, true),
  ('5b866896-d907-4e6e-b1be-ec23ba7e57c8', 'demo_venue',
   tstzrange(((current_date + 3) + time '10:00') AT TIME ZONE 'Europe/London',
             ((current_date + 3) + time '10:00') AT TIME ZONE 'Europe/London' + interval '60 min', '[)'),
   'booking', 'bbbbbbbb-0000-4000-8000-000000000147', 3, true);
