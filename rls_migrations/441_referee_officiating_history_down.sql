-- 441_referee_officiating_history_down.sql — reverse of 441.
-- Drop the reader and remove the two demo completed fixtures it was seeded for.

DROP FUNCTION IF EXISTS public.get_my_officiating_history(int);

DELETE FROM public.fixtures
 WHERE id IN ('70000000-0000-4000-8000-000000000644',
              '70000000-0000-4000-8000-000000000645');
