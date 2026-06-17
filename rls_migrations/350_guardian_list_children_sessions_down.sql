-- Down migration 350 — drop the guardian children-sessions feed RPC.
DROP FUNCTION IF EXISTS public.guardian_list_children_sessions();
