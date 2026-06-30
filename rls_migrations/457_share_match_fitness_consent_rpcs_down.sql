-- 457_down: drop the consent toggle RPCs. (The players.share_match_fitness column itself is owned
-- by mig 456, so it is NOT dropped here.)
DROP FUNCTION IF EXISTS set_share_match_fitness(boolean);
DROP FUNCTION IF EXISTS get_my_share_match_fitness();
SELECT pg_notify('pgrst', 'reload schema');
