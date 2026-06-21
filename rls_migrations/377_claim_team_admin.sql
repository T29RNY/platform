-- 377_claim_team_admin
-- Phase: Unified Login (Step 1b — Option A auto-enrol).
-- When a SIGNED-IN user opens a valid /admin/<token> link, record them as a real
-- account-admin of that team so their LOGIN alone gets them admin access from then
-- on (closes the "admins who only share the link" gap). The admin_token is already
-- the secret that grants admin power, so enrolling its holder matches the existing
-- trust model. Idempotent (no-op if already an active admin). Audited. authed-only.

-- Harden against double-enrol races: one active admin row per (team,user).
CREATE UNIQUE INDEX IF NOT EXISTS team_admins_team_user_active_uniq
  ON public.team_admins (team_id, user_id)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_team_admin(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_team_id text;
  v_already boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM team_admins
    WHERE team_id = v_team_id AND user_id = v_user_id AND revoked_at IS NULL
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'enrolled', false, 'team_id', v_team_id);
  END IF;

  INSERT INTO team_admins (team_id, user_id, role, granted_by, person_id)
  VALUES (v_team_id, v_user_id, 'team_admin', v_user_id, ensure_person(v_user_id))
  ON CONFLICT (team_id, user_id) WHERE (revoked_at IS NULL) DO NOTHING;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', v_user_id,
    'admin_token:' || md5(p_admin_token),
    'admin_self_enrolled', 'team_admin', v_team_id,
    jsonb_build_object('via', 'admin_link_signed_in')
  );

  RETURN jsonb_build_object('ok', true, 'enrolled', true, 'team_id', v_team_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_team_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_team_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_team_admin(text) TO authenticated;
