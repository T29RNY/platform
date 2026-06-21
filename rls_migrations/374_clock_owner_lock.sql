-- 374: Phase 0d — Watch ↔ phone live-match single-writer lock (Unified Identity & Sync Spine)
--
-- Today two devices holding the SAME ref_token (phone apps/ref + the future watch) can both
-- write the live clock concurrently → last-write-wins jitter. client_event_id only dedups RETRIES
-- of one device's single tap; two different devices mint different ids, so both writes land.
--
-- This migration adds a fixture-scoped, lease-based clock-owner ELECTION ("who holds the remote"):
--   • ref_claim_clock     — claim/take-over the live clock for a device (30s lease)
--   • ref_heartbeat_clock — extend the lease while a device still controls
--   • ref_release_clock   — hand the remote back
--   • ref_check_clock_owner — advisory read: is this device the owner? (the ⌚CTRL badge + the
--                              future server-side enforcement hook)
--
-- ⚠️ SHIPS DORMANT (operator decision, session 167 — Option A). The existing clock-write RPCs
--    (ref_set_clock / ref_record_goal / …) are NOT modified to REJECT non-owners in this migration.
--    The phone auto-claims and shows the badge, but nothing is blocked yet. Server-side ENFORCEMENT
--    (wiring ref_check_clock_owner into the write RPCs + a p_device_id arg) is the deferred "flip the
--    switch" follow-up, to be done WITH the real phone+watch concurrency rehearsal (cannot be tested
--    bot-solo). Until then live-match behaviour is byte-identical to today.
--
-- Also folds in two adjacent fixes:
--   • Hard Rule #10 publisher gap: ref_set_clock + ref_set_added_time published ONLY to the venue
--     channel, not the team channel — so an inorout team-channel follower never saw a pause/resume
--     or added-time change. Every other clock/scoring write already notifies both. Normalised here
--     so a future watch/phone realtime listener has ONE consistent fixture feed (deliverable 2).
--   • Casual-ref activation validator (deliverable 4): validate_casual_ref_activations lists casual
--     refs assigned (matches.ref_player_id) before their player account is linked, keeping
--     ref_token ↔ person_id coherent (the player IS the squad member; person_id auto-fills on link
--     via the mig-371 trigger, so an unlinked ref simply has no person_id yet).
--
-- CONSUMERS (Hard Rule #14): the four ref_*_clock RPCs feed apps/ref (badge + auto-claim now) and
-- the watchOS companion (later session). validate_casual_ref_activations feeds the inorout admin.

-- ─── 1. Clock-owner columns on fixtures (all nullable — additive, zero impact on existing rows) ──

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS clock_owner_id         text,
  ADD COLUMN IF NOT EXISTS clock_owner_kind       text,
  ADD COLUMN IF NOT EXISTS clock_owner_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS clock_owner_expires_at timestamptz;

COMMENT ON COLUMN public.fixtures.clock_owner_id IS
  'Phase 0d single-writer lock: device id currently holding the live-match clock (NULL = none). Lease in clock_owner_expires_at (a live owner = id set AND expires_at > now()). ENFORCEMENT DORMANT — clock-write RPCs do not yet reject non-owners; flip on after the phone+watch rehearsal.';

-- ─── 2. Owner-state formatter (non-SECDEF helper; reads only its composite argument) ─────────────

CREATE OR REPLACE FUNCTION public._ref_clock_owner_json(v public.fixtures)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'owner_id',   v.clock_owner_id,
    'owner_kind', v.clock_owner_kind,
    'claimed_at', v.clock_owner_claimed_at,
    'expires_at', v.clock_owner_expires_at,
    'is_live',    (v.clock_owner_id IS NOT NULL
                   AND v.clock_owner_expires_at IS NOT NULL
                   AND v.clock_owner_expires_at > now())
  );
$function$;

-- ─── 3. ref_claim_clock — claim or take over the live clock (write) ──────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_claim_clock(
  p_ref_token   text,
  p_device_id   text,
  p_device_kind text    DEFAULT 'ref',
  p_force       boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture    public.fixtures;
  v_live_owner boolean;
  v_can_take   boolean;
  v_changed    boolean;
  v_venue_id   text;
BEGIN
  IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'missing_device_id' USING ERRCODE = 'P0001';
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);

  v_live_owner := (v_fixture.clock_owner_id IS NOT NULL
                   AND v_fixture.clock_owner_expires_at IS NOT NULL
                   AND v_fixture.clock_owner_expires_at > now());
  -- can take if: no live owner, OR I already hold it, OR explicit takeover
  v_can_take := (NOT v_live_owner)
                OR (v_fixture.clock_owner_id = p_device_id)
                OR p_force;

  IF v_can_take THEN
    v_changed := (v_fixture.clock_owner_id IS DISTINCT FROM p_device_id);
    UPDATE public.fixtures
       SET clock_owner_id      = p_device_id,
           clock_owner_kind    = COALESCE(p_device_kind, 'ref'),
           clock_owner_claimed_at = CASE WHEN v_changed THEN now() ELSE clock_owner_claimed_at END,
           clock_owner_expires_at = now() + interval '30 seconds'
     WHERE id = v_fixture.id;

    IF v_changed THEN
      INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
      VALUES (v_fixture.home_team_id, 'referee', p_ref_token,
              CASE WHEN p_force AND v_live_owner THEN 'ref_clock_taken_over' ELSE 'ref_clock_claimed' END,
              'fixture', v_fixture.id::text,
              jsonb_build_object('device_id', p_device_id, 'device_kind', p_device_kind, 'forced', p_force));
      PERFORM public.notify_team_change(v_fixture.home_team_id, 'clock_owner_changed');
      IF v_fixture.away_team_id IS NOT NULL THEN
        PERFORM public.notify_team_change(v_fixture.away_team_id, 'clock_owner_changed');
      END IF;
      v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
      IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, 'clock_owner_changed'); END IF;
    END IF;
  END IF;

  SELECT * INTO v_fixture FROM public.fixtures WHERE id = v_fixture.id;
  RETURN jsonb_build_object('ok', true, 'granted', v_can_take, 'owner', public._ref_clock_owner_json(v_fixture));
END;
$function$;

-- ─── 4. ref_heartbeat_clock — extend the lease while still controlling (write, keepalive) ─────────

CREATE OR REPLACE FUNCTION public.ref_heartbeat_clock(p_ref_token text, p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_is_owner boolean;
BEGIN
  IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'missing_device_id' USING ERRCODE = 'P0001';
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  v_is_owner := (v_fixture.clock_owner_id = p_device_id
                 AND v_fixture.clock_owner_expires_at IS NOT NULL
                 AND v_fixture.clock_owner_expires_at > now());
  IF v_is_owner THEN
    UPDATE public.fixtures SET clock_owner_expires_at = now() + interval '30 seconds' WHERE id = v_fixture.id;
    SELECT * INTO v_fixture FROM public.fixtures WHERE id = v_fixture.id;
  END IF;
  -- pure keepalive: no audit, no broadcast (extends lease only); granted=false means you lost control
  RETURN jsonb_build_object('ok', true, 'granted', v_is_owner, 'owner', public._ref_clock_owner_json(v_fixture));
END;
$function$;

-- ─── 5. ref_release_clock — hand the remote back (write) ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_release_clock(p_ref_token text, p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_released boolean := false; v_venue_id text;
BEGIN
  IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'missing_device_id' USING ERRCODE = 'P0001';
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.clock_owner_id = p_device_id THEN
    UPDATE public.fixtures
       SET clock_owner_id = NULL, clock_owner_kind = NULL,
           clock_owner_claimed_at = NULL, clock_owner_expires_at = NULL
     WHERE id = v_fixture.id;
    v_released := true;
    INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_fixture.home_team_id, 'referee', p_ref_token, 'ref_clock_released', 'fixture', v_fixture.id::text,
            jsonb_build_object('device_id', p_device_id));
    PERFORM public.notify_team_change(v_fixture.home_team_id, 'clock_owner_changed');
    IF v_fixture.away_team_id IS NOT NULL THEN
      PERFORM public.notify_team_change(v_fixture.away_team_id, 'clock_owner_changed');
    END IF;
    v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
    IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, 'clock_owner_changed'); END IF;
    SELECT * INTO v_fixture FROM public.fixtures WHERE id = v_fixture.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'released', v_released, 'owner', public._ref_clock_owner_json(v_fixture));
END;
$function$;

-- ─── 6. ref_check_clock_owner — advisory read (badge + future enforcement hook) ──────────────────

CREATE OR REPLACE FUNCTION public.ref_check_clock_owner(p_ref_token text, p_device_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_owner jsonb;
BEGIN
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  v_owner := public._ref_clock_owner_json(v_fixture);
  RETURN jsonb_build_object(
    'ok',             true,
    'owner',          v_owner,
    'has_live_owner', COALESCE((v_owner->>'is_live')::boolean, false),
    'is_owner',       (p_device_id IS NOT NULL
                       AND COALESCE((v_owner->>'is_live')::boolean, false)
                       AND v_owner->>'owner_id' = p_device_id)
  );
END;
$function$;

-- ─── 7. Hard Rule #10 publisher fix — clock + added-time now notify the team channel too ─────────
-- (CREATE OR REPLACE of the two RPCs that published venue-only; bodies byte-identical except the
--  added notify_team_change calls.)

CREATE OR REPLACE FUNCTION public.ref_set_clock(p_ref_token text, p_action text, p_client_event_id uuid, p_local_timestamp timestamp with time zone DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

  v_minute := GREATEST(0, floor((
    extract(epoch FROM (p_local_timestamp - COALESCE(v_fixture.actual_kickoff_at, p_local_timestamp))) * 1000
    - v_fixture.clock_paused_ms
  ) / 60000)::int);

  INSERT INTO public.match_events
    (fixture_id, team_id, event_type, minute, period, recorded_by_token, recorded_by_type, local_timestamp, synced_at, client_event_id)
  VALUES
    (v_fixture.id, v_fixture.home_team_id, 'clock_' || p_action, v_minute,
     COALESCE((SELECT me.period FROM public.match_events me
                WHERE me.fixture_id = v_fixture.id AND me.event_type = 'period_change'
                ORDER BY me.created_at DESC LIMIT 1), '1H'),
     p_ref_token, 'referee', p_local_timestamp, now(), p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    IF p_action = 'pause' THEN
      UPDATE public.fixtures SET clock_paused_at = p_local_timestamp
       WHERE id = v_fixture.id AND clock_paused_at IS NULL;
    ELSE
      UPDATE public.fixtures
         SET clock_paused_ms = clock_paused_ms
               + GREATEST(0, (extract(epoch FROM (p_local_timestamp - clock_paused_at)) * 1000)::bigint),
             clock_paused_at = NULL
       WHERE id = v_fixture.id AND clock_paused_at IS NOT NULL;
    END IF;

    INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_fixture.home_team_id, 'referee', p_ref_token, 'ref_set_clock', 'fixture', v_fixture.id::text,
      jsonb_build_object('clock_action', p_action, 'at', p_local_timestamp, 'client_event_id', p_client_event_id));

    -- Hard Rule #10: notify BOTH the team channel(s) and the venue channel (was venue-only).
    PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_event_recorded'); END IF;
    v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
    IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, 'match_event_recorded'); END IF;
  END IF;

  SELECT * INTO v_fixture FROM public.fixtures WHERE id = v_fixture.id;
  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'duplicate', v_event_id IS NULL,
    'clock_paused_at', v_fixture.clock_paused_at, 'clock_paused_ms', v_fixture.clock_paused_ms);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ref_set_added_time(p_ref_token text, p_period text, p_minutes integer, p_client_event_id uuid, p_local_timestamp timestamp with time zone DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_venue_id text;
BEGIN
  IF p_period IS NULL OR length(trim(p_period)) = 0 THEN RAISE EXCEPTION 'missing_period' USING ERRCODE='P0001'; END IF;
  IF p_minutes IS NULL OR p_minutes < 0 THEN RAISE EXCEPTION 'invalid_added_time' USING ERRCODE='P0001'; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;

  UPDATE public.fixtures
     SET added_time = jsonb_set(COALESCE(added_time, '{}'::jsonb), ARRAY[p_period], to_jsonb(p_minutes), true)
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_fixture.home_team_id, 'referee', p_ref_token, 'ref_set_added_time', 'fixture', v_fixture.id::text,
    jsonb_build_object('period', p_period, 'minutes', p_minutes, 'client_event_id', p_client_event_id));

  -- Hard Rule #10: notify BOTH the team channel(s) and the venue channel (was venue-only).
  PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_event_recorded');
  IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_event_recorded'); END IF;
  v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
  IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, 'match_event_recorded'); END IF;

  RETURN jsonb_build_object('ok', true, 'period', p_period, 'minutes', p_minutes);
END;
$function$;

-- ─── 8. get_fixture_state_by_ref_token — expose clock_owner block (additive return field) ─────────
-- Re-create with the existing body plus a 'clock_owner' key on the fixture object so apps/ref / the
-- watch can render the ⌚CTRL badge. Every existing field is byte-preserved (Hard Rule #12 additive).

CREATE OR REPLACE FUNCTION public.get_fixture_state_by_ref_token(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture      record;
  v_fixture_row  public.fixtures;
  v_result       jsonb;
  v_league_id    text;
  v_lc           jsonb;
  v_comp_config  jsonb;
  v_match_format jsonb;
BEGIN
  IF p_ref_token IS NULL OR length(trim(p_ref_token)) = 0 THEN
    RAISE EXCEPTION 'invalid_ref_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.* INTO v_fixture
  FROM fixtures f
  WHERE f.ref_token = p_ref_token;

  IF v_fixture.id IS NULL THEN
    RAISE EXCEPTION 'invalid_ref_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_fixture_row FROM public.fixtures WHERE id = v_fixture.id;

  SELECT l.id INTO v_league_id
  FROM competitions c
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues  l ON l.id = s.league_id
  WHERE c.id = v_fixture.competition_id;

  SELECT to_jsonb(lc) INTO v_lc FROM league_config lc WHERE lc.league_id = v_league_id;
  IF v_lc IS NULL THEN
    SELECT to_jsonb(lc) INTO v_lc FROM league_config lc WHERE lc.league_id IS NULL LIMIT 1;
  END IF;

  SELECT config INTO v_comp_config FROM competitions WHERE id = v_fixture.competition_id;

  v_match_format :=
      jsonb_build_object(
        'num_periods',         v_lc->'num_periods',
        'period_length_mins',  v_lc->'period_length_mins',
        'period_names',        v_lc->'period_names',
        'match_duration_mins', v_lc->'match_duration_mins',
        'has_sin_bin',         v_lc->'has_sin_bin',
        'sin_bin_mins',        v_lc->'sin_bin_mins'
      )
    || COALESCE(v_comp_config->'match_format', '{}'::jsonb)
    || COALESCE(v_fixture.format_override, '{}'::jsonb)
    || jsonb_build_object('is_overridden', v_fixture.format_override IS NOT NULL);

  WITH
  comp AS (
    SELECT c.id, c.name, c.type, c.format, c.season_id
    FROM competitions c WHERE c.id = v_fixture.competition_id
  ),
  season AS (
    SELECT s.id, s.name, s.league_id
    FROM seasons s WHERE s.id = (SELECT season_id FROM comp)
  ),
  league AS (
    SELECT l.id, l.name, l.sport, l.venue_id, l.format
    FROM leagues l WHERE l.id = (SELECT league_id FROM season)
  ),
  venue AS (
    SELECT v.id, v.name, v.sport
    FROM venues v WHERE v.id = (SELECT venue_id FROM league)
  ),
  pitch AS (
    SELECT p.id, p.name, p.surface
    FROM playing_areas p WHERE p.id = v_fixture.playing_area_id
  ),
  official AS (
    SELECT r.id, r.name, r.preferred_channel
    FROM match_officials r WHERE r.id = v_fixture.official_id
  ),
  home_team AS (
    SELECT t.id, t.name, t.primary_colour, t.secondary_colour
    FROM teams t WHERE t.id = v_fixture.home_team_id
    UNION ALL
    SELECT ct.id::text, ct.team_name, NULL::text, NULL::text
    FROM competition_teams ct
    WHERE ct.id = v_fixture.home_competition_team_id
      AND v_fixture.home_team_id IS NULL
  ),
  away_team AS (
    SELECT t.id, t.name, t.primary_colour, t.secondary_colour
    FROM teams t WHERE t.id = v_fixture.away_team_id
    UNION ALL
    SELECT ct.id::text, ct.team_name, NULL::text, NULL::text
    FROM competition_teams ct
    WHERE ct.id = v_fixture.away_competition_team_id
      AND v_fixture.away_team_id IS NULL
  ),
  events AS (
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'id',                 e.id,
          'event_type',         e.event_type,
          'minute',             e.minute,
          'period',             e.period,
          'team_id',            e.team_id,
          'player_id',          e.player_id,
          'player_name_override', e.player_name_override,
          'sub_player_on_id',   e.sub_player_on_id,
          'sub_player_off_id',  e.sub_player_off_id,
          'note_text',          e.note_text,
          'duration',           e.duration,
          'recorded_by_type',   e.recorded_by_type,
          'synced_at',          e.synced_at,
          'local_timestamp',    e.local_timestamp,
          'created_at',         e.created_at
        )
        ORDER BY e.minute, e.created_at
      ) AS list
    FROM match_events e
    WHERE e.fixture_id = v_fixture.id
  )
  SELECT jsonb_build_object(
    'fixture', jsonb_build_object(
      'id',                        v_fixture.id,
      'competition_id',            v_fixture.competition_id,
      'home_team_id',              v_fixture.home_team_id,
      'away_team_id',              v_fixture.away_team_id,
      'home_competition_team_id',  v_fixture.home_competition_team_id,
      'away_competition_team_id',  v_fixture.away_competition_team_id,
      'week_number',               v_fixture.week_number,
      'round_name',                v_fixture.round_name,
      'scheduled_date',            v_fixture.scheduled_date,
      'kickoff_time',              v_fixture.kickoff_time,
      'playing_area_id',           v_fixture.playing_area_id,
      'official_id',               v_fixture.official_id,
      'status',                    v_fixture.status,
      'home_score',                v_fixture.home_score,
      'away_score',                v_fixture.away_score,
      'current_period',            v_fixture.current_period,
      'walkover_winner_id',        v_fixture.walkover_winner_id,
      'forfeit_winner_id',         v_fixture.forfeit_winner_id,
      'postpone_reason',           v_fixture.postpone_reason,
      'void_reason',               v_fixture.void_reason,
      'forfeit_reason',            v_fixture.forfeit_reason,
      'actual_kickoff_at',         v_fixture.actual_kickoff_at,
      'clock_paused_at',           v_fixture.clock_paused_at,
      'clock_paused_ms',           v_fixture.clock_paused_ms,
      'added_time',                v_fixture.added_time,
      'format_override',           v_fixture.format_override,
      'clock_owner',               public._ref_clock_owner_json(v_fixture_row)
    ),
    'match_format', v_match_format,
    'competition',  (SELECT to_jsonb(c.*) FROM comp c),
    'league',       (SELECT to_jsonb(l.*) FROM league l),
    'venue',        (SELECT to_jsonb(v.*) FROM venue v),
    'pitch',        (SELECT to_jsonb(p.*) FROM pitch p),
    'official',     (SELECT to_jsonb(r.*) FROM official r),
    'home_team',    (SELECT to_jsonb(t.*) FROM home_team t),
    'away_team',    (SELECT to_jsonb(t.*) FROM away_team t),
    'home_squad',   public._fixture_squad_json(v_fixture.id, v_fixture.home_team_id, v_fixture.competition_id),
    'away_squad',   CASE WHEN v_fixture.away_team_id IS NULL THEN '[]'::jsonb
                         ELSE public._fixture_squad_json(v_fixture.id, v_fixture.away_team_id, v_fixture.competition_id) END,
    'events',       COALESCE((SELECT list FROM events), '[]'::jsonb),
    'caller',       jsonb_build_object(
                      'actor_type', 'ref_token',
                      'fixture_id', v_fixture.id
                    )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

-- ─── 9. validate_casual_ref_activations — flag casual refs assigned before account-link (read) ────

CREATE OR REPLACE FUNCTION public.validate_casual_ref_activations(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_team_id text; v_list jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_admin_caller(p_admin_token);
  IF v_caller IS NULL OR v_caller.team_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_token' USING ERRCODE = 'P0001';
  END IF;
  v_team_id := v_caller.team_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'match_id',       m.id,
           'ref_player_id',  m.ref_player_id,
           'ref_token',      m.ref_token,
           'player_name',    p.name,
           'account_linked', (p.user_id IS NOT NULL),
           'person_id',      p.person_id,
           'kickoff_time',   m.kickoff_time
         ) ORDER BY m.id), '[]'::jsonb)
    INTO v_list
  FROM public.matches m
  JOIN public.players p ON p.id = m.ref_player_id
  WHERE m.team_id = v_team_id
    AND m.ref_player_id IS NOT NULL
    AND p.user_id IS NULL;   -- assigned, but the player's account is not yet linked → not activated

  RETURN jsonb_build_object(
    'ok',               true,
    'team_id',          v_team_id,
    'unactivated_count', jsonb_array_length(v_list),
    'unactivated',      v_list
  );
END;
$function$;

-- ─── 10. Grants — ref clock RPCs are ref_token-scoped (anon allowed, like all ref_* RPCs); the
--          validator is admin-token-scoped (like assign_casual_match_ref). REVOKE PUBLIC first. ───

REVOKE ALL ON FUNCTION public.ref_claim_clock(text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ref_heartbeat_clock(text, text)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ref_release_clock(text, text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ref_check_clock_owner(text, text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_casual_ref_activations(text)     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ref_claim_clock(text, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ref_heartbeat_clock(text, text)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ref_release_clock(text, text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ref_check_clock_owner(text, text)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_casual_ref_activations(text)     TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
