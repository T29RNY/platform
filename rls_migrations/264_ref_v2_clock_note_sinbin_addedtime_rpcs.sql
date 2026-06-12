-- Migration 264 — Ref V2: new referee write RPCs (clock pause/resume, incident note,
-- sin bin, added/stoppage time). Cycle "RefSix-killer" / apps/ref/REF_V2_BUILD_PLAN.md, §5.
--
-- All four mirror the established mig-121 ref-write pattern:
--   resolve fixture by ref_token → guard status='in_progress' → write → audit_events row
--   → realtime broadcasts. They reuse the EXISTING `notify_venue_change`/`notify_team_change`
--   helpers and the EXISTING whitelisted reason 'match_event_recorded' (the reception display
--   and venue dashboard refetch on ANY venue_live ping — they don't filter by reason — so no
--   change to the heavily-evolved notify_venue_change whitelist is needed or wise).
--
-- IDEMPOTENCY (offline drain may replay a queued action):
--   note + sin_bin are match_events → UNIQUE(client_event_id) ON CONFLICT DO NOTHING (free).
--   ref_set_clock ALSO writes a match_event ('clock_pause'/'clock_resume') purely to get that
--     same idempotency key, and only mutates the fixture clock columns when the event row is
--     FRESH (v_event_id IS NOT NULL) AND the column guard holds (can't pause while paused /
--     resume while running). This makes a [pause,resume] pair safe to re-drain any number of
--     times without inflating clock_paused_ms.
--   ref_set_added_time is an ABSOLUTE set (period → minutes) → naturally idempotent; no event.
--
-- event_type / period stay OPEN TEXT (sport-extensibility) — no new constraints.

-- ──────────────────────────────────────────────────────────────────
-- 1. ref_set_clock — pause / resume the per-fixture clock (offline-safe)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ref_set_clock(
  p_ref_token       text,
  p_action          text,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture  public.fixtures;
  v_event_id uuid;
  v_minute   integer;
  v_venue_id text;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_action NOT IN ('pause','resume') THEN RAISE EXCEPTION 'invalid_clock_action' USING ERRCODE='P0001', DETAIL=p_action; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;

  -- pause-aware minute at the action timestamp (best-effort; 0 if no kickoff yet)
  v_minute := GREATEST(0, floor((
    extract(epoch FROM (p_local_timestamp - COALESCE(v_fixture.actual_kickoff_at, p_local_timestamp))) * 1000
    - v_fixture.clock_paused_ms
  ) / 60000)::int);

  INSERT INTO public.match_events
    (fixture_id, team_id, event_type, minute, period, recorded_by_token, recorded_by_type, local_timestamp, synced_at, client_event_id)
  VALUES
    (v_fixture.id, v_fixture.home_team_id, 'clock_' || p_action, v_minute,
     -- current period = latest period_change, default '1H' (no server derive_period helper)
     COALESCE((SELECT me.period FROM public.match_events me
                WHERE me.fixture_id = v_fixture.id AND me.event_type = 'period_change'
                ORDER BY me.created_at DESC LIMIT 1), '1H'),
     p_ref_token, 'referee', p_local_timestamp, now(), p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    IF p_action = 'pause' THEN
      -- only if currently running (guard makes a double-pause a no-op even on a fresh event)
      UPDATE public.fixtures SET clock_paused_at = p_local_timestamp
       WHERE id = v_fixture.id AND clock_paused_at IS NULL;
    ELSE
      -- accumulate the just-finished pause interval, then clear (only if currently paused)
      UPDATE public.fixtures
         SET clock_paused_ms = clock_paused_ms
               + GREATEST(0, (extract(epoch FROM (p_local_timestamp - clock_paused_at)) * 1000)::bigint),
             clock_paused_at = NULL
       WHERE id = v_fixture.id AND clock_paused_at IS NOT NULL;
    END IF;

    INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_fixture.home_team_id, 'referee', p_ref_token, 'ref_set_clock', 'fixture', v_fixture.id::text,
      jsonb_build_object('clock_action', p_action, 'at', p_local_timestamp, 'client_event_id', p_client_event_id));

    -- venue/display care about the freeze; team-admin tab has no clock → venue broadcast only
    v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
    IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, 'match_event_recorded'); END IF;
  END IF;

  SELECT * INTO v_fixture FROM public.fixtures WHERE id = v_fixture.id;
  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'duplicate', v_event_id IS NULL,
    'clock_paused_at', v_fixture.clock_paused_at, 'clock_paused_ms', v_fixture.clock_paused_ms);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 2. ref_record_note — free-text incident note, optionally on a player
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ref_record_note(
  p_ref_token       text,
  p_text            text,
  p_player_id       text,
  p_minute          integer,
  p_period          text,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_team_id text; v_event_id uuid; v_venue_id text;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN RAISE EXCEPTION 'missing_note_text' USING ERRCODE='P0001'; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;

  -- optional player attribution; team derived if the player is in this fixture
  IF p_player_id IS NOT NULL THEN
    SELECT pr.team_id INTO v_team_id FROM player_registrations pr
     WHERE pr.player_id = p_player_id AND pr.competition_id = v_fixture.competition_id
       AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id,'')) LIMIT 1;
  END IF;

  INSERT INTO public.match_events
    (fixture_id, team_id, player_id, event_type, minute, period, note_text, recorded_by_token, recorded_by_type, local_timestamp, synced_at, client_event_id)
  VALUES
    (v_fixture.id, v_team_id, p_player_id, 'note', p_minute, p_period, trim(p_text), p_ref_token, 'referee', p_local_timestamp, now(), p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_team_id, 'referee', p_ref_token, 'ref_record_note', 'match_event', v_event_id::text,
      jsonb_build_object('fixture_id', v_fixture.id, 'player_id', p_player_id, 'minute', p_minute, 'period', p_period, 'client_event_id', p_client_event_id));
    PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_event_recorded'); END IF;
    v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
    IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, 'match_event_recorded'); END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'duplicate', v_event_id IS NULL);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 3. ref_record_sin_bin — temporary dismissal, duration in minutes
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ref_record_sin_bin(
  p_ref_token       text,
  p_player_id       text,
  p_minute          integer,
  p_period          text,
  p_duration_min    integer,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_team_id text; v_event_id uuid; v_venue_id text;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_duration_min IS NULL OR p_duration_min <= 0 THEN RAISE EXCEPTION 'invalid_sin_bin_duration' USING ERRCODE='P0001'; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;

  SELECT pr.team_id INTO v_team_id FROM player_registrations pr
   WHERE pr.player_id = p_player_id AND pr.competition_id = v_fixture.competition_id
     AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id,'')) LIMIT 1;
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'player_not_in_fixture' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.match_events
    (fixture_id, team_id, player_id, event_type, minute, period, duration, recorded_by_token, recorded_by_type, local_timestamp, synced_at, client_event_id)
  VALUES
    (v_fixture.id, v_team_id, p_player_id, 'sin_bin', p_minute, p_period, p_duration_min, p_ref_token, 'referee', p_local_timestamp, now(), p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_team_id, 'referee', p_ref_token, 'ref_record_sin_bin', 'match_event', v_event_id::text,
      jsonb_build_object('fixture_id', v_fixture.id, 'player_id', p_player_id, 'minute', p_minute, 'period', p_period, 'duration', p_duration_min, 'client_event_id', p_client_event_id));
    PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_event_recorded'); END IF;
    v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
    IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, 'match_event_recorded'); END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'team_id', v_team_id, 'duplicate', v_event_id IS NULL);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 4. ref_set_added_time — absolute stoppage minutes for a period (idempotent set)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ref_set_added_time(
  p_ref_token       text,
  p_period          text,
  p_minutes         integer,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_venue_id text;
BEGIN
  IF p_period IS NULL OR length(trim(p_period)) = 0 THEN RAISE EXCEPTION 'missing_period' USING ERRCODE='P0001'; END IF;
  IF p_minutes IS NULL OR p_minutes < 0 THEN RAISE EXCEPTION 'invalid_added_time' USING ERRCODE='P0001'; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;

  -- absolute set: added_time[period] = minutes (jsonb_set, idempotent on replay)
  UPDATE public.fixtures
     SET added_time = jsonb_set(COALESCE(added_time, '{}'::jsonb), ARRAY[p_period], to_jsonb(p_minutes), true)
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_fixture.home_team_id, 'referee', p_ref_token, 'ref_set_added_time', 'fixture', v_fixture.id::text,
    jsonb_build_object('period', p_period, 'minutes', p_minutes, 'client_event_id', p_client_event_id));

  v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
  IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, 'match_event_recorded'); END IF;

  RETURN jsonb_build_object('ok', true, 'period', p_period, 'minutes', p_minutes);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- Grants — refs call these anon from the phone (same as the mig-120/121 ref RPCs)
-- ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ref_set_clock(text, text, uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_set_clock(text, text, uuid, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.ref_record_note(text, text, text, integer, text, uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_record_note(text, text, text, integer, text, uuid, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.ref_record_sin_bin(text, text, integer, text, integer, uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_record_sin_bin(text, text, integer, text, integer, uuid, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.ref_set_added_time(text, text, integer, uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_set_added_time(text, text, integer, uuid, timestamptz) TO anon, authenticated;
