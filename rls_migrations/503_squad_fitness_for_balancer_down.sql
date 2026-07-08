-- Down for 503: drop the admin-only fitness-for-balancer reader.
DROP FUNCTION IF EXISTS get_squad_fitness_for_balancer(text);
SELECT pg_notify('pgrst', 'reload schema');
