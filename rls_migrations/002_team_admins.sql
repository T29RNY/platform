-- Migration 002: team_admins table
-- Canonical admin identity table. Populated by create_team (migration 015)
-- and backfilled for existing teams in migration 020.
-- Phase B: not used as an auth check by admin RPCs (admin_token only).
-- Phase 2: admin RPCs will validate auth.uid() against this table.

CREATE TABLE IF NOT EXISTS team_admins (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      text        NOT NULL REFERENCES teams(id),
  user_id      uuid        NOT NULL REFERENCES auth.users(id),
  role         text        NOT NULL CHECK (role IN (
    'team_admin', 'vice_captain', 'club_admin', 'super_admin'
  )),
  granted_by   uuid        NULL REFERENCES auth.users(id),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz NULL,
  revoked_by   uuid        NULL REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One active role per user per team (partial index; revoked rows are excluded).
CREATE UNIQUE INDEX IF NOT EXISTS team_admins_uniq_active
  ON team_admins (team_id, user_id, role)
  WHERE revoked_at IS NULL;

-- Fast lookup: all active teams for a given user.
CREATE INDEX IF NOT EXISTS team_admins_by_user
  ON team_admins (user_id)
  WHERE revoked_at IS NULL;

-- Fast lookup: all active admins for a given team.
CREATE INDEX IF NOT EXISTS team_admins_by_team
  ON team_admins (team_id)
  WHERE revoked_at IS NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE team_admins ENABLE ROW LEVEL SECURITY;

-- Team members (players or admins) can read the admin list for their own team.
-- is_team_member() checks both team_players→players.user_id and team_admins itself,
-- so this SELECT policy is self-referential but safe: the function is SECURITY DEFINER
-- and will not trigger infinite recursion because it does a direct predicate check,
-- not a policy evaluation.
CREATE POLICY "team_members_select_team_admins"
  ON team_admins
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id));

-- No INSERT/UPDATE/DELETE policies for anon or authenticated.
-- All writes to team_admins occur inside SECURITY DEFINER RPCs (create_team,
-- migration 020 backfill), which execute as the function owner (postgres/superuser)
-- and bypass RLS. Direct client writes are denied by absence of a permissive policy.

-- ── Grants ───────────────────────────────────────────────────────────────────

REVOKE ALL ON team_admins FROM anon;
REVOKE ALL ON team_admins FROM authenticated;
GRANT SELECT ON team_admins TO authenticated;
-- INSERT/UPDATE/DELETE intentionally not granted; SECURITY DEFINER functions
-- execute as postgres (superuser) and do not require explicit grants.