-- Migration 004: Add live_channel_key to teams.
-- live_channel_key is a non-guessable UUID used as the realtime broadcast
-- channel suffix. Format: team_live:<live_channel_key>
-- Returned only by token-validating RPCs after authorisation.
-- Existing rows are backfilled before the NOT NULL constraint is applied.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS live_channel_key text UNIQUE DEFAULT gen_random_uuid()::text;

-- Backfill any rows that existed before this migration ran.
-- The DEFAULT clause populates new rows going forward; existing rows need
-- an explicit UPDATE because DEFAULT does not apply retroactively.
UPDATE teams
  SET live_channel_key = gen_random_uuid()::text
  WHERE live_channel_key IS NULL;

-- Lock the column to NOT NULL now that all rows are populated.
ALTER TABLE teams
  ALTER COLUMN live_channel_key SET NOT NULL;