-- 489_self_serve_create_tournament_down.sql
-- Reverses 489_self_serve_create_tournament.sql.
--
-- NOTE: the additive columns are left in place by default (dropping a column that
-- self-serve rows depend on would orphan data). Uncomment the column drops only
-- for a clean rollback where no self-serve tournament rows exist.

DROP FUNCTION IF EXISTS public.self_serve_create_tournament(text, text, text, date);

-- self_serve_create_venue was re-created with an `is_personal_host = false`
-- clause on its abuse cap. To fully revert the venue RPC to its mig-484 form,
-- re-apply 484_self_serve_create_venue.sql (the clause is harmless while the
-- is_personal_host column still exists, so this is only needed for a clean
-- pre-489 restore).

-- Column/index rollback — destructive, only for a no-self-serve-data reset:
-- DROP INDEX IF EXISTS public.tournament_events_created_by_user_idx;
-- DROP INDEX IF EXISTS public.venues_is_personal_host_idx;
-- ALTER TABLE public.tournament_events DROP COLUMN IF EXISTS sport;
-- ALTER TABLE public.tournament_events DROP COLUMN IF EXISTS origin;
-- ALTER TABLE public.tournament_events DROP COLUMN IF EXISTS created_by_user;
-- ALTER TABLE public.venues DROP COLUMN IF EXISTS is_personal_host;
