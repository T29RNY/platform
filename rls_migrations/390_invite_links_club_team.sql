-- 390 — Club Org & Team Structure, Phase 2 (team join link + QR)
-- Epic: CLUB_STRUCTURE_HANDOFF.md. Additive only.
--
-- Teaches the invite_links QR routing layer (mig 248) about CLUB teams
-- (membership domain) — distinct from the casual `teams` table the existing
-- 'join_team' action targets. A scanned club-team code resolves to enough
-- context (club / age group / team) to start the Phase-3 membership-gated
-- join; the join write itself is NOT built here.
--
-- Design note: a NEW action 'join_club_team' (not a reuse of 'join_team') so
-- a club-team code can never fall into the casual /join flow — dispatch in
-- InviteResolve is keyed on `action`. Entity type 'club_team'.
--
-- Deliberately scoped: the generic venue management RPCs (venue_owns_entity /
-- venue_list/create/repoint_invite_link, mig 254) are NOT extended to club
-- teams. The Structure screen owns one canonical code per club team via the
-- new club_ensure_team_invite_link below (mirrors venue_ensure_invite_link,
-- mig 251, but club-domain ownership). Keeps the two QR surfaces separate.

-- ── 1. Widen the CHECK constraints (additive — no data change) ───────────────
ALTER TABLE public.invite_links DROP CONSTRAINT IF EXISTS invite_links_entity_type_check;
ALTER TABLE public.invite_links ADD  CONSTRAINT invite_links_entity_type_check
  CHECK (entity_type IN ('team','venue','fixture','club_team'));

ALTER TABLE public.invite_links DROP CONSTRAINT IF EXISTS invite_links_action_check;
ALTER TABLE public.invite_links ADD  CONSTRAINT invite_links_action_check
  CHECK (action IN ('join_team','venue_landing','match_checkin','join_club_team'));

-- ── 2. resolve_invite_link — add the club_team branch ────────────────────────
-- Read-only, anon-safe. Returns club / cohort / team context. An archived team
-- resolves to status 'inactive' (its code stops working without being deleted).
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
  ELSIF v_link.entity_type = 'club_team' THEN
    SELECT jsonb_build_object(
             'team_id',         ct.id,
             'team_name',       ct.name,
             'gender',          ct.gender,
             'cohort_id',       cc.id,
             'cohort_name',     cc.name,
             'cohort_category', cc.category,
             'club_id',         cl.id,
             'club_name',       cl.name,
             'archived',        (ct.archived_at IS NOT NULL))
      INTO v_destination
      FROM club_teams ct
      JOIN club_cohorts cc ON cc.id = ct.cohort_id
      JOIN clubs cl        ON cl.id = ct.club_id
     WHERE ct.id = v_link.entity_id::uuid;
  ELSIF v_link.entity_type = 'fixture' THEN
    v_destination := jsonb_build_object('fixture_id', v_link.entity_id);
  END IF;

  IF v_destination IS NULL THEN
    v_status := 'not_found';
  ELSIF v_link.entity_type = 'club_team' AND (v_destination->>'archived')::boolean THEN
    v_status := 'inactive';   -- archived team: code resolves but is no longer joinable
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

-- ── 3. redeem_invite_link — add the club_team scope branch ───────────────────
-- Not called in Phase 2 (no join completes yet); wired now so the Phase-3
-- post-join redeem just works. audit_events.team_id is the scope key — for a
-- club team that's the venue_id, derived via club_venues.
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

  IF v_link.entity_type IN ('team','venue') THEN
    v_scope_id := v_link.entity_id;
  ELSIF v_link.entity_type = 'club_team' THEN
    SELECT cv.venue_id INTO v_scope_id
    FROM club_teams ct
    JOIN club_venues cv ON cv.club_id = ct.club_id
    WHERE ct.id = v_link.entity_id::uuid
    LIMIT 1;
    IF v_scope_id IS NULL THEN
      RAISE EXCEPTION 'club_team_venue_not_found' USING ERRCODE = 'P0001';
    END IF;
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

-- ── 4. club_ensure_team_invite_link — get-or-create the canonical code ───────
-- Mirrors venue_ensure_invite_link (mig 251) but club-domain: ownership rolls
-- up club_teams.club_id -> club_venues.venue_id (NOT the league competition
-- chain). Venue-token authed + manage_memberships cap. audit on create
-- (Hard Rule #9).
CREATE OR REPLACE FUNCTION public.club_ensure_team_invite_link(
  p_venue_token text, p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club_id  text;
  v_code     text;
  v_created  boolean := false;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  -- team must belong to a club linked to this venue
  SELECT ct.club_id INTO v_club_id
  FROM public.club_teams ct
  JOIN public.club_venues cv ON cv.club_id = ct.club_id AND cv.venue_id = v_venue_id
  WHERE ct.id = p_team_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001'; END IF;

  -- get-or-create the canonical ACTIVE code for this club team
  SELECT code INTO v_code FROM public.invite_links
   WHERE entity_type = 'club_team' AND entity_id = p_team_id::text
     AND action = 'join_club_team' AND active = true
   ORDER BY created_at ASC LIMIT 1;

  IF v_code IS NULL THEN
    v_code := generate_url_safe_token('q_', 8);
    INSERT INTO public.invite_links (code, entity_type, entity_id, action, created_by)
    VALUES (v_code, 'club_team', p_team_id::text, 'join_club_team', v_caller.actor_ident);
    v_created := true;

    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'invite_link_created', 'club_team', p_team_id::text,
            jsonb_build_object('code', v_code, 'link_action', 'join_club_team', 'club_id', v_club_id));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'code', v_code, 'entity_type', 'club_team',
    'entity_id', p_team_id, 'action', 'join_club_team', 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.club_ensure_team_invite_link(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_ensure_team_invite_link(text, uuid) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
