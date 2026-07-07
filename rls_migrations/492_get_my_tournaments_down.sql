-- 492_get_my_tournaments_down.sql
-- Reverse of 492: drop the my-tournaments resolver.
DROP FUNCTION IF EXISTS public.get_my_tournaments();
