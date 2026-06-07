-- DOWN 217: drop the reactivate_guest_player RPC (S2). No data to restore — it
-- was additive (a new function); guests created/reactivated by it remain valid
-- persistent rows under the S1 dormant model.

DROP FUNCTION IF EXISTS public.reactivate_guest_player(text, text);

SELECT pg_notify('pgrst', 'reload schema');
