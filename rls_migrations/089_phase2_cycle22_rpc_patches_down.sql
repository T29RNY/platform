-- 089_phase2_cycle22_rpc_patches_down.sql
--
-- Restoring would re-introduce the bugs; nothing usefully reversible
-- here. Marker file to satisfy the down-mig requirement. If a true
-- revert is ever needed, drop the two functions and re-apply 086.

-- Intentional no-op.
SELECT 1;
