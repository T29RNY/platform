-- Rollback for migration 002.
-- Run after rolling back any migration that references team_admins
-- (migrations 003 SELECT policy, 009 RLS predicates, 015 create_team,
--  016 get_potm_tally, 020 backfill). Roll those back first.

DROP POLICY IF EXISTS "team_members_select_team_admins" ON team_admins;

DROP INDEX IF EXISTS team_admins_uniq_active;
DROP INDEX IF EXISTS team_admins_by_user;
DROP INDEX IF EXISTS team_admins_by_team;

DROP TABLE IF EXISTS team_admins;