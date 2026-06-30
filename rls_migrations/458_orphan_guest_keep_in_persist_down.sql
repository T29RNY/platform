-- DOWN 458: reverse the orphan-guest keep-in persistence.
--
-- Drops the new RPC and the column. The three CREATE OR REPLACE'd functions
-- (get_team_state_by_admin_token, admin_go_live, admin_go_live_for_team) are
-- NOT restored here: their only change was an additive reference to
-- host_dropout_ack. Dropping the column below would break them, so the column
-- drop uses CASCADE-free ordering — restore the prior function bodies from
-- migration history (live body captured pre-458) BEFORE dropping the column if
-- a true rollback is needed. For a forward-only fix this down file is a record.

DROP FUNCTION IF EXISTS public.admin_ack_orphan_guest(text, text);

-- NOTE: dropping the column requires the three functions above to no longer
-- reference it. If rolling back, re-apply the pre-458 bodies first, then:
-- ALTER TABLE public.players DROP COLUMN IF EXISTS host_dropout_ack;

SELECT pg_notify('pgrst', 'reload schema');
