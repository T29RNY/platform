-- 358_pt_appointments_down.sql — reverse of 358_pt_appointments.sql
DROP FUNCTION IF EXISTS public.member_list_my_appointments(text);
DROP FUNCTION IF EXISTS public.venue_mark_appointment_completed(text, uuid, boolean);
DROP FUNCTION IF EXISTS public.venue_pt_checkin(text, uuid, text);
DROP FUNCTION IF EXISTS public.member_cancel_appointment(uuid);
DROP FUNCTION IF EXISTS public.member_book_appointment(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.member_list_trainer_slots(uuid, date, date);
DROP FUNCTION IF EXISTS public.member_list_trainers(text);
DROP FUNCTION IF EXISTS public.venue_list_appointments(text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.venue_list_trainers(text);
DROP FUNCTION IF EXISTS public.venue_set_trainer_availability(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.venue_upsert_trainer(text, uuid, text, text, uuid, int, int, int, boolean, boolean);

DROP TABLE IF EXISTS public.venue_appointments;
DROP TABLE IF EXISTS public.venue_trainer_availability;
DROP TABLE IF EXISTS public.venue_trainers;

-- restore the pre-358 venue_charges source_type allow-list (drop 'pt')
ALTER TABLE public.venue_charges DROP CONSTRAINT venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment','fee','membership',
                                  'merchandise','class','room_hire','class_package']));
