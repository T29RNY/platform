-- 163_notification_log_channel_down.sql — revert mig 163.
DROP INDEX IF EXISTS public.notification_log_email_dedup_idx;
ALTER TABLE public.notification_log DROP COLUMN IF EXISTS channel;
ALTER TABLE public.notification_log DROP COLUMN IF EXISTS entity_id;
ALTER TABLE public.notification_log DROP COLUMN IF EXISTS recipient;
