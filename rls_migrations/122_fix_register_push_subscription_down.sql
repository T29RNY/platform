-- 120_fix_register_push_subscription_down.sql
-- Reverts to the broken RPC body and removes the UNIQUE constraint.
-- The pre-120 RPC could never succeed, so reverting has no recovered
-- behaviour — this is for migration-history completeness only.

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_player_id_key;

-- (Not restoring the broken pre-120 RPC body.)
