-- 121_notification_log_add_queue_columns.sql
-- notify.js has always written to two columns that don't exist in the
-- notification_log table: queued_for (timestamptz) and queued_payload
-- (jsonb). Both are needed for the quiet-hours queue/flush feature
-- (POST direct mode: queue if in quiet hours; flushQueue cron: drain
-- when queued_for has passed). Every INSERT silently failed, so
-- alreadySent never returned true, so autoOpen re-fired every 15 min
-- to anyone with a subscription.
--
-- This adds the two missing columns to match what notify.js expects.

ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS queued_for     timestamptz,
  ADD COLUMN IF NOT EXISTS queued_payload jsonb;
