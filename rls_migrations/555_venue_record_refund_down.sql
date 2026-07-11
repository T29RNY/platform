-- 555 DOWN: drop the manual refund recorder. (No prior version — this is a new RPC.)
DROP FUNCTION IF EXISTS public.venue_record_refund(text, uuid, integer, text, text);
