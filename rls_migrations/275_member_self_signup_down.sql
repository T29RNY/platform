-- 275_member_self_signup_down.sql — reverse of 275_member_self_signup.sql
DROP FUNCTION IF EXISTS public.venue_approve_customer(text,uuid,boolean);
DROP FUNCTION IF EXISTS public.member_self_signup(text,text,text,text,text,boolean);
-- notify_venue_change whitelist revert is a no-op (extra reasons are harmless);
-- left as-is to avoid clobbering a newer revision.
-- Revert status CHECK (any 'pending' rows must be resolved first).
ALTER TABLE public.venue_customers DROP CONSTRAINT IF EXISTS venue_customers_status_check;
ALTER TABLE public.venue_customers ADD CONSTRAINT venue_customers_status_check
  CHECK (status IN ('active','archived','erased'));
