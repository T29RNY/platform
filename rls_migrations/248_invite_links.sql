-- ════════════════════════════════════════════════════════════
-- Migration 248 — invite_links routing layer (QR Onboarding slice 1)
-- Stable code → mutable destination. The QR encodes ONLY /q/<code>;
-- the row behind it can be re-pointed forever. Never QR-encode an
-- internal id. Design: DECISIONS.md "QR ONBOARDING ARCHITECTURE";
-- plan: QR_ONBOARDING_SCOPE.md slice 1.
-- ════════════════════════════════════════════════════════════

CREATE TABLE public.invite_links (
  code         text PRIMARY KEY,
  entity_type  text NOT NULL CHECK (entity_type IN ('team','venue','fixture')),
  entity_id    text NOT NULL,
  action       text NOT NULL CHECK (action IN ('join_team','venue_landing','match_checkin')),
  active       boolean NOT NULL DEFAULT true,
  expires_at   timestamptz,
  max_uses     integer,
  use_count    integer NOT NULL DEFAULT 0,
  label        text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invite_links_entity_idx ON public.invite_links (entity_type, entity_id);

-- All access via the SECURITY DEFINER RPCs below — no client policies (Hard Rule #2).
ALTER TABLE public.invite_links ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- resolve_invite_link — READ. Resolves a scanned code to its action +
-- minimal destination (just enough to paint the first frame; richer
-- data comes from each action's own RPC). Read-only, anon-safe.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_invite_link(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link        invite_links%ROWTYPE;
  v_status      text;
  v_destination jsonb;
BEGIN
  IF p_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found');
  END IF;

  SELECT * INTO v_link FROM invite_links WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found', 'code', p_code);
  END IF;

  v_status :=
    CASE
      WHEN NOT v_link.active                                                THEN 'inactive'
      WHEN v_link.expires_at IS NOT NULL AND v_link.expires_at < now()      THEN 'expired'
      WHEN v_link.max_uses   IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN 'exhausted'
      ELSE 'ok'
    END;

  -- Minimal destination per action. NULL destination => target entity gone.
  IF v_link.entity_type = 'team' THEN
    SELECT jsonb_build_object('team_id', t.id, 'team_name', t.name)
      INTO v_destination FROM teams t WHERE t.id = v_link.entity_id;
  ELSIF v_link.entity_type = 'venue' THEN
    SELECT jsonb_build_object(
             'venue_id', v.id, 'venue_name', v.name, 'logo_url', v.logo_url,
             'primary_colour', v.primary_colour, 'secondary_colour', v.secondary_colour)
      INTO v_destination FROM venues v WHERE v.id = v_link.entity_id;
  ELSIF v_link.entity_type = 'fixture' THEN
    v_destination := jsonb_build_object('fixture_id', v_link.entity_id);
  END IF;

  IF v_destination IS NULL THEN
    v_status := 'not_found';
  END IF;

  RETURN jsonb_build_object(
    'ok',          v_status = 'ok',
    'status',      v_status,
    'code',        v_link.code,
    'action',      v_link.action,
    'entity_type', v_link.entity_type,
    'entity_id',   v_link.entity_id,
    'destination', v_destination
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_invite_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_invite_link(text) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- redeem_invite_link — WRITE. Counts a use atomically, re-checking
-- validity inside the txn (race-safe), and leaves a server-side audit
-- trace (Hard Rule #9). Called by an action handler AFTER the action
-- succeeds. Slice 1 handles team + venue codes; the fixture
-- (match_checkin) branch arrives in slice 6.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_invite_link(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link     invite_links%ROWTYPE;
  v_status   text;
  v_scope_id text;
BEGIN
  IF p_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found');
  END IF;

  SELECT * INTO v_link FROM invite_links WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found', 'code', p_code);
  END IF;

  v_status :=
    CASE
      WHEN NOT v_link.active                                                THEN 'inactive'
      WHEN v_link.expires_at IS NOT NULL AND v_link.expires_at < now()      THEN 'expired'
      WHEN v_link.max_uses   IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN 'exhausted'
      ELSE 'ok'
    END;

  IF v_status <> 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'status', v_status, 'code', v_link.code);
  END IF;

  -- audit_events.team_id is NOT NULL and acts as a scoping key (venue_id for
  -- venue/league events, team_id for team events; SCHEMA.md note).
  IF v_link.entity_type IN ('team','venue') THEN
    v_scope_id := v_link.entity_id;
  ELSE
    RAISE EXCEPTION 'checkin_redeem_not_built';  -- fixture branch lands in slice 6
  END IF;

  UPDATE invite_links SET use_count = use_count + 1 WHERE code = p_code;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_scope_id, 'system', auth.uid(), 'invite_code:' || p_code,
    'invite_link_redeemed', v_link.entity_type, v_link.entity_id,
    jsonb_build_object(
      'code',          p_code,
      'link_action',   v_link.action,
      'use_count',     v_link.use_count + 1
    )
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'status',      'ok',
    'code',        v_link.code,
    'action',      v_link.action,
    'entity_type', v_link.entity_type,
    'entity_id',   v_link.entity_id,
    'use_count',   v_link.use_count + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_invite_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invite_link(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
