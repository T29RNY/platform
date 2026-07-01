-- 461 DOWN: drop admin_settle_player. NOTE: the one-off phantom-row DELETE and any
-- settlements this RPC performed are NOT reversed (they are correct data operations).
-- After reverting, the player-level "claims paid · CONFIRM" falls back to the JS wiring
-- of the moment (confirm-active-match), which is the buggy behaviour this migration fixed.
DROP FUNCTION IF EXISTS public.admin_settle_player(text, text);

SELECT pg_notify('pgrst', 'reload schema');
