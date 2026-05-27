-- 121_notification_log_add_queue_columns_down.sql
ALTER TABLE notification_log
  DROP COLUMN IF EXISTS queued_for,
  DROP COLUMN IF EXISTS queued_payload;
