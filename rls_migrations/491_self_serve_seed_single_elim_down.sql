-- 491_self_serve_seed_single_elim_down.sql
-- Reverse of 491: drop the self-serve straight-knockout seeder.
DROP FUNCTION IF EXISTS public.self_serve_seed_single_elim(text, uuid, uuid);
