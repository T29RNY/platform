-- 463 DOWN: drop the pending-claims banner RPCs. Any settlements they performed are
-- correct data and are NOT reversed.
DROP FUNCTION IF EXISTS public.admin_list_pending_claims(text);
DROP FUNCTION IF EXISTS public.admin_confirm_claims(text, text);

SELECT pg_notify('pgrst', 'reload schema');
