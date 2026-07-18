-- 607_venue_enter_fixture_result_down.sql
--
-- Reverses 607_venue_enter_fixture_result.sql. Purely additive migration
-- (one new function, no shipped function edited, no whitelist touched), so the
-- down is a single DROP. Nothing else to restore.

DROP FUNCTION IF EXISTS public.venue_enter_fixture_result(text, uuid, integer, integer, text);
