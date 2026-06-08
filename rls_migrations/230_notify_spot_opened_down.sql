-- Down for migration 230: remove the spot-opened notification trigger.
-- The set_config('inorout.bulk_reset', ...) line added to admin_go_live /
-- admin_go_live_for_team is left in place — it is a harmless no-op once the
-- trigger that reads the GUC is gone, so the go-live bodies are not rewritten here.

DROP TRIGGER IF EXISTS players_spot_opened_notify ON public.players;
DROP FUNCTION IF EXISTS public.notify_spot_opened();
