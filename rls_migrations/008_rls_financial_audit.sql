-- ============================================================
-- Migration 008: RLS — financial tables (payment_ledger, notification_log)
-- Phase B: design-only; run in Phase C after 001–007 are applied
-- Depends on: 001 (helpers), 002 (team_admins), 006 (players RLS)
-- ============================================================

-- ── Pre-flight: idempotent CHECK constraint updates ─────────────────────────
-- payment_ledger.type may lack 'cancelled'/'refunded' values in the live DB.
-- Drop-and-replace is safe because no code path writes those values yet.

ALTER TABLE payment_ledger
  DROP CONSTRAINT IF EXISTS payment_ledger_type_check;

ALTER TABLE payment_ledger
  ADD CONSTRAINT payment_ledger_type_check
  CHECK (type IN ('game_fee','guest_fee','debt_payment','waiver','refund','cancelled'));

ALTER TABLE payment_ledger
  DROP CONSTRAINT IF EXISTS payment_ledger_status_check;

ALTER TABLE payment_ledger
  ADD CONSTRAINT payment_ledger_status_check
  CHECK (status IN ('paid','unpaid','waived','disputed','refunded','cancelled'));

-- ── payment_ledger ───────────────────────────────────────────────────────────
-- Access: authenticated player sees own rows; authenticated team admin sees all
-- rows for their team.  No anonymous access.  No INSERT/UPDATE/DELETE from
-- client roles — mutations via SECURITY DEFINER RPCs only.

ALTER TABLE payment_ledger ENABLE ROW LEVEL SECURITY;

-- Strip all direct-access grants first so the REVOKE below is authoritative.
REVOKE ALL ON payment_ledger FROM anon;
REVOKE ALL ON payment_ledger FROM authenticated;

-- SELECT: own ledger row  OR  admin of the row's team
CREATE POLICY "own_or_admin_select_payment_ledger"
  ON payment_ledger
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM players p
      WHERE  p.id      = payment_ledger.player_id
      AND    p.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM team_admins ta
      WHERE  ta.team_id    = payment_ledger.team_id
      AND    ta.user_id    = auth.uid()
      AND    ta.revoked_at IS NULL
    )
  );

-- Grant SELECT back after REVOKE so the policy can fire.
GRANT SELECT ON payment_ledger TO authenticated;

-- ── notification_log ─────────────────────────────────────────────────────────
-- Internal delivery audit trail; no client role should read or write it.
-- All access is via SECURITY DEFINER RPCs running as postgres.

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON notification_log FROM anon;
REVOKE ALL ON notification_log FROM authenticated;

-- No policies created — zero-access by design.
-- (RLS enabled + no policies = implicit DENY for every role.)

-- ── Deployment order note ────────────────────────────────────────────────────
-- Run AFTER: 001, 002, 003, 006 (team_admins and players must exist and be RLS-locked)
-- Run BEFORE: any RPC migration that writes to payment_ledger (014)

-- ── Verification ─────────────────────────────────────────────────────────────
-- After applying, confirm in psql / Supabase SQL editor:

-- 1. RLS enabled on both tables:
--    SELECT tablename, rowsecurity
--    FROM   pg_tables
--    WHERE  schemaname = 'public'
--    AND    tablename  IN ('payment_ledger','notification_log');
--    → rowsecurity = true for both

-- 2. Policies present only on payment_ledger:
--    SELECT tablename, policyname, roles, cmd
--    FROM   pg_policies
--    WHERE  schemaname = 'public'
--    AND    tablename  IN ('payment_ledger','notification_log');
--    → 1 row: payment_ledger | own_or_admin_select_payment_ledger | {authenticated} | SELECT
--    → 0 rows for notification_log

-- 3. Grants:
--    SELECT grantee, privilege_type
--    FROM   information_schema.role_table_grants
--    WHERE  table_schema = 'public'
--    AND    table_name   IN ('payment_ledger','notification_log')
--    AND    grantee      IN ('anon','authenticated');
--    → 1 row: authenticated | SELECT on payment_ledger
--    → 0 rows on notification_log

-- 4. Smoke test (run as an authenticated user whose player row has user_id set):
--    SELECT count(*) FROM payment_ledger;
--    → returns only rows for that player's player_id, or rows in teams they admin

-- 5. Anon total-block:
--    SET LOCAL role = anon;
--    SELECT * FROM payment_ledger LIMIT 1;
--    → ERROR: permission denied for table payment_ledger

-- ── Open issues ──────────────────────────────────────────────────────────────
-- OI-09 (carried from Prompt 4): Verify exact existing CHECK constraint names
--   on payment_ledger before Phase C apply — use:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM   pg_constraint
--   WHERE  conrelid = 'payment_ledger'::regclass AND contype = 'c';
--   Names used above ('payment_ledger_type_check', 'payment_ledger_status_check')
--   are the Supabase-generated defaults; adjust DROP CONSTRAINT names if different.

-- OI-24 (new): notification_log schema not confirmed from live supabase.js
--   patterns. Assumption: has a team_id column (for future partial index).
--   Verify: \d notification_log in psql before Phase C apply.
--   If no team_id column exists, no index to add — RLS enable + REVOKE is
--   still correct.

-- OI-25 (new): payment_ledger.team_id nullability — if team_id can be NULL for
--   any legacy rows, the admin policy arm silently excludes those rows (EXISTS
--   returns false for NULL team_id). Verify: SELECT count(*) FROM payment_ledger
--   WHERE team_id IS NULL; If non-zero, decide: backfill team_id from players
--   table OR accept that admins can't see them (likely correct for orphan rows).