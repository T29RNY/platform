-- Down: remove the public POTM tally RPC.
DROP FUNCTION IF EXISTS public.get_potm_tally_public(text, text, text);

SELECT pg_notify('pgrst', 'reload schema');
