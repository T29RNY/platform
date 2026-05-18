-- Rollback for migration 005.
--
-- WARNING: After this rollback, any client code that queries teams_public,
-- players_public, or matches_public will fail. All such queries must be
-- replaced with direct table queries or RPCs before or simultaneously with
-- this rollback.

REVOKE SELECT ON teams_public FROM authenticated;
REVOKE SELECT ON players_public FROM authenticated;
REVOKE SELECT ON matches_public FROM authenticated;

DROP VIEW IF EXISTS matches_public;
DROP VIEW IF EXISTS players_public;
DROP VIEW IF EXISTS teams_public;