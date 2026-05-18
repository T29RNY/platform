-- Rollback for migration 004.
--
-- WARNING: Rolling back this migration will break any client code that
-- subscribes to team_live:<live_channel_key> channels or any RPC that
-- reads or returns live_channel_key. Clients will need to be redeployed
-- against a pre-004 state before or immediately after this rollback runs.
-- Do not run this rollback in production while active clients are connected.

ALTER TABLE teams
  DROP COLUMN IF EXISTS live_channel_key;