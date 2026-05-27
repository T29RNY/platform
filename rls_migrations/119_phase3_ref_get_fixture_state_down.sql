-- 119_phase3_ref_get_fixture_state_down.sql
-- Reverts mig 119: drops the get_fixture_state_by_ref_token RPC.

DROP FUNCTION IF EXISTS public.get_fixture_state_by_ref_token(text);
