-- 423_operator_create_room_pt_down.sql
-- Reverse 423: drop the two operator create-from-calendar RPCs.

DROP FUNCTION IF EXISTS public.venue_create_room_hire(text,uuid,timestamptz,timestamptz,text,int,text,text,text,int,int,uuid);
DROP FUNCTION IF EXISTS public.venue_create_appointment(text,uuid,uuid,timestamptz,timestamptz,int);

SELECT pg_notify('pgrst', 'reload schema');
