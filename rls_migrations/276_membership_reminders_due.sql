-- 276_membership_reminders_due.sql
--
-- Phase 6 — automated membership reminders (the read half). A service_role-only
-- reader the `membershipRemindersJob` cron calls daily; it returns the set of
-- reminders that are due RIGHT NOW across four kinds:
--   • welcome        — membership started in the last day
--   • renewal_due    — active membership renewing within 7 days
--   • freeze_ending  — frozen membership thawing within 3 days
--   • payment_due    — an unpaid/partial membership charge at/over its due date
-- The cron does the actual sending (Resend) + dedupe (notification_log), so this
-- function never writes. Members with no email on file are skipped. Each row
-- carries a stable `entity_key` the cron dedupes on (so a daily run never double-
-- sends within a cycle). Membership charges are joined back to the membership via
-- the `<membership_id>:<period_date>` source_id encoding (mig 271).

CREATE OR REPLACE FUNCTION public.get_membership_reminders_due()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  WITH base AS (
    -- welcome: just started, active
    SELECT 'welcome'::text AS kind,
           m.id::text AS entity_key,
           c.email, c.first_name, vn.name AS venue_name, t.name AS tier_name,
           m.amount_pence, m.period, m.started_at::text AS date_label, m.pass_token
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.started_at >= current_date - 1
       AND c.email IS NOT NULL AND c.status <> 'erased'

    UNION ALL
    -- renewal due within 7 days
    SELECT 'renewal_due', m.id::text || ':' || m.renews_at::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.renews_at::text, m.pass_token
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.renews_at BETWEEN current_date AND current_date + 7
       AND c.email IS NOT NULL AND c.status <> 'erased'

    UNION ALL
    -- freeze ending within 3 days
    SELECT 'freeze_ending', m.id::text || ':' || m.frozen_until::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.frozen_until::text, m.pass_token
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'paused' AND m.frozen_until IS NOT NULL
       AND m.frozen_until BETWEEN current_date AND current_date + 3
       AND c.email IS NOT NULL AND c.status <> 'erased'

    UNION ALL
    -- payment due/overdue: an unpaid or partial membership charge at/over its due date
    SELECT 'payment_due', ch.id::text,
           c.email, c.first_name, vn.name, t.name, ch.amount_due_pence, m.period, ch.due_date::text, m.pass_token
      FROM public.venue_charges ch
      JOIN public.venue_memberships m      ON m.id = split_part(ch.source_id, ':', 1)::uuid
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE ch.source_type = 'membership' AND ch.status IN ('unpaid','partial')
       AND ch.due_date IS NOT NULL AND ch.due_date <= current_date
       AND m.status IN ('active','ending')
       AND c.email IS NOT NULL AND c.status <> 'erased'
  )
  SELECT jsonb_build_object('ok', true, 'reminders', COALESCE(jsonb_agg(to_jsonb(base)), '[]'::jsonb))
    FROM base;
$fn$;
-- service_role ONLY — this returns member PII (emails). REVOKE from anon/authenticated
-- explicitly: Supabase default privileges auto-grant EXECUTE to them, so a bare
-- REVOKE … FROM PUBLIC is not enough (same fix applied to run_membership_renewals).
REVOKE ALL ON FUNCTION public.get_membership_reminders_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_membership_reminders_due() TO service_role;
