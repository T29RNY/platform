-- ════════════════════════════════════════════════════════════════════════════
-- 064 DOWN — drop log_app_boot RPC
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.log_app_boot(text, text, text, boolean);

SELECT pg_notify('pgrst', 'reload schema');
