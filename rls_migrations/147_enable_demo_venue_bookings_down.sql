-- Down for 147 — revert the demo-venue booking enablement.

DELETE FROM public.pitch_occupancy
 WHERE source_kind = 'booking'
   AND source_id IN ('aaaaaaaa-0000-4000-8000-000000000147','bbbbbbbb-0000-4000-8000-000000000147');

DELETE FROM public.pitch_bookings
 WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000147','bbbbbbbb-0000-4000-8000-000000000147');

UPDATE public.playing_areas SET booking_windows = '[]'::jsonb
 WHERE id IN ('c0f26961-9dfc-41a1-8e53-9c774d9f1f81','5b866896-d907-4e6e-b1be-ec23ba7e57c8');

UPDATE public.venues SET bookings_enabled = false, cancellation_policy = NULL
 WHERE id = 'demo_venue';
