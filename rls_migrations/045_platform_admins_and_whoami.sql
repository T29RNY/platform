-- ============================================================
-- Migration 045 — platform_admins table + is_platform_admin() + whoami RPC
--
-- WHY: The apps/superadmin dashboard (cross-team monitoring +
-- intervention tool, separate Vercel deploy, SSO-protected) needs a
-- global authorisation layer. team_admins is per-team; platform_admins
-- is cross-team. Every superadmin_* RPC starts with the
-- is_platform_admin() guard, so even if Vercel SSO is misconfigured,
-- nothing leaks.
--
-- Seeded with a single row for tarny@desicity.com so the dashboard
-- works for the developer immediately. New grants are inserted by
-- hand via SQL editor (intentional — there is no UI to add platform
-- admins, by design).
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id),
  note       text
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- No client policies. Reads/writes only via SECURITY DEFINER RPCs.
REVOKE ALL ON TABLE platform_admins FROM anon, authenticated;

-- ------------------------------------------------------------
-- Helper: cheap auth.uid() membership check
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_admins
    WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION is_platform_admin() FROM anon;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated;

-- ------------------------------------------------------------
-- whoami — tells the dashboard whether the caller can see anything
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION superadmin_whoami()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid   uuid;
  v_email text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('signed_in', false, 'is_platform_admin', false);
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  RETURN jsonb_build_object(
    'signed_in',         true,
    'user_id',           v_uid,
    'email',             v_email,
    'is_platform_admin', is_platform_admin()
  );
END;
$$;

REVOKE ALL ON FUNCTION superadmin_whoami() FROM anon;
GRANT EXECUTE ON FUNCTION superadmin_whoami() TO authenticated;

-- ------------------------------------------------------------
-- Seed: grant platform-admin to tarny@desicity.com
-- ------------------------------------------------------------
INSERT INTO platform_admins (user_id, granted_by, note)
VALUES (
  'b5d8c647-f08e-4309-836c-5b77724d2960',
  'b5d8c647-f08e-4309-836c-5b77724d2960',
  'Initial seed — Beta launch May 24 2026'
)
ON CONFLICT (user_id) DO NOTHING;
