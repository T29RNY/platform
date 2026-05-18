-- Migration 003: audit_events table
-- Permanent audit log for all sensitive admin actions.
-- Rows are immutable: no UPDATE or DELETE ever permitted, including by admins.
-- Intentionally no FK on team_id (audit log survives even if team row is altered).
-- actor_user_id has no FK (audit log survives auth.users changes).

CREATE TABLE IF NOT EXISTS audit_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          text        NOT NULL,
  actor_user_id    uuid        NULL,
  actor_type       text        NOT NULL CHECK (actor_type IN (
    'team_admin',
    'vice_captain',
    'club_admin',
    'super_admin',
    'player',
    'service_role',
    'system'
  )),
  actor_identifier text        NULL,
  action           text        NOT NULL,
  entity_type      text        NOT NULL,
  entity_id        text        NOT NULL,
  metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Primary read pattern: audit log for a team, newest first.
CREATE INDEX IF NOT EXISTS audit_events_by_team
  ON audit_events (team_id, created_at DESC);

-- Secondary read pattern: all actions by a specific authenticated user.
CREATE INDEX IF NOT EXISTS audit_events_by_actor
  ON audit_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Only active admins of the team can read their team's audit log.
-- Team players (non-admins) cannot see audit events.
CREATE POLICY "team_admins_select_audit_events"
  ON audit_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   team_admins ta
      WHERE  ta.team_id    = audit_events.team_id
      AND    ta.user_id    = auth.uid()
      AND    ta.revoked_at IS NULL
    )
  );

-- No INSERT policy: all inserts occur inside SECURITY DEFINER RPCs.
-- No UPDATE policy: audit rows are immutable.
-- No DELETE policy: audit rows are permanent.

-- ── Grants ───────────────────────────────────────────────────────────────────

REVOKE ALL ON audit_events FROM anon;
REVOKE ALL ON audit_events FROM authenticated;
GRANT SELECT ON audit_events TO authenticated;