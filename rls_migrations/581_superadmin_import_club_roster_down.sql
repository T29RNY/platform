-- 581_superadmin_import_club_roster_down.sql
-- Teardown for 581_superadmin_import_club_roster.sql
--
-- Drops the bespoke bulk roster importer. Reverses only the function definition —
-- no data is written by the migration itself (the RPC is invoked separately), so
-- there is nothing else to undo. Rows created by any prior invocation of the RPC
-- are NOT touched (removing imported people/memberships is a data operation, not
-- a schema rollback — use the offboard/erase paths for that).

DROP FUNCTION IF EXISTS public.superadmin_import_club_roster(text, uuid, text, jsonb, text);
