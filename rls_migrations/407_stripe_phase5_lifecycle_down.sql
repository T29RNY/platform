-- 407_stripe_phase5_lifecycle_down.sql — reverse of 407.
-- All four functions are NEW in Phase 5 (no prior overload to restore), so a clean DROP.
DROP FUNCTION IF EXISTS public.venue_price_change_preview(text,text,text,int,date);
DROP FUNCTION IF EXISTS public.venue_bulk_price_change_commit(text,text,text,int,date,uuid[]);
DROP FUNCTION IF EXISTS public.stripe_set_membership_price(uuid,int,text);
DROP FUNCTION IF EXISTS public.venue_refund_charge_resolve(text,uuid);

SELECT pg_notify('pgrst', 'reload schema');
