-- 560_coach_book_pitch_request_down.sql — reverse of 560.
-- 3a adds only two new functions and touches no shipped function, so the down is
-- a clean pair of DROPs. (No occupancy-trigger / bump-engine change to restore —
-- that is PR #3b, reversed by its own _down.)

DROP FUNCTION IF EXISTS public.club_manager_book_pitch(uuid,text,uuid,timestamptz,text,text,int,text,text,int,timestamptz);
DROP FUNCTION IF EXISTS public.club_manager_book_pitch_series(uuid,text,uuid,text,int,time,date,date,text,int,text,text,int);

SELECT pg_notify('pgrst', 'reload schema');
