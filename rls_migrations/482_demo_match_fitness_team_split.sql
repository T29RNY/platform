-- 482: demo seed — give the demo Match Fitness games (mf_demo_1, mf_demo_2) a Team A / Team B split
--
-- TEAM_VS_TEAM_FITNESS_HANDOFF.md, PR #1 (rides with mig 481). Data-only (tier-2): sets
-- player_match.team_assignment for the demo fitness matches so the new Team A vs Team B block is
-- visible/verifiable in the ONLY walk that exercises this dark feature (Alex-Demo Results).
--
-- Currently ALL player_match.team_assignment on mf_demo_1/2 are NULL → the block never renders in
-- the demo. This backfill splits both matches:
--   Team A = p_demo_alex (Alex), p_demo_02 (Dave), p_demo_03 (Mike), p_demo_06 (Liam)
--   Team B = p_demo_08 (Chris), p_demo_sam (Sam), p_demo_04 (Steve)
-- As Alex (Team A, consenting) this yields Team A 4 shared (Alex/Dave/Mike/Liam) vs Team B 2 shared
-- (Sam/Steve) — Chris has a player_match row on mf_demo_1 but NO health session, so he is excluded
-- automatically, which also demonstrates the consent-aware "(N shared)" count.
--
-- Idempotent: UPDATE by explicit (match_id, player_id). player_match rows already exist for every
-- listed pair on mf_demo_1 (7 rows incl. p_demo_08); mf_demo_2 has 6 (no p_demo_08 row) — the
-- p_demo_08 UPDATE simply affects 0 rows there, harmless. Touches ONLY the demo seed.
-- Side effect: the demo result screen now shows A/B teams where it currently shows none — more
-- realistic, harmless.

UPDATE player_match SET team_assignment = 'A'
 WHERE match_id IN ('mf_demo_1', 'mf_demo_2')
   AND player_id IN ('p_demo_alex', 'p_demo_02', 'p_demo_03', 'p_demo_06');

UPDATE player_match SET team_assignment = 'B'
 WHERE match_id IN ('mf_demo_1', 'mf_demo_2')
   AND player_id IN ('p_demo_08', 'p_demo_sam', 'p_demo_04');
