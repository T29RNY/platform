-- 490_self_serve_enter_result_down.sql
-- Reverses 490_self_serve_enter_result.sql.

DROP FUNCTION IF EXISTS public.self_serve_enter_result(text, uuid, integer, integer);
