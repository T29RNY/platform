-- 473_drop_unused_public_views.sql
--
-- Security fix. Nightly advisor sweep (2026-07-03) flagged teams_public,
-- matches_public, players_public as SECURITY DEFINER-style RLS bypass views
-- (security_invoker=false, the Postgres default for views — they run as
-- their owner `postgres`, not the querying user, so the RLS policies on the
-- underlying teams/matches/players tables never actually apply through them).
--
-- Confirmed zero live consumers: grepped every apps/*/src, every
-- packages/core file, and every RPC function body in pg_proc for
-- ".from('teams_public'|'matches_public'|'players_public')" and
-- "FROM teams_public|matches_public|players_public" — no hits outside the
-- view-definition migrations themselves and two commented-out manual test
-- queries. All real reads now go through SECURITY DEFINER RPCs (the
-- post-session-24 pattern documented in CLAUDE.md's RLS checklist) — these
-- views are a leftover from the earlier direct-read design (migrations
-- 005–007) that was superseded.
--
-- players_public was additionally exposing the player auth `token` column to
-- the `anon` role — any unauthenticated visitor could read every player's
-- login token and impersonate them. Root cause: migration
-- 026_vc_to_team_players.sql dropped and recreated the view (to drop the
-- players.is_vice_captain column) but didn't redo migration
-- 019_grants_consolidation.sql's REVOKE ALL FROM anon,authenticated,PUBLIC +
-- GRANT SELECT TO authenticated lockdown, and re-added `p.token` to the
-- SELECT list even though 019 explicitly documented "players_public:
-- excludes token, user_id, paid_at, role_scope". Postgres's default
-- privileges then silently re-granted broader access on the fresh view.
--
-- Since nothing depends on these views, dropping them removes the
-- vulnerability class entirely rather than re-patching grants that have
-- already drifted open once before.

DROP VIEW IF EXISTS teams_public;
DROP VIEW IF EXISTS matches_public;
DROP VIEW IF EXISTS players_public;
