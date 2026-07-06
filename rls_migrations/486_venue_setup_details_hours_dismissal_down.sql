-- Down for 486: drop the three setters + the two additive columns.
DROP FUNCTION IF EXISTS public.venue_set_setup_dismissed(text, text, boolean);
DROP FUNCTION IF EXISTS public.venue_update_hours(text, jsonb);
DROP FUNCTION IF EXISTS public.venue_update_details(text, jsonb);

ALTER TABLE public.venues
  DROP COLUMN IF EXISTS setup_dismissed_steps,
  DROP COLUMN IF EXISTS opening_hours;
