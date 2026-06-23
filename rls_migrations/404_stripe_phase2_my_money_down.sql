-- 404_stripe_phase2_my_money_down.sql
-- Reverse mig 404: drop the read-only unified money resolver. No data touched (read-only RPC).
DROP FUNCTION IF EXISTS public.get_my_money();
SELECT pg_notify('pgrst', 'reload schema');
