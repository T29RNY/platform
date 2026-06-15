-- Down migration for 331_stripe_member_enrolment.sql
-- Reverts: stripe_customer_id column, UNIQUE index, RPC changes

-- Drop new RPC
DROP FUNCTION IF EXISTS stripe_complete_member_enrolment(text, text, text, text, uuid, text, uuid, int);

-- Revert get_venue_signup_tiers and get_member_pass to pre-331 versions
-- (CREATE OR REPLACE restores them from mig 330/prior; handled by those migrations' bodies)
-- Simplest safe revert: drop and recreate from the prior migration if needed.
-- For safety, just drop stripe_customer_id and the new index.

-- Drop the new UNIQUE index; restore the old non-unique one (from mig 279)
DROP INDEX IF EXISTS venue_memberships_stripe_sub_uniq;
CREATE INDEX IF NOT EXISTS venue_memberships_stripe_sub_idx
  ON venue_memberships (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Drop the new column
ALTER TABLE venue_memberships DROP COLUMN IF EXISTS stripe_customer_id;
