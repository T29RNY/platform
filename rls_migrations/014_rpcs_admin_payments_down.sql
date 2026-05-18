-- ============================================================
-- Migration 014 rollback: Admin payment RPCs
-- ============================================================

DROP FUNCTION IF EXISTS admin_waive_debt(text, text, text);
DROP FUNCTION IF EXISTS admin_clear_debt(text, text);
DROP FUNCTION IF EXISTS admin_reset_payment(text, text, text);
DROP FUNCTION IF EXISTS admin_confirm_payment(text, text, text);