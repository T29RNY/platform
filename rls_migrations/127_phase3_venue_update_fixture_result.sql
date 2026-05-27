-- 127_phase3_venue_update_fixture_result.sql
--
-- Phase 3 (League Mode) — Cycle 3.6 venue admin override of a
-- ref-confirmed result.
--
-- Adds ONE new RPC and patches TWO notify_* whitelists:
--
-- 1. venue_update_fixture_result(p_venue_token, p_fixture_id,
--                                p_home_score, p_away_score, p_reason)
--    The only path for correcting a result after ref_confirm_full_time.
--    Validates the fixture is in this venue and already 'completed',
--    overwrites home_score / away_score, audit-logs the previous +
--    new scores + the operator-supplied reason, and broadcasts a
--    'result_corrected' realtime event to both teams + the venue
--    + the league.
--
-- 2. notify_venue_change — restores the FULL Phase 2 reason list
--    that mig 121 silently dropped (regression: mig 121's
--    CREATE OR REPLACE shrank the whitelist from 26 reasons to 3,
--    so every Phase 2 RPC calling notify_venue_change with
--    e.g. 'fixture_postponed' has been logging WARNINGs since 121
--    shipped). Adds 'result_corrected' for the new RPC. Pre-existing
--    regression — fixing it here in passing because I'm rewriting
--    the function body anyway; not a behavioural change, just stops
--    warning spam.
--
-- 3. notify_league_change — adds 'fixture_result_corrected' to its
--    whitelist for the same reason.
--
-- Why not store the correction reason on a fixtures column?
--   The reason is purely auditable — it's not displayed anywhere
--   user-facing today. Keeping it in audit_events.metadata avoids a
--   schema change. If a later cycle needs to render the latest
--   correction reason on the PostMatch screen, the read can come
--   from audit_events directly.
--
-- Standings cascade: nothing to do. get_league_standings_for_player
-- (mig 087/104) reads home_score/away_score from fixtures at
-- request time — the override write is enough for the next
-- standings read to reflect it.
--
-- RLS / grants:
--   SECURITY DEFINER, search_path locked, REVOKE FROM PUBLIC,
--   GRANT EXECUTE to anon + authenticated. Same shape as mig 096
--   (venue_update_fixture_status).

-- ──────────────────────────────────────────────────────────────────
-- 1. notify_venue_change — restore Phase 2 reasons + add Phase 3
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    -- Phase 2 reasons (from mig 101) — restored after mig 121 regression
    'venue_created',
    'venue_updated',
    'season_created',
    'season_updated',
    'fixtures_generated',
    'fixtures_cascaded',
    'fixture_scheduled',
    'fixture_status_changed',
    'fixture_postponed',
    'fixture_voided',
    'fixture_walkover',
    'fixture_forfeit',
    'ref_assigned',
    'ref_changed',
    'ref_no_show',
    'ref_added',
    'ref_updated',
    'pitch_assigned',
    'pitch_added',
    'pitch_updated',
    'pitch_closed',
    'team_registration_pending',
    'team_approved',
    'team_rejected',
    'team_withdrew',
    'team_expelled',
    'incident_flagged',
    -- Phase 3 ref events (mig 121)
    'match_started',
    'match_event_recorded',
    'match_result_saved',
    -- Phase 3 venue overrides (mig 127)
    'result_corrected'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_venue_change: unknown reason "%" for venue "%"',
      p_reason, p_venue_id;
  END IF;

  SELECT live_channel_key INTO v_channel_key
  FROM venues WHERE id = p_venue_id;

  IF v_channel_key IS NULL THEN RETURN; END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'type',   'venue_state_changed',
      'reason', p_reason,
      'at',     extract(epoch from now())
    ),
    'broadcast',
    'venue_live:' || v_channel_key,
    false
  );
END;
$function$;

REVOKE ALL     ON FUNCTION public.notify_venue_change(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_venue_change(text, text) FROM anon, authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 2. notify_league_change — add fixture_result_corrected
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_league_change(p_league_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key text;
  v_known_reasons text[] := ARRAY[
    'league_created',
    'league_updated',
    'season_created',
    'fixtures_generated',
    'fixtures_cascaded',
    'fixture_status_changed',
    'standings_updated',
    'team_registration_pending',
    'team_approved',
    'team_rejected',
    'team_withdrew',
    'team_expelled',
    'squad_mode_locked',
    -- Phase 3 (mig 127)
    'fixture_result_corrected'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_league_change: unknown reason "%" for league "%"',
      p_reason, p_league_id;
  END IF;

  SELECT live_channel_key INTO v_channel_key
  FROM leagues WHERE id = p_league_id;

  IF v_channel_key IS NULL THEN RETURN; END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'type',   'league_state_changed',
      'reason', p_reason,
      'at',     extract(epoch from now())
    ),
    'broadcast',
    'league_live:' || v_channel_key,
    false
  );
END;
$function$;

REVOKE ALL     ON FUNCTION public.notify_league_change(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_league_change(text, text) FROM anon, authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 3. venue_update_fixture_result
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_update_fixture_result(
  p_venue_token text,
  p_fixture_id  uuid,
  p_home_score  integer,
  p_away_score  integer,
  p_reason      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_fixture  record;
  v_league_id text;
  v_prev_home int;
  v_prev_away int;
  v_clean_reason text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_home_score IS NULL OR p_away_score IS NULL THEN
    RAISE EXCEPTION 'scores_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_home_score < 0 OR p_away_score < 0 THEN
    RAISE EXCEPTION 'scores_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;

  v_clean_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.id, f.status, f.competition_id, f.home_team_id, f.away_team_id,
         f.home_score, f.away_score,
         s.league_id, l.venue_id AS l_venue
  INTO v_fixture
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE f.id = p_fixture_id;

  IF v_fixture.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.l_venue <> v_venue_id THEN
    RAISE EXCEPTION 'fixture_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.status <> 'completed' THEN
    RAISE EXCEPTION 'fixture_not_completed' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  v_league_id := v_fixture.league_id;
  v_prev_home := v_fixture.home_score;
  v_prev_away := v_fixture.away_score;

  UPDATE fixtures
     SET home_score = p_home_score,
         away_score = p_away_score
   WHERE id = p_fixture_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_fixture.home_team_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'venue_update_fixture_result', 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'competition_id', v_fixture.competition_id,
      'league_id',      v_league_id,
      'home_team_id',   v_fixture.home_team_id,
      'away_team_id',   v_fixture.away_team_id,
      'previous_home_score', v_prev_home,
      'previous_away_score', v_prev_away,
      'new_home_score',      p_home_score,
      'new_away_score',      p_away_score,
      'reason',              v_clean_reason
    )
  );

  PERFORM public.notify_team_change(v_fixture.home_team_id, 'result_corrected');
  IF v_fixture.away_team_id IS NOT NULL THEN
    PERFORM public.notify_team_change(v_fixture.away_team_id, 'result_corrected');
  END IF;
  PERFORM public.notify_venue_change(v_venue_id, 'result_corrected');
  PERFORM public.notify_league_change(v_league_id, 'fixture_result_corrected');

  RETURN jsonb_build_object(
    'ok',         true,
    'fixture_id', p_fixture_id,
    'home_score', p_home_score,
    'away_score', p_away_score,
    'previous_home_score', v_prev_home,
    'previous_away_score', v_prev_away
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_update_fixture_result(text, uuid, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_fixture_result(text, uuid, integer, integer, text)
  TO anon, authenticated;
