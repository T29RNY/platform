-- 380_demo_tournament_pitches.sql
-- Demo polish (session 172). Assigns pitches to the seeded Finbar's FC Summer Cup
-- fixtures (mig 378) now that mig 379 lets tournament fixtures carry a pitch. Group A
-- + knockout on Main Pitch, Group B on Side Pitch — the 08:00–17:00 window on both
-- demo_venue pitches is free, and 20-min slots keep them non-overlapping. The public
-- tournament page then shows the pitch on each fixture. Idempotent (plain UPDATEs).

UPDATE fixtures SET playing_area_id = 'c0f26961-9dfc-41a1-8e53-9c774d9f1f81'  -- Main Pitch
WHERE id IN (
  '70000000-0000-4000-8000-000000000301',  -- Group A
  '70000000-0000-4000-8000-000000000302',
  '70000000-0000-4000-8000-000000000303',
  '70000000-0000-4000-8000-000000000401',  -- Semi-final
  '70000000-0000-4000-8000-000000000402',  -- Semi-final
  '70000000-0000-4000-8000-000000000403'   -- Final
);

UPDATE fixtures SET playing_area_id = '5b866896-d907-4e6e-b1be-ec23ba7e57c8'  -- Side Pitch
WHERE id IN (
  '70000000-0000-4000-8000-000000000304',  -- Group B
  '70000000-0000-4000-8000-000000000305',
  '70000000-0000-4000-8000-000000000306'
);
