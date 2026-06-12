-- 271_membership_fee_core_down.sql — reverse of 271.

DROP FUNCTION IF EXISTS public.run_membership_renewals();
DROP FUNCTION IF EXISTS public.venue_list_fee_plans(text);
DROP FUNCTION IF EXISTS public.venue_list_membership_tiers(text,boolean);
DROP FUNCTION IF EXISTS public.venue_list_members(text);
DROP FUNCTION IF EXISTS public.venue_cancel_fee(text,uuid);
DROP FUNCTION IF EXISTS public.venue_enrol_fee(text,uuid,text,text);
DROP FUNCTION IF EXISTS public.venue_create_fee_plan(text,text,int,text,text);
DROP FUNCTION IF EXISTS public.venue_cancel_membership(text,uuid,boolean);
DROP FUNCTION IF EXISTS public.venue_freeze_membership(text,uuid,date);
DROP FUNCTION IF EXISTS public.venue_enrol_membership(text,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.venue_update_membership_tier(text,uuid,text,jsonb,boolean,jsonb);
DROP FUNCTION IF EXISTS public.venue_create_membership_tier(text,text,jsonb,jsonb);

DROP TABLE IF EXISTS public.venue_fee_subscriptions;
DROP TABLE IF EXISTS public.venue_fee_plans;
DROP TABLE IF EXISTS public.venue_memberships;
DROP TABLE IF EXISTS public.venue_tier_prices;
DROP TABLE IF EXISTS public.venue_membership_tiers;

DROP FUNCTION IF EXISTS public._membership_period_interval(text);

-- restore the pre-membership source_type CHECK
ALTER TABLE public.venue_charges DROP CONSTRAINT IF EXISTS venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment']));
