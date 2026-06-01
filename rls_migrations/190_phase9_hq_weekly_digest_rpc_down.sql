-- Down for mig 190 — drop the service-role HQ digest analytics RPC.
DROP FUNCTION IF EXISTS public.hq_get_analytics_for_company(text, date, date);
