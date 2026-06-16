-- 337_gocardless_phases_5_to_8_down.sql
--
-- Reverts migration 337: GoCardless Phases 5–8.
-- Drops RPCs, removes columns, drops the partial unique index.
-- Safe to run only if no gc_mandate_id / gc_event_id values are in use.

-- ── RPCs ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.set_venue_gc_connect_state(text, text, text, text);
DROP FUNCTION IF EXISTS public.venue_gc_disconnect(text);
DROP FUNCTION IF EXISTS public.gc_complete_member_enrolment(text, text, text, uuid, text, uuid, integer);
DROP FUNCTION IF EXISTS public.apply_gc_payment_status(text, text);
DROP FUNCTION IF EXISTS public.record_gc_event(text, text, text, text, integer, jsonb);
DROP FUNCTION IF EXISTS public.mark_gc_event_processed(text, text, text);

-- ── billing_events ───────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.billing_events_gc_event_id_key;
ALTER TABLE public.billing_events DROP COLUMN IF EXISTS gc_event_id;

-- ── venue_memberships ────────────────────────────────────────────────────────
ALTER TABLE public.venue_memberships DROP COLUMN IF EXISTS gc_mandate_id;
ALTER TABLE public.venue_memberships DROP COLUMN IF EXISTS gc_customer_id;

-- Note: get_venue_signup_tiers is a CREATE OR REPLACE — revert by restoring
-- the previous version from mig 332 if needed. Not dropped here to avoid
-- breaking the member enrolment UI.
