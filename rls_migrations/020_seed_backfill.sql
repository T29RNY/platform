-- =============================================================================
-- Migration 020: Seed / backfill (no down migration)
-- =============================================================================
-- Safe to re-run. Two production ops + verification.
--
-- Op 1: Fill NULL live_channel_key values on existing teams
--        Migration 006 added the column with DEFAULT gen_random_uuid()::text
--        but pre-migration rows may have NULL. Migration 017 notify_team_change
--        silently returns for NULL channel keys so this must run first.
--
-- Op 2: Seed team_admins for Tarny (user_id: f95ad4a8-9b36-4b73-b909-8d2e10c9354b)
--        on all three real teams. Idempotent via ON CONFLICT DO NOTHING.
--        The partial index team_admins_uniq_active prevents duplicate active rows.
-- =============================================================================

-- ── Op 1: Backfill live_channel_key ──────────────────────────────────────────
-- Give every team that pre-dates migration 006 a non-null channel key.
-- Teams created after migration 006 already have the DEFAULT applied.

UPDATE teams
SET    live_channel_key = gen_random_uuid()::text
WHERE  live_channel_key IS NULL;

-- ── Op 2: Seed team_admins for Tarny ─────────────────────────────────────────
-- team_id        | description
-- team_finbars   | Finbar's Tuesdays (Stage 1 beta team)
-- team_demo      | Demo / staging team
-- team_mfw3hhu6  | Monday Footy (Stage 2)

INSERT INTO team_admins (team_id, user_id, role, granted_by)
VALUES
  ('team_finbars',  'f95ad4a8-9b36-4b73-b909-8d2e10c9354b', 'team_admin', NULL),
  ('team_demo',     'f95ad4a8-9b36-4b73-b909-8d2e10c9354b', 'team_admin', NULL),
  ('team_mfw3hhu6', 'f95ad4a8-9b36-4b73-b909-8d2e10c9354b', 'team_admin', NULL)
ON CONFLICT DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────

-- [A] Teams still missing a channel key (expected: 0 rows)
SELECT id, name
FROM   teams
WHERE  live_channel_key IS NULL;

-- [B] Tarny's team_admins rows (expected: 3 rows, one per team)
SELECT ta.team_id, t.name AS team_name, ta.role, ta.granted_at, ta.revoked_at
FROM   team_admins ta
JOIN   teams t ON t.id = ta.team_id
WHERE  ta.user_id = 'f95ad4a8-9b36-4b73-b909-8d2e10c9354b'
  AND  ta.revoked_at IS NULL
ORDER  BY ta.team_id;
