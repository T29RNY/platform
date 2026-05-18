-- Rollback for migration 003.
-- Run after rolling back any migration whose RPCs INSERT into audit_events
-- (migrations 010–018 all do). Roll those back first.

DROP POLICY IF EXISTS "team_admins_select_audit_events" ON audit_events;

DROP INDEX IF EXISTS audit_events_by_team;
DROP INDEX IF EXISTS audit_events_by_actor;

DROP TABLE IF EXISTS audit_events;