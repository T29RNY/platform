-- 339_class_types_scheduling_down.sql
-- Reverses 339_class_types_scheduling.sql.

DROP FUNCTION IF EXISTS public.venue_mark_class_completed(text,uuid);
DROP FUNCTION IF EXISTS public.venue_get_class_session_detail(text,uuid);
DROP FUNCTION IF EXISTS public.venue_list_class_sessions(text,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS public.venue_reassign_class_instructor(text,uuid,uuid);
DROP FUNCTION IF EXISTS public.venue_cancel_class_series(text,uuid,text);
DROP FUNCTION IF EXISTS public.venue_cancel_class_session(text,uuid,text);
DROP FUNCTION IF EXISTS public.venue_create_class_series(text,uuid,uuid,smallint,time,date,int,text,date);
DROP FUNCTION IF EXISTS public.venue_schedule_class_session(text,uuid,uuid,timestamptz,int,text);
DROP FUNCTION IF EXISTS public.venue_list_class_types(text);
DROP FUNCTION IF EXISTS public.venue_update_class_type(text,uuid,jsonb);
DROP FUNCTION IF EXISTS public.venue_create_class_type(text,text,uuid,int,int,text,int,boolean,text);

DROP TABLE IF EXISTS public.venue_class_sessions;
DROP TABLE IF EXISTS public.venue_class_series;
DROP TABLE IF EXISTS public.venue_class_types;

-- Restore venue_charges.source_type without 'class'
ALTER TABLE public.venue_charges DROP CONSTRAINT venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD  CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment','fee','membership','merchandise']));

SELECT pg_notify('pgrst', 'reload schema');
