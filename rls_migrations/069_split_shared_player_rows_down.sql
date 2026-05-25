-- 069 DOWN — no-op. The split is data-only; reversing it would require
-- knowing which new players rows to merge back into which originals, and
-- by the time any merge ran new team activity (player_match, payments,
-- etc.) may have accumulated against the split rows, making a clean
-- reverse impossible. If a true rollback is needed, restore from backup.

SELECT 1;
