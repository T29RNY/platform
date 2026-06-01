-- Down for migration 188 — drop the bracket read RPC.
DROP FUNCTION IF EXISTS public.get_cup_bracket(uuid);
