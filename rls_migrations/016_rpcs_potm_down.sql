-- ============================================================
-- Migration 016 rollback: POTM admin RPCs
-- ============================================================

DROP FUNCTION IF EXISTS get_potm_tally(text, text);
DROP FUNCTION IF EXISTS admin_close_potm_voting(text, text, text, boolean);
DROP FUNCTION IF EXISTS admin_open_potm_voting(text, text, timestamptz, int);