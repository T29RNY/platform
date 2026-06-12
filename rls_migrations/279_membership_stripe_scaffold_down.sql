-- 279_membership_stripe_scaffold_down.sql — reverse of 279_membership_stripe_scaffold.sql
DROP FUNCTION IF EXISTS public.venue_get_billing_status(text);
DROP FUNCTION IF EXISTS public.set_venue_connect_state(text,text,text,boolean,boolean);
DROP FUNCTION IF EXISTS public.apply_membership_subscription_status(text,text);
DROP FUNCTION IF EXISTS public.mark_stripe_event_processed(text,text,text);
DROP FUNCTION IF EXISTS public.record_stripe_event(text,text,text,text,int,jsonb);

ALTER TABLE public.billing_events
  DROP COLUMN IF EXISTS payload,
  DROP COLUMN IF EXISTS processed_at,
  DROP COLUMN IF EXISTS status;
ALTER TABLE public.billing_events DROP CONSTRAINT IF EXISTS billing_events_entity_type_check;
ALTER TABLE public.billing_events ADD CONSTRAINT billing_events_entity_type_check
  CHECK (entity_type IN ('venue','company'));

ALTER TABLE public.venue_memberships
  DROP COLUMN IF EXISTS payment_state,
  DROP COLUMN IF EXISTS stripe_price_id,
  DROP COLUMN IF EXISTS stripe_subscription_id;
ALTER TABLE public.venue_customers DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE public.venues
  DROP COLUMN IF EXISTS stripe_details_submitted,
  DROP COLUMN IF EXISTS stripe_charges_enabled,
  DROP COLUMN IF EXISTS stripe_connect_status,
  DROP COLUMN IF EXISTS stripe_connect_account_id;
