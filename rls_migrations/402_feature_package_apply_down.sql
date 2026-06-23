-- Down migration 402 — drop the bulk-apply (package preset) RPCs.
DROP FUNCTION IF EXISTS public.venue_set_venue_features(text, jsonb);
DROP FUNCTION IF EXISTS public.venue_set_club_features(text, text, jsonb);
