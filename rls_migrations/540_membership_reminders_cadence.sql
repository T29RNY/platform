-- 540_membership_reminders_cadence.sql — P11a: payment-reminder cadence + offset-aware dedup.
--
-- get_membership_reminders_due (mig 276) previously fired a membership PAYMENT reminder ONCE,
-- when the charge first hit due_date <= current_date (entity_key = ch.id → the notification_log
-- dedup then suppressed every later day). P11 gives a real cadence: fire at due−7, due−1, due−0,
-- and one overdue nudge — each EXACTLY ONCE. The mechanism is an OFFSET-AWARE entity_key:
--   entity_key = ch.id || ':' || reminder_stage   (stage ∈ due_7 | due_1 | due_0 | overdue)
-- so the existing per-(type, entity_key, recipient, channel) notification_log dedup naturally
-- fires each stage once and never repeats it. A new `reminder_stage` field lets the mailer (and
-- the P11b push channel) vary the copy ("due next week" / "tomorrow" / "today" / "overdue").
--
-- ADDITIVE to the return shape (+reminder_stage on every reminder; NULL for the non-payment
-- kinds). The other three arms (welcome / renewal_due / freeze_ending) are byte-unchanged except
-- for the new trailing NULL column. Stripe-invoiced charges still never reach here (pay_url IS NULL
-- gate — Stripe owns their dunning). SQL STABLE SECDEF, search_path pinned. Same signature/grants.

CREATE OR REPLACE FUNCTION public.get_membership_reminders_due()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT 'welcome'::text AS kind,
           m.id::text AS entity_key,
           c.email, c.first_name, vn.name AS venue_name, t.name AS tier_name,
           m.amount_pence, m.period, m.started_at::text AS date_label, m.pass_token,
           NULL::text AS pay_url, NULL::text AS reminder_stage
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.started_at >= current_date - 1
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'renewal_due', m.id::text || ':' || m.renews_at::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.renews_at::text, m.pass_token,
           NULL::text, NULL::text
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.renews_at BETWEEN current_date AND current_date + 7
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'freeze_ending', m.id::text || ':' || m.frozen_until::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.frozen_until::text, m.pass_token,
           NULL::text, NULL::text
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'paused' AND m.frozen_until IS NOT NULL
       AND m.frozen_until BETWEEN current_date AND current_date + 3
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    -- payment_due — cadence: fire at due−7, due−1, due−0, and once when it first goes overdue.
    -- offset-aware entity_key = ch.id:stage → each stage dedups to exactly one send.
    SELECT 'payment_due',
           ch.id::text || ':' || (CASE WHEN ch.due_date < current_date THEN 'overdue'
                                       ELSE 'due_' || (ch.due_date - current_date)::text END),
           c.email, c.first_name, vn.name, t.name, ch.amount_due_pence, m.period, ch.due_date::text, m.pass_token,
           vn.payment_link,
           (CASE WHEN ch.due_date < current_date THEN 'overdue'
                 ELSE 'due_' || (ch.due_date - current_date)::text END)
      FROM public.venue_charges ch
      JOIN public.venue_memberships m      ON m.id = split_part(ch.source_id, ':', 1)::uuid
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE ch.source_type = 'membership' AND ch.status IN ('unpaid','partial')
       AND ch.due_date IS NOT NULL
       AND ((ch.due_date - current_date) IN (7, 1, 0) OR ch.due_date < current_date)
       AND ch.pay_url IS NULL
       AND m.status IN ('active','ending')
       AND c.email IS NOT NULL AND c.status <> 'erased'
  )
  SELECT jsonb_build_object('ok', true, 'reminders', COALESCE(jsonb_agg(to_jsonb(base)), '[]'::jsonb))
    FROM base;
$function$;

-- Defense-in-depth (feedback_default_privileges_revoke): this reader returns customer emails +
-- payment amounts and is called ONLY by the service-role cron. CREATE OR REPLACE preserves the
-- live ACL (already service_role-only), but a future drop+recreate from this file alone would
-- let Supabase default privileges auto-grant anon+authenticated. Pin it explicitly.
REVOKE ALL ON FUNCTION public.get_membership_reminders_due() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_membership_reminders_due() TO service_role;
