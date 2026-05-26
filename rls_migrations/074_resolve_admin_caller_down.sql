-- 074_resolve_admin_caller_down.sql
--
-- Revert the resolve_admin_caller helper. Requires migration 075
-- to be reverted first (the sweep restores per-RPC resolvers), so
-- that nothing in pg_proc still references this helper.

DROP FUNCTION IF EXISTS public.resolve_admin_caller(text);
