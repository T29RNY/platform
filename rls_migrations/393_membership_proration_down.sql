-- 393_membership_proration_down.sql — revert Phase 5 pro-rating.
-- Restores the mig-291 / 297 / 331 function bodies and drops the new columns +
-- helper. (Run only if Phase 5 must be fully backed out.)

-- 1. Restore venue create/update tier RPCs to their mig-291 signatures.
DROP FUNCTION IF EXISTS public.venue_create_membership_tier(text,text,jsonb,jsonb,text,text,date,date,text,int);
DROP FUNCTION IF EXISTS public.venue_update_membership_tier(text,uuid,text,jsonb,boolean,jsonb,text,text,date,date,text,int);
-- NOTE: re-apply migration 291 sections 4 + 5 to restore the 8-arg / 10-arg forms.

-- 2. Restore get_venue_signup_tiers / member_enrol_membership /
--    stripe_complete_member_enrolment to their mig-331 / 297 bodies.
-- NOTE: re-apply migration 331 (sections 3 + 5) and migration 297
--       (member_enrol_membership) to restore the pre-proration bodies.

-- 3. Drop the helper + columns.
DROP FUNCTION IF EXISTS public._prorated_first_charge(int,text,date,date,date);

ALTER TABLE public.venue_membership_tiers
  DROP CONSTRAINT IF EXISTS vmt_proration_basis_check,
  DROP CONSTRAINT IF EXISTS vmt_joining_fee_nonneg;

ALTER TABLE public.venue_membership_tiers
  DROP COLUMN IF EXISTS proration_basis,
  DROP COLUMN IF EXISTS joining_fee_pence;

SELECT pg_notify('pgrst', 'reload schema');
