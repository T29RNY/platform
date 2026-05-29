-- 175_hq_preview_token_down.sql — revert mig 175.
DROP FUNCTION IF EXISTS public.get_hq_preview_state(text);
DROP FUNCTION IF EXISTS public.hq_generate_preview_token(text);
