-- Down for 502: drop the fitness-in-balancing consent RPCs + column.
DROP FUNCTION IF EXISTS set_use_fitness_for_balancing(boolean);
DROP FUNCTION IF EXISTS get_my_use_fitness_for_balancing();
ALTER TABLE players DROP COLUMN IF EXISTS use_fitness_for_balancing;
SELECT pg_notify('pgrst', 'reload schema');
