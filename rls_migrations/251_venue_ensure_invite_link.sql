-- ════════════════════════════════════════════════════════════
-- Migration 251 — venue_ensure_invite_link (QR Onboarding slice 4)
-- The "code provider" the venue QR view + reception display read: get-or-
-- create the ONE canonical active invite_links code for an entity+action,
-- so a QR can render. Venue-authed (resolve_venue_caller), ownership-checked.
-- Slice 7 layers management (label/deactivate/re-point) on top of these.
-- Slice 4 supports team (join_team) + venue (venue_landing); fixture = slice 6.
-- Plan: QR_ONBOARDING_SCOPE.md slice 4.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.venue_ensure_invite_link(
  p_credential text, p_entity_type text, p_entity_id text, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_code     text;
  v_created  boolean := false;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_credential);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  -- Validate entity_type/action pairing + ownership (server-derived, never trusted)
  IF p_entity_type = 'venue' THEN
    IF p_action <> 'venue_landing' THEN RAISE EXCEPTION 'action_entity_mismatch' USING ERRCODE = 'P0001'; END IF;
    IF p_entity_id <> v_venue_id    THEN RAISE EXCEPTION 'not_your_venue'        USING ERRCODE = 'P0001'; END IF;
  ELSIF p_entity_type = 'team' THEN
    IF p_action <> 'join_team' THEN RAISE EXCEPTION 'action_entity_mismatch' USING ERRCODE = 'P0001'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM competition_teams ct
      JOIN competitions c ON c.id = ct.competition_id
      JOIN seasons s      ON s.id = c.season_id
      JOIN leagues l      ON l.id = s.league_id
      WHERE ct.team_id = p_entity_id AND l.venue_id = v_venue_id
    ) THEN RAISE EXCEPTION 'team_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  ELSE
    RAISE EXCEPTION 'unsupported_entity_type' USING ERRCODE = 'P0001';  -- fixture = slice 6
  END IF;

  -- Get-or-create the canonical ACTIVE code for this (entity_type, entity_id, action)
  SELECT code INTO v_code FROM invite_links
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id
     AND action = p_action AND active = true
   ORDER BY created_at ASC LIMIT 1;

  IF v_code IS NULL THEN
    v_code := generate_url_safe_token('q_', 8);
    INSERT INTO invite_links (code, entity_type, entity_id, action, created_by)
    VALUES (v_code, p_entity_type, p_entity_id, p_action, v_caller.actor_ident);
    v_created := true;

    INSERT INTO audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, 'venue_admin', COALESCE(v_caller.actor_ident, 'venue:' || v_venue_id),
            'invite_link_created', p_entity_type, p_entity_id,
            jsonb_build_object('code', v_code, 'link_action', p_action));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'code', v_code, 'entity_type', p_entity_type,
    'entity_id', p_entity_id, 'action', p_action, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.venue_ensure_invite_link(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_ensure_invite_link(text, text, text, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
