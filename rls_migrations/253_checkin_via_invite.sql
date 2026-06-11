-- ════════════════════════════════════════════════════════════
-- Migration 253 — QR match check-in (slice 6)
--
-- Two changes:
--
--  1. Rebuild resolve_invite_link — enrich the fixture branch so the
--     check-in screen can show team names + kickoff time before the
--     player taps confirm. All other branches unchanged.
--
--  2. New checkin_via_invite(p_code, p_player_token) — the atomic
--     check-in write: validates the invite link, locates the player on
--     one of the fixture's teams, gates on fixture status (not game_is_live
--     which is casual-only), applies lock + cap guards, sets
--     players.status='in', increments use_count, and leaves an audit trace
--     tagged via:'qr_checkin' (Hard Rule #9). Returns player_name +
--     team_name for the success screen.
--
-- redeem_invite_link's fixture placeholder (checkin_redeem_not_built) is
-- intentionally left in place — checkin_via_invite is the only caller for
-- fixture codes and handles everything atomically.
-- ════════════════════════════════════════════════════════════

-- ── 1. Rebuild resolve_invite_link — fixture branch enrichment ────────────────
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
    -- Enrich with team names + kickoff so the check-in screen shows context
    -- before the player taps. LEFT JOIN away team (bye slots have away=NULL).
    SELECT jsonb_build_object(
             'fixture_id',     f.id::text,
             'home_team_name', th.name,
             'away_team_name', ta.name,
             'scheduled_date', f.scheduled_date,
             'kickoff_time',   f.kickoff_time,
             'fixture_status', f.status)
      INTO v_destination
      FROM fixtures f
      JOIN  teams th ON th.id = f.home_team_id
      LEFT JOIN teams ta ON ta.id = f.away_team_id
     WHERE f.id = v_link.entity_id::uuid;
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

-- ── 2. checkin_via_invite — atomic QR check-in write ─────────────────────────
CREATE OR REPLACE FUNCTION public.checkin_via_invite(p_code text, p_player_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link        invite_links%ROWTYPE;
  v_link_status text;
  v_player_id   text;
  v_player_name text;
  v_prev_status text;
  v_team_id     text;
  v_team_name   text;
  v_fixture_id  uuid;
  v_fx_status   text;
  v_locked      boolean;
  v_cap         int;
  v_in_count    int;
BEGIN
  IF p_code IS NULL OR p_player_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  -- Lock the invite_links row to prevent concurrent use_count races.
  SELECT * INTO v_link FROM invite_links WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_not_found';
  END IF;

  IF v_link.action <> 'match_checkin' OR v_link.entity_type <> 'fixture' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_wrong_type';
  END IF;

  v_link_status :=
    CASE
      WHEN NOT v_link.active                                                     THEN 'inactive'
      WHEN v_link.expires_at IS NOT NULL AND v_link.expires_at < now()           THEN 'expired'
      WHEN v_link.max_uses   IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN 'exhausted'
      ELSE 'ok'
    END;

  IF v_link_status <> 'ok' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_' || v_link_status;
  END IF;

  -- Resolve fixture. entity_id is stored as text; fixtures.id is uuid.
  v_fixture_id := v_link.entity_id::uuid;

  SELECT status INTO v_fx_status FROM fixtures WHERE id = v_fixture_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'fixture_not_found';
  END IF;

  -- Gate: fixture must not be finalised. game_is_live is casual-only;
  -- league fixtures gate on their own status column.
  IF v_fx_status IN ('completed', 'void', 'postponed', 'walkover') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'game_over';
  END IF;

  -- Resolve player.
  SELECT p.id, p.name INTO v_player_id, v_player_name
    FROM players p WHERE p.token = p_player_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- Find which of the player's teams plays in this fixture.
  -- A player on neither team gets not_member.
  SELECT tp.team_id INTO v_team_id
    FROM team_players tp
    JOIN fixtures f ON (f.home_team_id = tp.team_id OR f.away_team_id = tp.team_id)
   WHERE tp.player_id = v_player_id
     AND f.id = v_fixture_id
   LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_member';
  END IF;

  SELECT name INTO v_team_name FROM teams WHERE id = v_team_id;

  -- Lock guard: refuse if admin has locked this player out.
  SELECT admin_locked_in INTO v_locked FROM players WHERE id = v_player_id;
  IF v_locked = true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'admin_locked_in';
  END IF;

  -- Cap guard: refuse if the team is already at squad_size.
  -- schedule.squad_size may be NULL for league teams (no active casual schedule)
  -- in which case the guard does not fire.
  SELECT s.squad_size INTO v_cap
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  SELECT COUNT(*) INTO v_in_count
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE tp.team_id = v_team_id
     AND p.status = 'in'
     AND NOT p.disabled
     AND p.id <> v_player_id;

  IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'squad_full';
  END IF;

  -- Capture previous status for the audit trail.
  SELECT status INTO v_prev_status FROM players WHERE id = v_player_id;

  -- Mark IN.
  UPDATE players SET status = 'in' WHERE id = v_player_id;

  -- Increment use_count on the invite link.
  UPDATE invite_links SET use_count = use_count + 1 WHERE code = p_code;

  -- Audit event (Hard Rule #9) — tagged via:'qr_checkin' so the platform can
  -- distinguish a physical scan from a digital self-mark.
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_player_token),
    'player_checkin', 'fixture', v_fixture_id::text,
    jsonb_build_object(
      'via',             'qr_checkin',
      'invite_code',     p_code,
      'previous_status', v_prev_status,
      'player_name',     v_player_name,
      'team_name',       v_team_name
    )
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'player_name', v_player_name,
    'team_name',   v_team_name,
    'fixture_id',  v_fixture_id::text,
    'already_in',  v_prev_status = 'in'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.checkin_via_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkin_via_invite(text, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
