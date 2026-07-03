-- 474_reconcile_migration_source_drift_down.sql
--
-- Nothing to roll back. This migration only added a source-file record of
-- functions that were already live (pure documentation, CREATE OR REPLACE
-- with identical bodies) — it made no behavioural change to the database.
-- Rolling it back would mean deleting the source file, not touching the DB.
SELECT 1;
