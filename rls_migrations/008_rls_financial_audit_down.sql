-- ============================================================
-- Rollback 008: undo financial table RLS
-- ============================================================

-- ── notification_log ─────────────────────────────────────────────────────────
ALTER TABLE notification_log DISABLE ROW LEVEL SECURITY;

GRANT ALL ON notification_log TO anon;
GRANT ALL ON notification_log TO authenticated;

-- ── payment_ledger ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "own_or_admin_select_payment_ledger" ON payment_ledger;

ALTER TABLE payment_ledger DISABLE ROW LEVEL SECURITY;

GRANT ALL ON payment_ledger TO anon;
GRANT ALL ON payment_ledger TO authenticated;

-- ── Revert CHECK constraints to pre-migration state ──────────────────────────
-- WARNING: Only run these if the original constraints used different value sets.
-- If the original constraints are unknown, skip the DROP+ADD and keep the wider
-- set — it is strictly additive (adds 'cancelled'/'refunded'; no valid rows
-- existed with those values before this migration).
--
-- To revert completely (if you know the original sets):
-- ALTER TABLE payment_ledger DROP CONSTRAINT IF EXISTS payment_ledger_type_check;
-- ALTER TABLE payment_ledger ADD CONSTRAINT payment_ledger_type_check
--   CHECK (type IN ('game_fee','guest_fee','debt_payment','waiver','refund'));
--
-- ALTER TABLE payment_ledger DROP CONSTRAINT IF EXISTS payment_ledger_status_check;
-- ALTER TABLE payment_ledger ADD CONSTRAINT payment_ledger_status_check
--   CHECK (status IN ('paid','unpaid','waived','disputed','refunded'));