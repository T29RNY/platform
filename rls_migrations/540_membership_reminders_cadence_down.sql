-- 540_membership_reminders_cadence_down.sql — restore the pre-540 (mig 276) reader:
-- no reminder_stage; payment_due fires once when due_date <= current_date.

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
           NULL::text AS pay_url
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.started_at >= current_date - 1
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'renewal_due', m.id::text || ':' || m.renews_at::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.renews_at::text, m.pass_token,
           NULL::text
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.renews_at BETWEEN current_date AND current_date + 7
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'freeze_ending', m.id::text || ':' || m.frozen_until::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.frozen_until::text, m.pass_token,
           NULL::text
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'paused' AND m.frozen_until IS NOT NULL
       AND m.frozen_until BETWEEN current_date AND current_date + 3
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'payment_due', ch.id::text,
           c.email, c.first_name, vn.name, t.name, ch.amount_due_pence, m.period, ch.due_date::text, m.pass_token,
           vn.payment_link
      FROM public.venue_charges ch
      JOIN public.venue_memberships m      ON m.id = split_part(ch.source_id, ':', 1)::uuid
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE ch.source_type = 'membership' AND ch.status IN ('unpaid','partial')
       AND ch.due_date IS NOT NULL AND ch.due_date <= current_date
       AND ch.pay_url IS NULL
       AND m.status IN ('active','ending')
       AND c.email IS NOT NULL AND c.status <> 'erased'
  )
  SELECT jsonb_build_object('ok', true, 'reminders', COALESCE(jsonb_agg(to_jsonb(base)), '[]'::jsonb))
    FROM base;
$function$;

REVOKE ALL ON FUNCTION public.get_membership_reminders_due() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_membership_reminders_due() TO service_role;
