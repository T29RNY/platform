-- 596_club_leads_and_anon_trial_plumbing_down.sql
-- Reverses 596_club_leads_and_anon_trial_plumbing.sql.
--
-- ⚠️ DROPS club_leads AND EVERY LEAD IN IT. Leads are prospective parents who typed their
-- details into DF's public page — they are not reconstructible from anywhere else. Before
-- running this, check whether any exist and export them if so:
--     SELECT count(*), min(created_at), max(created_at) FROM public.club_leads;
-- The audit_events rows ('club_lead_captured') survive this and preserve the fact + the
-- parent's email, but NOT the child details. That asymmetry matters if this down is ever
-- run to service an erasure request: dropping the table does NOT erase the parent's email.
--
-- No CASCADE, deliberately: if a future migration adds an FK to club_leads, this DROP should
-- fail loudly rather than silently cascade away someone else's rows.
--
-- Safe to run standalone: 596 added only new objects, so nothing here touches 587-590 or
-- any pre-existing RPC. No ordering constraint against other migrations.

BEGIN;

DROP FUNCTION IF EXISTS public.club_list_trial_sessions(text);
DROP FUNCTION IF EXISTS public.club_capture_lead(text, text, text, text, text, date);

DROP INDEX IF EXISTS public.club_leads_club_email_created_idx;
DROP TABLE IF EXISTS public.club_leads;

COMMIT;
