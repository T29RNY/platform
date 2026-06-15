-- Down: Migration 327 — Event OS: Phase 7 Commercial
--
-- Drops all Phase 7 Commercial additions.
-- The replaced RPCs (get_tournament_public, club_admin_get_tournament) are NOT
-- automatically restored — manually re-apply mig 326 and mig 324 bodies if needed.

DROP FUNCTION IF EXISTS public.club_admin_add_sponsor(uuid, text, text, text, int);
DROP FUNCTION IF EXISTS public.club_admin_list_sponsors(uuid);
DROP FUNCTION IF EXISTS public.club_admin_remove_sponsor(uuid);
DROP FUNCTION IF EXISTS public.club_admin_set_branding(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.club_admin_set_player_of_tournament(uuid, text, text);
DROP FUNCTION IF EXISTS public.club_admin_get_equipment_for_tournament(uuid);
DROP FUNCTION IF EXISTS public.club_admin_book_equipment_for_tournament(uuid, uuid, int, timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.club_admin_list_tournament_equipment_bookings(uuid);
DROP FUNCTION IF EXISTS public.club_admin_cancel_equipment_booking(uuid);

DROP TABLE IF EXISTS public.tournament_sponsors;

ALTER TABLE public.tournament_events
  DROP COLUMN IF EXISTS player_of_tournament_name,
  DROP COLUMN IF EXISTS player_of_tournament_team;

DROP INDEX IF EXISTS equipment_bookings_tournament_idx;
ALTER TABLE public.equipment_bookings
  DROP COLUMN IF EXISTS tournament_event_id;
