-- ════════════════════════════════════════════════════════════
-- Migration 254 — venue invite-link management (QR Onboarding slice 7)
-- Layers create / set-active / re-point / list on top of the slice-4
-- venue_ensure_invite_link. All callers via resolve_venue_caller; every
-- target entity is ownership-checked against the caller's venue (no minting
-- or re-pointing codes at another venue's teams/fixtures). All writes
-- INSERT audit_events (Hard Rule #9). Re-point is fully flexible: a code
-- may move across entity types (team→venue→fixture) provided the new
-- entity belongs to the caller's venue and the action pairs with it.
-- Plan: QR_ONBOARDING_SCOPE.md slice 7. Template: mig 251.
-- ════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- venue_owns_entity — shared ownership predicate. Does the given entity
-- belong to this venue? team/fixture roll up via competition→season→league.
-- SECURITY DEFINER (bypasses RLS); internal-only — explicitly revoked from
-- anon/authenticated (Supabase default privileges re-grant otherwise).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_owns_entity(
  p_venue_id text, p_entity_type text, p_entity_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_venue_id IS NULL OR p_entity_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_entity_type = 'venue' THEN
    RETURN p_entity_id = p_venue_id;

  ELSIF p_entity_type = 'team' THEN
    RETURN EXISTS (
      SELECT 1 FROM competition_teams ct
      JOIN competitions c ON c.id = ct.competition_id
      JOIN seasons s      ON s.id = c.season_id
      JOIN leagues l      ON l.id = s.league_id
      WHERE ct.team_id = p_entity_id AND l.venue_id = p_venue_id);

  ELSIF p_entity_type = 'fixture' THEN
    RETURN EXISTS (
      SELECT 1 FROM fixtures f
      JOIN competitions c ON c.id = f.competition_id
      JOIN seasons s      ON s.id = c.season_id
      JOIN leagues l      ON l.id = s.league_id
      WHERE f.id::text = p_entity_id AND l.venue_id = p_venue_id);
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.venue_owns_entity(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.venue_owns_entity(text, text, text) FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- venue_create_invite_link — WRITE. Mints a NEW code (unconditionally —
-- unlike venue_ensure_invite_link which get-or-creates the canonical one),
-- so staff can run multiple labelled codes for the same destination.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_invite_link(
  p_credential text, p_entity_type text, p_entity_id text,
  p_action text, p_label text DEFAULT NULL)
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
  v_label    text := NULLIF(trim(p_label), '');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_credential);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT ( (p_entity_type = 'venue'   AND p_action = 'venue_landing')
        OR (p_entity_type = 'team'    AND p_action = 'join_team')
        OR (p_entity_type = 'fixture' AND p_action = 'match_checkin') ) THEN
    RAISE EXCEPTION 'action_entity_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.venue_owns_entity(v_venue_id, p_entity_type, p_entity_id) THEN
    RAISE EXCEPTION 'not_your_entity' USING ERRCODE = 'P0001';
  END IF;

  v_code := generate_url_safe_token('q_', 8);
  INSERT INTO invite_links (code, entity_type, entity_id, action, label, created_by)
  VALUES (v_code, p_entity_type, p_entity_id, p_action, v_label, v_caller.actor_ident);

  INSERT INTO audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, 'venue_admin', COALESCE(v_caller.actor_ident, 'venue:' || v_venue_id),
          'invite_link_created', p_entity_type, p_entity_id,
          jsonb_build_object('code', v_code, 'link_action', p_action, 'label', v_label, 'source', 'manage'));

  RETURN jsonb_build_object(
    'ok', true, 'code', v_code, 'entity_type', p_entity_type,
    'entity_id', p_entity_id, 'action', p_action, 'label', v_label, 'created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.venue_create_invite_link(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_invite_link(text, text, text, text, text) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- venue_set_invite_link_active — WRITE. Toggle a code on/off. Ownership
-- re-derived from the code's STORED entity (never a client-passed venue).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_invite_link_active(
  p_credential text, p_code text, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_link     invite_links%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_credential);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_link FROM invite_links WHERE code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_link_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.venue_owns_entity(v_venue_id, v_link.entity_type, v_link.entity_id) THEN
    RAISE EXCEPTION 'not_your_entity' USING ERRCODE = 'P0001';
  END IF;

  UPDATE invite_links SET active = p_active WHERE code = p_code;

  INSERT INTO audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, 'venue_admin', COALESCE(v_caller.actor_ident, 'venue:' || v_venue_id),
          'invite_link_active_set', v_link.entity_type, v_link.entity_id,
          jsonb_build_object('code', p_code, 'active', p_active));

  RETURN jsonb_build_object('ok', true, 'code', p_code, 'active', p_active);
END;
$$;

REVOKE ALL ON FUNCTION public.venue_set_invite_link_active(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_set_invite_link_active(text, text, boolean) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- venue_repoint_invite_link — WRITE. Change where a code points. DOUBLE
-- ownership check: caller must own BOTH the existing code's entity AND the
-- new target. Fully flexible — the new (entity_type, action) may differ
-- from the old, so a code can move across types (team→venue→fixture).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_repoint_invite_link(
  p_credential text, p_code text, p_entity_type text, p_entity_id text, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_link     invite_links%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_credential);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_link FROM invite_links WHERE code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_link_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Must own the existing code's entity (can't touch another venue's code).
  IF NOT public.venue_owns_entity(v_venue_id, v_link.entity_type, v_link.entity_id) THEN
    RAISE EXCEPTION 'not_your_entity' USING ERRCODE = 'P0001';
  END IF;

  -- New pairing must be internally valid.
  IF NOT ( (p_entity_type = 'venue'   AND p_action = 'venue_landing')
        OR (p_entity_type = 'team'    AND p_action = 'join_team')
        OR (p_entity_type = 'fixture' AND p_action = 'match_checkin') ) THEN
    RAISE EXCEPTION 'action_entity_mismatch' USING ERRCODE = 'P0001';
  END IF;

  -- Must own the new target too.
  IF NOT public.venue_owns_entity(v_venue_id, p_entity_type, p_entity_id) THEN
    RAISE EXCEPTION 'not_your_entity' USING ERRCODE = 'P0001';
  END IF;

  UPDATE invite_links
     SET entity_type = p_entity_type, entity_id = p_entity_id, action = p_action
   WHERE code = p_code;

  INSERT INTO audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, 'venue_admin', COALESCE(v_caller.actor_ident, 'venue:' || v_venue_id),
          'invite_link_repointed', p_entity_type, p_entity_id,
          jsonb_build_object(
            'code', p_code,
            'from', jsonb_build_object('entity_type', v_link.entity_type, 'entity_id', v_link.entity_id, 'action', v_link.action),
            'to',   jsonb_build_object('entity_type', p_entity_type,     'entity_id', p_entity_id,       'action', p_action)));

  RETURN jsonb_build_object(
    'ok', true, 'code', p_code, 'entity_type', p_entity_type,
    'entity_id', p_entity_id, 'action', p_action);
END;
$$;

REVOKE ALL ON FUNCTION public.venue_repoint_invite_link(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_repoint_invite_link(text, text, text, text, text) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- venue_list_invite_links — READ. Every code the venue owns (its own
-- landing code, its teams' join codes, its fixtures' check-in codes) with
-- use_count, active, label, and a human target_name. Mirrors venue_list_staff.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_invite_links(p_credential text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_links    jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_credential);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'code',        il.code,
      'entity_type', il.entity_type,
      'entity_id',   il.entity_id,
      'action',      il.action,
      'label',       il.label,
      'active',      il.active,
      'use_count',   il.use_count,
      'max_uses',    il.max_uses,
      'expires_at',  il.expires_at,
      'created_at',  il.created_at,
      'target_name', CASE
        WHEN il.entity_type = 'venue'   THEN (SELECT v.name FROM venues v WHERE v.id = il.entity_id)
        WHEN il.entity_type = 'team'    THEN (SELECT t.name FROM teams  t WHERE t.id = il.entity_id)
        WHEN il.entity_type = 'fixture' THEN (
          SELECT th.name || ' v ' || COALESCE(ta.name, 'bye')
          FROM fixtures f
          JOIN teams th ON th.id = f.home_team_id
          LEFT JOIN teams ta ON ta.id = f.away_team_id
          WHERE f.id::text = il.entity_id)
      END
    ) ORDER BY il.active DESC, il.created_at DESC), '[]'::jsonb)
  INTO v_links
  FROM invite_links il
  WHERE public.venue_owns_entity(v_venue_id, il.entity_type, il.entity_id);

  RETURN jsonb_build_object('ok', true, 'links', v_links);
END;
$$;

REVOKE ALL ON FUNCTION public.venue_list_invite_links(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_invite_links(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
