-- 173_hq_analytics_rpcs_down.sql — revert mig 173.
DROP FUNCTION IF EXISTS public.hq_set_dashboard_config(text, jsonb);
DROP FUNCTION IF EXISTS public.hq_get_analytics(text, date, date);
