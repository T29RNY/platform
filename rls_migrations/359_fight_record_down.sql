-- 359_fight_record_down.sql — reverse of 359_fight_record.sql
-- Drops the Phase 4 fight-record RPCs + member_bouts, and the dormant
-- sport_stats columns (nothing reads/writes them, so the drop is safe).

DROP FUNCTION IF EXISTS public.member_get_fight_record(text);
DROP FUNCTION IF EXISTS public.venue_list_member_bouts(text, uuid);
DROP FUNCTION IF EXISTS public.venue_delete_bout(text, uuid, boolean);
DROP FUNCTION IF EXISTS public.venue_update_bout(text, uuid, date, text, text, text, text, int, boolean, jsonb, text);
DROP FUNCTION IF EXISTS public.venue_record_bout(text, uuid, date, text, text, text, text, int, boolean, jsonb, text);

DROP TABLE IF EXISTS public.member_bouts;

ALTER TABLE public.matches      DROP COLUMN IF EXISTS sport_stats;
ALTER TABLE public.player_match DROP COLUMN IF EXISTS sport_stats;
