-- 482 DOWN: revert the demo Match Fitness team split — restore team_assignment = NULL on the
-- exact rows mig 482 set. Scoped to the demo fitness matches + the listed players only.

UPDATE player_match SET team_assignment = NULL
 WHERE match_id IN ('mf_demo_1', 'mf_demo_2')
   AND player_id IN ('p_demo_alex', 'p_demo_02', 'p_demo_03', 'p_demo_06',
                     'p_demo_08', 'p_demo_sam', 'p_demo_04');
