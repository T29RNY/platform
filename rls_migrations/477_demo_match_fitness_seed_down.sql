-- 477 DOWN: remove the demo match-fitness seed. Restores team_demo to its pre-seed state.

-- sessions (routes cascade via match_health_routes.session_id ON DELETE CASCADE)
DELETE FROM match_health_sessions WHERE client_session_id LIKE 'cs_mf_%';

-- co-participation + matches
DELETE FROM player_match WHERE match_id IN ('mf_demo_1','mf_demo_2');
DELETE FROM matches       WHERE id       IN ('mf_demo_1','mf_demo_2');

-- unlink the 5 backing players + reset consent to the original (false)
UPDATE players SET user_id = NULL, share_match_fitness = false
 WHERE id IN ('p_demo_02','p_demo_03','p_demo_04','p_demo_06','p_demo_07');
UPDATE players SET share_match_fitness = false
 WHERE id IN ('p_demo_alex','p_demo_sam');

-- drop the backing auth users
DELETE FROM auth.users WHERE id IN (
  'd0d00000-0000-4000-8000-000000000002',
  'd0d00000-0000-4000-8000-000000000003',
  'd0d00000-0000-4000-8000-000000000004',
  'd0d00000-0000-4000-8000-000000000006',
  'd0d00000-0000-4000-8000-000000000007'
);

SELECT pg_notify('pgrst', 'reload schema');
