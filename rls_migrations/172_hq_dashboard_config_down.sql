-- 172_hq_dashboard_config_down.sql — revert mig 172.
ALTER TABLE public.company_admins DROP COLUMN IF EXISTS dashboard_config;
