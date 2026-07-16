-- 591 DOWN: reverse the admin debt chase DB surface.
--
-- Safe to run at any point while PR #1 is the only thing landed: the whole surface is
-- DARK (nothing calls admin_chase_payment until PR #2 wires the button), and the RPC
-- is comms-only — it never wrote to payment_ledger or players.owes, so there is no
-- money state to unwind.
--
-- ⚠️ NOT safe once PR #5 / PR #6 have repointed mig 472's casual.chase_payment and
-- notify.js's debtReminder cron at _team_debtors. Dropping this function would then
-- break the live weekly cron. Reverse those first, or this down-migration takes the
-- chase paths with it.
--
-- notification_log rows of type 'adminChasePayment' and audit_events rows of action
-- 'admin_chase_payment_sent' are deliberately LEFT IN PLACE: both are append-only
-- audit trails (audit_events has no DELETE policy by design — mig 003), and deleting
-- the evidence that a chase happened is not a schema rollback.

DROP FUNCTION IF EXISTS public.admin_chase_payment(text, boolean);
DROP FUNCTION IF EXISTS public._team_debtors(text);
DROP TABLE    IF EXISTS public.platform_config;
