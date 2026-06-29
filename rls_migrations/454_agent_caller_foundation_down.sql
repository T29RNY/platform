-- Down migration 454 — agent_caller_foundation
-- Reverses 454 in dependency-safe order: function first, then table.
-- The table drop removes its RLS policy and all grants with it.

DROP FUNCTION IF EXISTS public.resolve_agent_caller(jsonb);

-- policy + grants drop together with the table
DROP TABLE IF EXISTS public.ai_agent_access;

SELECT pg_notify('pgrst', 'reload schema');
