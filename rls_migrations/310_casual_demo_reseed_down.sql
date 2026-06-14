-- 310_casual_demo_reseed_down.sql — reverses the casual demo reseed

-- Restore player statuses to 'none'
UPDATE players SET status = 'none'
WHERE id LIKE 'p_demo_%';

-- Disable bibs, revert game date to original
UPDATE schedule SET
  bibs_enabled   = false,
  game_date_time = '2026-06-16 19:00:00+00'
WHERE team_id = 'team_demo';

UPDATE matches SET bib_holder = NULL, match_date = '2026-06-16'
WHERE id = 'm_-9327XyQaPU' AND team_id = 'team_demo';

-- Remove seeded POTM votes
DELETE FROM potm_votes
WHERE team_id = 'team_demo'
  AND match_id IN ('m_demo_22','m_demo_21','m_demo_20','m_demo_19','m_demo_18','m_demo_17');

-- Remove seeded bib history rows
DELETE FROM bib_history
WHERE team_id = 'team_demo'
  AND match_date >= current_date - 25;

-- Remove seeded payment ledger rows
DELETE FROM payment_ledger
WHERE team_id = 'team_demo'
  AND note IN (
    'Week 23','Week 22','Week 22 — chased x2','Week 21','Week 20'
  );
