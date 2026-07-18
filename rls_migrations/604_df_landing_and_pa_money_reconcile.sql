-- 604_df_landing_and_pa_money_reconcile.sql
-- Demo-prep data (operator: "resolve the 3", 2026-07-17).
--
-- (A) DF Sports venue-landing /q code. DF's £80 Term tier was published (mig 602) but had
--     no invite_links 'venue_landing' row, so it had no public /q page a parent could reach.
--     This adds one (entity_type='venue', matching PA's q_L8hbfm3fXy4 shape).
--
-- (B) Reconcile PA's demo money. 24 membership charges are status='paid' but have NO
--     venue_payments row, so the Payments-tab due-minus-paid aggregate over-counted them as
--     outstanding (~£1,175) while the true status-based outstanding is ~£750 — the new
--     members-list balance (status-based) and the Payments total disagreed. Add a matching
--     'cash' payment for each already-'paid' charge so paid charges are genuinely paid and
--     the two surfaces agree. Idempotent (skips charges that already have a payment).

-- (A)
INSERT INTO public.invite_links (code, entity_type, entity_id, action, active)
VALUES ('q_dfterm7k2xq9', 'venue', 'v_ffff5528a0', 'venue_landing', true)
ON CONFLICT (code) DO NOTHING;

-- (B)
INSERT INTO public.venue_payments (charge_id, amount_pence, method, kind, note)
SELECT ch.id, ch.amount_due_pence, 'cash', 'payment',
       'demo seed reconcile (mig 604): paid charge missing payment row'
FROM public.venue_charges ch
WHERE ch.venue_id = 'pa_peugeot'
  AND ch.source_type = 'membership'
  AND ch.status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM public.venue_payments vp
    WHERE vp.charge_id = ch.id AND vp.kind = 'payment' AND vp.voided_at IS NULL);
