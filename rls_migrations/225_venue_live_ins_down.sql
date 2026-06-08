-- Down for migration 225.
DROP TRIGGER IF EXISTS players_ins_notify ON public.players;
DROP FUNCTION IF EXISTS public.trg_notify_booking_ins();
DROP FUNCTION IF EXISTS public.venue_get_booking_ins(text);
DROP FUNCTION IF EXISTS public.notify_booking_ins_for_team(text);
