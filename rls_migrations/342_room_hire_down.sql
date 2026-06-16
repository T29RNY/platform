-- 342_room_hire_down.sql — reverse Phase 5 (room hire).

DROP FUNCTION IF EXISTS public.member_list_my_room_hires(text);
DROP FUNCTION IF EXISTS public.member_list_hireable_spaces(text);
DROP FUNCTION IF EXISTS public.venue_record_hire_deposit(text,uuid,text);
DROP FUNCTION IF EXISTS public.venue_cancel_room_hire(text,uuid,text);
DROP FUNCTION IF EXISTS public.venue_confirm_room_hire(text,uuid,int,int);
DROP FUNCTION IF EXISTS public.venue_list_room_hires(text,text);
DROP FUNCTION IF EXISTS public.public_enquire_room_hire(uuid,text,text,text,timestamptz,timestamptz,text,int);
DROP FUNCTION IF EXISTS public.member_request_room_hire(uuid,timestamptz,timestamptz,text,int,uuid[]);

-- revert venue_charges source_type to the pre-342 set
ALTER TABLE public.venue_charges DROP CONSTRAINT IF EXISTS venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment','fee','membership','merchandise','class']));

DROP INDEX IF EXISTS public.equipment_bookings_room_hire_idx;
ALTER TABLE public.equipment_bookings DROP COLUMN IF EXISTS room_hire_id;

-- venue_room_hires last (equipment_bookings.room_hire_id FK references it)
DROP TABLE IF EXISTS public.venue_room_hires;

SELECT pg_notify('pgrst', 'reload schema');
