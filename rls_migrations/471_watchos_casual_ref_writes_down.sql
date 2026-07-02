-- Down migration for 471_watchos_casual_ref_writes.sql

DROP FUNCTION IF EXISTS public.casual_ref_confirm_full_time(text);
DROP FUNCTION IF EXISTS public.casual_ref_undo_event(text,uuid);
DROP FUNCTION IF EXISTS public.casual_ref_set_period(text,text,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.casual_ref_record_sin_bin(text,text,integer,text,integer,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.casual_ref_record_substitution(text,text,text,integer,text,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.casual_ref_record_card(text,text,integer,text,text,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.casual_ref_record_goal(text,text,integer,text,uuid,boolean,timestamptz);
DROP FUNCTION IF EXISTS public._casual_ref_player_side(public.matches,text);
DROP FUNCTION IF EXISTS public.casual_ref_start_match(text,uuid,timestamptz);
DROP FUNCTION IF EXISTS public._casual_ref_resolve_match(text);

DROP TABLE IF EXISTS public.casual_match_events;

ALTER TABLE public.matches DROP COLUMN IF EXISTS ref_started_at;
