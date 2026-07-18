-- 604_df_landing_and_pa_money_reconcile_down.sql — reverses 604.
DELETE FROM public.venue_payments
WHERE note = 'demo seed reconcile (mig 604): paid charge missing payment row';
DELETE FROM public.invite_links WHERE code = 'q_dfterm7k2xq9';
