-- 098_phase2_join_register_team_down.sql
--
-- Reverses 098.

DROP FUNCTION IF EXISTS public.join_register_team(text, uuid, jsonb);
