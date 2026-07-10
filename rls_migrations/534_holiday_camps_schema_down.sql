-- 534_holiday_camps_schema_down.sql
-- Reverse of 534_holiday_camps_schema.sql. Drops the additive camp columns + their
-- CHECK/FK constraints. Safe: nothing else references these columns until P9.2+.

ALTER TABLE public.venue_class_sessions DROP CONSTRAINT IF EXISTS venue_class_sessions_end_date_check;
ALTER TABLE public.venue_class_sessions DROP COLUMN IF EXISTS end_date;

ALTER TABLE public.venue_class_types DROP CONSTRAINT IF EXISTS venue_class_types_audience_target_check;
ALTER TABLE public.venue_class_types DROP CONSTRAINT IF EXISTS venue_class_types_target_team_id_fkey;
ALTER TABLE public.venue_class_types DROP CONSTRAINT IF EXISTS venue_class_types_audience_check;
ALTER TABLE public.venue_class_types DROP CONSTRAINT IF EXISTS venue_class_types_booking_mode_check;

ALTER TABLE public.venue_class_types
  DROP COLUMN IF EXISTS target_team_id,
  DROP COLUMN IF EXISTS audience,
  DROP COLUMN IF EXISTS booking_mode,
  DROP COLUMN IF EXISTS dropoff_location,
  DROP COLUMN IF EXISTS pickup_location,
  DROP COLUMN IF EXISTS dropoff_time,
  DROP COLUMN IF EXISTS pickup_time,
  DROP COLUMN IF EXISTS camp_dietary,
  DROP COLUMN IF EXISTS camp_info,
  DROP COLUMN IF EXISTS is_camp;
