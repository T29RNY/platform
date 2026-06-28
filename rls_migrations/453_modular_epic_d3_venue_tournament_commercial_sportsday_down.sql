-- Down for migration 453 — drop the 15 venue-token D3 siblings.
-- Reverses NO schema (D3 added none). The club_admin_* originals + the D1 helper are untouched.

DROP FUNCTION IF EXISTS public.venue_add_sponsor(text, uuid, text, text, text, int);
DROP FUNCTION IF EXISTS public.venue_list_sponsors(text, uuid);
DROP FUNCTION IF EXISTS public.venue_remove_sponsor(text, uuid);
DROP FUNCTION IF EXISTS public.venue_set_branding(text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.venue_set_player_of_tournament(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.venue_get_equipment_for_tournament(text, uuid);
DROP FUNCTION IF EXISTS public.venue_book_equipment_for_tournament(text, uuid, uuid, int, timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.venue_list_tournament_equipment_bookings(text, uuid);
DROP FUNCTION IF EXISTS public.venue_cancel_equipment_booking(text, uuid);
DROP FUNCTION IF EXISTS public.venue_set_performance_config(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.venue_add_performance_event(text, uuid, text, text, text, int, text, timestamptz, int);
DROP FUNCTION IF EXISTS public.venue_list_performance_events(text, uuid);
DROP FUNCTION IF EXISTS public.venue_record_result(text, uuid, text, uuid, numeric, int, text);
DROP FUNCTION IF EXISTS public.venue_get_performance_results(text, uuid);
DROP FUNCTION IF EXISTS public.venue_get_sports_day_standings(text, uuid);
