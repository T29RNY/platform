-- 163_notification_log_channel.sql
-- League Mode Phase 9 Cycle 9.1 — multi-channel notification logging.
--
-- notification_log historically logged web-push only, keyed loosely by
-- (team_id, type, game_date). Cycle 9.1 adds email (Resend) as a second channel for
-- onboarding/ops notifications whose recipients are emails, not players. These three
-- additive nullable columns let an email send be logged, deduped, and audited
-- ("did the approval email go out?") without disturbing the push path:
--   channel   — 'push' | 'email' (NULL on legacy push rows; push path unchanged)
--   entity_id — the audit_events entity the email is about (competition_team_id / fixture_id)
--   recipient — the email address the message went to
-- Dedup for email = (type, entity_id, recipient) WHERE channel='email' AND sent_at NOT NULL.

ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS channel   text NULL,
  ADD COLUMN IF NOT EXISTS entity_id text NULL,
  ADD COLUMN IF NOT EXISTS recipient text NULL;

CREATE INDEX IF NOT EXISTS notification_log_email_dedup_idx
  ON public.notification_log (type, entity_id, recipient)
  WHERE channel = 'email';
