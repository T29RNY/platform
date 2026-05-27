-- 120_phase3_ref_match_writes.sql
--
-- Phase 3 (League Mode) — Cycle 3.2 server-side ref writes.
--
-- The referee opens https://app/ref/<ref_token>, taps Start Match,
-- then logs goals / cards / subs / period changes / full-time over
-- the next ~50 minutes. This migration ships the write surface:
-- 7 SECURITY DEFINER RPCs, one schema addition for offline-replay
-- idempotency, one column for the running-timer source, and a
-- two-reason extension to the realtime broadcast whitelist.
--
-- Design decisions (locked in plan
-- `~/.claude/plans/plain-english-please-jazzy-spring.md` and audit):
--
-- 1. Idempotency via `match_events.client_event_id uuid UNIQUE`.
--    Every tap on the ref's phone generates a UUID client-side and
--    passes it on the RPC. The server upserts on conflict — if the
--    request actually went through before the network dropped and
--    the phone retried, the duplicate is a no-op. No double-counted
--    goals. Nullable so existing rows (none today) don't fail.
--
-- 2. `fixtures.actual_kickoff_at timestamptz` lets the ref's tab
--    compute a live MM:SS timer client-side from the server-recorded
--    start moment, surviving tab reloads and offline gaps.
--
-- 3. Realtime broadcasts re-use `notify_team_change` (mig 062) called
--    once per team. Team admins are already subscribed to
--    `team_live:<live_channel_key>` (App.jsx:786–827) — zero client
--    work to surface live score changes in their tabs.
--
--    The whitelist on mig 062 gets TWO new reasons:
--      - 'match_started'           — fires on ref_start_match
--      - 'match_event_recorded'    — fires on every goal/card/sub/period/undo
--    'match_result_saved' (already whitelisted) fires on full-time
--    confirm. Adding the reasons in the SAME migration as the calling
--    RPCs avoids the §6.3 whitelist-drift bug class (mig 049 retro-fix).
--
-- 4. Fixture-level broadcast channel (for ref's own tab + Phase 4
--    reception display) DEFERRED. The team-keyed broadcast already
--    covers team admins; Phase 4 will introduce display:<token>
--    channels when reception display ships. Scope discipline.
--
-- 5. `audit_events.actor_type` CHECK gets `'referee'` added — the
--    enum didn't include it, every ref RPC writes its audit row with
--    actor_type='referee' and actor_identifier=ref_token. Single
--    constraint replacement.
--
-- 6. Helper `_ref_resolve_fixture(p_ref_token)` (underscore prefix,
--    no grants to anon/authenticated) wraps the
--    token → fixture lookup + status guard so the seven RPCs stay
--    short and read-similar.
--
-- 7. Score materialisation on full-time:
--      home_score = goals where team=home + own_goals where team=away
--      away_score = mirror
--    Own goals are stored with team_id = scorer's actual team and
--    event_type='own_goal' per spec — they count for the OTHER team.
--
-- 8. Demo seed: registers 5 players per demo team into
--    player_registrations + assigns shirt numbers, so smoke tests
--    (and Cycle 3.3 UI) have non-empty squads. Idempotent
--    (ON CONFLICT DO NOTHING).

-- ──────────────────────────────────────────────────────────────────
-- 1. Schema additions
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.match_events
  ADD COLUMN IF NOT EXISTS client_event_id uuid;

-- UNIQUE on a nullable column allows multiple NULLs in PostgreSQL.
-- New inserts always supply a value and are enforced unique.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'match_events_client_event_id_key'
  ) THEN
    ALTER TABLE public.match_events
      ADD CONSTRAINT match_events_client_event_id_key UNIQUE (client_event_id);
  END IF;
END $$;

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS actual_kickoff_at timestamptz;

-- ──────────────────────────────────────────────────────────────────
-- 2. audit_events.actor_type — add 'referee'
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_actor_type_check
  CHECK (actor_type IN (
    'team_admin','vice_captain','club_admin','super_admin','player',
    'service_role','system','venue_admin','league_admin','platform_admin',
    'referee'
  ));

-- ──────────────────────────────────────────────────────────────────
-- 3. notify_team_change — extend whitelist with two new reasons
--    (CREATE OR REPLACE; body identical to mig 062 + two array entries)
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_team_change(p_team_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    'player_status_updated',
    'player_paid_updated',
    'player_injured_updated',
    'guest_player_added',
    'guest_payment_updated',
    'match_result_saved',
    'match_cancelled',
    'match_teams_saved',
    'match_bibs_saved',
    'schedule_updated',
    'player_added',
    'player_disabled',
    'player_deleted',
    'player_account_deleted',
    'player_vc_toggled',
    'payment_confirmed',
    'payment_reset',
    'debt_cleared',
    'debt_waived',
    'potm_vote_cast',
    'player_enabled',
    'settings_updated',
    'potm_voting_opened',
    'potm_result_announced',
    'player_note_updated',
    'player_updated',
    'player_priority_updated',
    'player_name_updated',
    'teams_confirmed',
    'teams_draft_saved',
    'game_live_toggled',
    'game_cancelled',
    'match_teams_confirmed',
    'guest_player_removed',
    -- Phase 3 Cycle 3.2 (mig 120) — ref live-match events
    'match_started',
    'match_event_recorded'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_team_change: unknown reason "%" for team "%"',
      p_reason, p_team_id;
  END IF;

  SELECT live_channel_key INTO v_channel_key
  FROM teams WHERE id = p_team_id;

  IF v_channel_key IS NULL THEN RETURN; END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'type',   'team_state_changed',
      'reason', p_reason,
      'at',     extract(epoch from now())
    ),
    'broadcast',
    'team_live:' || v_channel_key,
    false  -- public broadcast (channel-key UUID is the secret); see mig 062
  );
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 4. Private helper — resolve ref token to fixture
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._ref_resolve_fixture(p_ref_token text)
RETURNS public.fixtures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
BEGIN
  IF p_ref_token IS NULL OR length(trim(p_ref_token)) = 0 THEN
    RAISE EXCEPTION 'invalid_ref_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_fixture FROM public.fixtures WHERE ref_token = p_ref_token;
  IF v_fixture.id IS NULL THEN
    RAISE EXCEPTION 'invalid_ref_token' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_fixture;
END;
$function$;
REVOKE ALL     ON FUNCTION public._ref_resolve_fixture(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._ref_resolve_fixture(text) FROM anon, authenticated;
-- internal helper only — REVOKE FROM PUBLIC doesn't catch Supabase's default
-- grants to anon/authenticated on every public-schema function; need an
-- explicit REVOKE from those roles too.

-- ──────────────────────────────────────────────────────────────────
-- 5. Update get_fixture_state_by_ref_token to expose actual_kickoff_at
--    (additive — adds one field to the fixture sub-object; no consumer
--    breakage; Cycle 3.1 dbToFixture-style mappers don't exist yet)
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_fixture_state_by_ref_token(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture record;
  v_result  jsonb;
BEGIN
  v_fixture := public._ref_resolve_fixture(p_ref_token);

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
  ),
  away_team AS (
    SELECT t.id, t.name, t.primary_colour, t.secondary_colour
    FROM teams t WHERE t.id = v_fixture.away_team_id
  ),
  home_squad AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id, 'name', p.name, 'shirt_number', p.shirt_number,
        'registration_status', pr.status, 'suspension_until', pr.suspension_until
      ) ORDER BY p.shirt_number NULLS LAST, p.name
    ) AS list
    FROM player_registrations pr JOIN players p ON p.id = pr.player_id
    WHERE pr.competition_id = v_fixture.competition_id
      AND pr.team_id = v_fixture.home_team_id AND pr.status = 'active'
  ),
  away_squad AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id, 'name', p.name, 'shirt_number', p.shirt_number,
        'registration_status', pr.status, 'suspension_until', pr.suspension_until
      ) ORDER BY p.shirt_number NULLS LAST, p.name
    ) AS list
    FROM player_registrations pr JOIN players p ON p.id = pr.player_id
    WHERE pr.competition_id = v_fixture.competition_id
      AND pr.team_id = v_fixture.away_team_id AND pr.status = 'active'
  ),
  events AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', e.id, 'event_type', e.event_type, 'minute', e.minute,
        'period', e.period, 'team_id', e.team_id, 'player_id', e.player_id,
        'player_name_override', e.player_name_override,
        'sub_player_on_id', e.sub_player_on_id, 'sub_player_off_id', e.sub_player_off_id,
        'recorded_by_type', e.recorded_by_type, 'synced_at', e.synced_at,
        'local_timestamp', e.local_timestamp, 'created_at', e.created_at,
        'client_event_id', e.client_event_id
      ) ORDER BY e.minute, e.created_at
    ) AS list
    FROM match_events e WHERE e.fixture_id = v_fixture.id
  )
  SELECT jsonb_build_object(
    'fixture', jsonb_build_object(
      'id', v_fixture.id, 'competition_id', v_fixture.competition_id,
      'home_team_id', v_fixture.home_team_id, 'away_team_id', v_fixture.away_team_id,
      'week_number', v_fixture.week_number, 'round_name', v_fixture.round_name,
      'scheduled_date', v_fixture.scheduled_date, 'kickoff_time', v_fixture.kickoff_time,
      'playing_area_id', v_fixture.playing_area_id, 'official_id', v_fixture.official_id,
      'status', v_fixture.status,
      'home_score', v_fixture.home_score, 'away_score', v_fixture.away_score,
      'walkover_winner_id', v_fixture.walkover_winner_id,
      'forfeit_winner_id', v_fixture.forfeit_winner_id,
      'postpone_reason', v_fixture.postpone_reason, 'void_reason', v_fixture.void_reason,
      'forfeit_reason', v_fixture.forfeit_reason,
      'actual_kickoff_at', v_fixture.actual_kickoff_at         -- mig 120 addition
    ),
    'competition',  (SELECT to_jsonb(c.*) FROM comp c),
    'league',       (SELECT to_jsonb(l.*) FROM league l),
    'venue',        (SELECT to_jsonb(v.*) FROM venue v),
    'pitch',        (SELECT to_jsonb(p.*) FROM pitch p),
    'official',     (SELECT to_jsonb(r.*) FROM official r),
    'home_team',    (SELECT to_jsonb(t.*) FROM home_team t),
    'away_team',    (SELECT to_jsonb(t.*) FROM away_team t),
    'home_squad',   COALESCE((SELECT list FROM home_squad), '[]'::jsonb),
    'away_squad',   COALESCE((SELECT list FROM away_squad), '[]'::jsonb),
    'events',       COALESCE((SELECT list FROM events), '[]'::jsonb),
    'caller', jsonb_build_object('actor_type','ref_token','fixture_id',v_fixture.id)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 6. ref_start_match
--    scheduled|allocated → in_progress. Records the actual kickoff
--    timestamp + a 'period_change' event marking 1H start.
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_start_match(
  p_ref_token       text,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status NOT IN ('scheduled','allocated') THEN
    RAISE EXCEPTION 'fixture_status_locks_start' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  UPDATE public.fixtures
     SET status='in_progress', actual_kickoff_at = p_local_timestamp
   WHERE id = v_fixture.id;

  INSERT INTO public.match_events (
    fixture_id, team_id, event_type, minute, period,
    recorded_by_token, recorded_by_type, local_timestamp, synced_at, client_event_id
  ) VALUES (
    v_fixture.id, v_fixture.home_team_id, 'period_change', 0, '1H',
    p_ref_token, 'referee', p_local_timestamp, now(), p_client_event_id
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    v_fixture.home_team_id, 'referee', p_ref_token, 'ref_start_match',
    'fixture', v_fixture.id::text,
    jsonb_build_object(
      'competition_id', v_fixture.competition_id,
      'home_team_id', v_fixture.home_team_id, 'away_team_id', v_fixture.away_team_id,
      'actual_kickoff_at', p_local_timestamp, 'client_event_id', p_client_event_id
    )
  );

  PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_started');
  IF v_fixture.away_team_id IS NOT NULL THEN
    PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_started');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'fixture_id', v_fixture.id,
    'actual_kickoff_at', p_local_timestamp,
    'event_id', v_event_id
  );
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 7. ref_record_goal
--    p_own_goal=true → event_type='own_goal' with team_id = scorer's
--    own team. Confirm-full-time computes scores accounting for this.
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_record_goal(
  p_ref_token       text,
  p_player_id       text,
  p_minute          integer,
  p_period          text,
  p_client_event_id uuid,
  p_own_goal        boolean DEFAULT false,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_team_id text;
  v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  -- Resolve scorer's team via player_registrations for this competition.
  SELECT pr.team_id INTO v_team_id
  FROM player_registrations pr
  WHERE pr.player_id = p_player_id
    AND pr.competition_id = v_fixture.competition_id
    AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id, ''))
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'player_not_in_fixture' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.match_events (
    fixture_id, team_id, player_id, event_type, minute, period,
    recorded_by_token, recorded_by_type, local_timestamp, synced_at, client_event_id
  ) VALUES (
    v_fixture.id, v_team_id, p_player_id,
    CASE WHEN p_own_goal THEN 'own_goal' ELSE 'goal' END,
    p_minute, p_period, p_ref_token, 'referee', p_local_timestamp, now(), p_client_event_id
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  -- v_event_id is NULL on conflict (duplicate replay) — skip audit + broadcast.
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (
      team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
    ) VALUES (
      v_team_id, 'referee', p_ref_token,
      CASE WHEN p_own_goal THEN 'ref_record_own_goal' ELSE 'ref_record_goal' END,
      'match_event', v_event_id::text,
      jsonb_build_object(
        'fixture_id', v_fixture.id, 'player_id', p_player_id,
        'minute', p_minute, 'period', p_period,
        'client_event_id', p_client_event_id, 'own_goal', p_own_goal
      )
    );
    PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN
      PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_event_recorded');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'team_id', v_team_id,
                            'duplicate', v_event_id IS NULL);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 8. ref_record_card  (yellow | red)
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_record_card(
  p_ref_token       text,
  p_player_id       text,
  p_minute          integer,
  p_period          text,
  p_colour          text,                          -- 'yellow' | 'red'
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_team_id text;
  v_event_type text;
  v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;
  IF p_colour NOT IN ('yellow','red') THEN
    RAISE EXCEPTION 'invalid_card_colour' USING ERRCODE = 'P0001', DETAIL = p_colour;
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  SELECT pr.team_id INTO v_team_id
  FROM player_registrations pr
  WHERE pr.player_id = p_player_id
    AND pr.competition_id = v_fixture.competition_id
    AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id, ''))
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'player_not_in_fixture' USING ERRCODE = 'P0001';
  END IF;

  v_event_type := p_colour || '_card';  -- 'yellow_card' | 'red_card'

  INSERT INTO public.match_events (
    fixture_id, team_id, player_id, event_type, minute, period,
    recorded_by_token, recorded_by_type, local_timestamp, synced_at, client_event_id
  ) VALUES (
    v_fixture.id, v_team_id, p_player_id, v_event_type, p_minute, p_period,
    p_ref_token, 'referee', p_local_timestamp, now(), p_client_event_id
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (
      team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
    ) VALUES (
      v_team_id, 'referee', p_ref_token, 'ref_record_card',
      'match_event', v_event_id::text,
      jsonb_build_object(
        'fixture_id', v_fixture.id, 'player_id', p_player_id, 'colour', p_colour,
        'minute', p_minute, 'period', p_period, 'client_event_id', p_client_event_id
      )
    );
    PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN
      PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_event_recorded');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'team_id', v_team_id,
                            'duplicate', v_event_id IS NULL);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 9. ref_record_substitution
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_record_substitution(
  p_ref_token        text,
  p_on_player_id     text,
  p_off_player_id    text,
  p_minute           integer,
  p_period           text,
  p_client_event_id  uuid,
  p_local_timestamp  timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_on_team text;
  v_off_team text;
  v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;
  IF p_on_player_id IS NULL OR p_off_player_id IS NULL THEN
    RAISE EXCEPTION 'missing_substitution_players' USING ERRCODE = 'P0001';
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  SELECT pr.team_id INTO v_on_team
  FROM player_registrations pr
  WHERE pr.player_id = p_on_player_id AND pr.competition_id = v_fixture.competition_id
    AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id, ''))
  LIMIT 1;
  SELECT pr.team_id INTO v_off_team
  FROM player_registrations pr
  WHERE pr.player_id = p_off_player_id AND pr.competition_id = v_fixture.competition_id
    AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id, ''))
  LIMIT 1;
  IF v_on_team IS NULL OR v_off_team IS NULL OR v_on_team <> v_off_team THEN
    RAISE EXCEPTION 'substitution_team_mismatch' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.match_events (
    fixture_id, team_id, event_type, minute, period,
    sub_player_on_id, sub_player_off_id,
    recorded_by_token, recorded_by_type, local_timestamp, synced_at, client_event_id
  ) VALUES (
    v_fixture.id, v_on_team, 'substitution', p_minute, p_period,
    p_on_player_id, p_off_player_id,
    p_ref_token, 'referee', p_local_timestamp, now(), p_client_event_id
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (
      team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
    ) VALUES (
      v_on_team, 'referee', p_ref_token, 'ref_record_substitution',
      'match_event', v_event_id::text,
      jsonb_build_object(
        'fixture_id', v_fixture.id,
        'on_player_id', p_on_player_id, 'off_player_id', p_off_player_id,
        'minute', p_minute, 'period', p_period, 'client_event_id', p_client_event_id
      )
    );
    PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN
      PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_event_recorded');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'team_id', v_on_team,
                            'duplicate', v_event_id IS NULL);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 10. ref_set_period  (HT / 2H / ET1 / ET2 / PEN — fixed enum in UI)
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_set_period(
  p_ref_token       text,
  p_period          text,                           -- 'HT'|'2H'|'ET1'|'ET2'|'PEN'
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;
  IF p_period NOT IN ('HT','2H','ET1','ET2','PEN') THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = 'P0001', DETAIL = p_period;
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  INSERT INTO public.match_events (
    fixture_id, team_id, event_type, minute, period,
    recorded_by_token, recorded_by_type, local_timestamp, synced_at, client_event_id
  ) VALUES (
    v_fixture.id, v_fixture.home_team_id, 'period_change', 0, p_period,
    p_ref_token, 'referee', p_local_timestamp, now(), p_client_event_id
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (
      team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
    ) VALUES (
      v_fixture.home_team_id, 'referee', p_ref_token, 'ref_set_period',
      'fixture', v_fixture.id::text,
      jsonb_build_object('period', p_period, 'client_event_id', p_client_event_id)
    );
    PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN
      PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_event_recorded');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'period', p_period,
                            'duplicate', v_event_id IS NULL);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 11. ref_undo_event  (30-second undo window enforced client-side;
--     server allows it any time the fixture is still in_progress.)
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_undo_event(
  p_ref_token       text,
  p_client_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_event   public.match_events;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  SELECT * INTO v_event FROM public.match_events
   WHERE fixture_id = v_fixture.id AND client_event_id = p_client_event_id;
  IF v_event.id IS NULL THEN
    -- nothing to undo — treat as no-op for idempotency
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  DELETE FROM public.match_events WHERE id = v_event.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    v_event.team_id, 'referee', p_ref_token, 'ref_undo_event',
    'match_event', v_event.id::text,
    jsonb_build_object(
      'fixture_id', v_fixture.id, 'event_type', v_event.event_type,
      'player_id', v_event.player_id, 'minute', v_event.minute, 'period', v_event.period,
      'client_event_id', p_client_event_id
    )
  );

  PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_event_recorded');
  IF v_fixture.away_team_id IS NOT NULL THEN
    PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_event_recorded');
  END IF;

  RETURN jsonb_build_object('ok', true, 'removed_event_id', v_event.id);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 12. ref_confirm_full_time
--     Materialises home_score / away_score from match_events:
--       home = goals(home) + own_goals(away)
--       away = goals(away) + own_goals(home)
--     Transitions status='in_progress' → 'completed'.
--     Broadcasts 'match_result_saved' (already on whitelist).
--     Standings are computed on-read; no separate cascade needed.
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_confirm_full_time(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_home    int;
  v_away    int;
BEGIN
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE event_type='goal'     AND team_id = v_fixture.home_team_id)
   +COUNT(*) FILTER (WHERE event_type='own_goal' AND team_id = v_fixture.away_team_id),
    COUNT(*) FILTER (WHERE event_type='goal'     AND team_id = v_fixture.away_team_id)
   +COUNT(*) FILTER (WHERE event_type='own_goal' AND team_id = v_fixture.home_team_id)
  INTO v_home, v_away
  FROM public.match_events
  WHERE fixture_id = v_fixture.id;

  UPDATE public.fixtures
     SET status='completed', home_score = v_home, away_score = v_away
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    v_fixture.home_team_id, 'referee', p_ref_token, 'ref_confirm_full_time',
    'fixture', v_fixture.id::text,
    jsonb_build_object(
      'home_team_id', v_fixture.home_team_id, 'away_team_id', v_fixture.away_team_id,
      'home_score', v_home, 'away_score', v_away
    )
  );

  PERFORM public.notify_team_change(v_fixture.home_team_id, 'match_result_saved');
  IF v_fixture.away_team_id IS NOT NULL THEN
    PERFORM public.notify_team_change(v_fixture.away_team_id, 'match_result_saved');
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'fixture_id', v_fixture.id,
    'home_score', v_home, 'away_score', v_away, 'status', 'completed'
  );
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 13. Grants
-- ──────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.ref_start_match(text, uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_start_match(text, uuid, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.ref_record_goal(text, text, integer, text, uuid, boolean, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_record_goal(text, text, integer, text, uuid, boolean, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.ref_record_card(text, text, integer, text, text, uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_record_card(text, text, integer, text, text, uuid, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.ref_record_substitution(text, text, text, integer, text, uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_record_substitution(text, text, text, integer, text, uuid, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.ref_set_period(text, text, uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_set_period(text, text, uuid, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.ref_undo_event(text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_undo_event(text, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.ref_confirm_full_time(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ref_confirm_full_time(text) TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 14. Demo seed — register 5 players per demo team into the demo
--     competition + assign shirt numbers. Idempotent.
--     Without this, Cycle 3.1's PreMatch + this cycle's RPCs both
--     run against empty squads. Smoke-testable end-to-end after seed.
-- ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_comp_id uuid;
  v_team    record;
  v_player_ids text[];
  v_player_id text;
  v_idx int;
BEGIN
  SELECT c.id INTO v_comp_id
  FROM competitions c
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE l.venue_id = 'demo_venue' LIMIT 1;
  IF v_comp_id IS NULL THEN
    RAISE NOTICE 'demo competition missing — skipping seed';
    RETURN;
  END IF;

  FOR v_team IN
    SELECT DISTINCT home_team_id AS id FROM fixtures WHERE competition_id = v_comp_id
    UNION
    SELECT DISTINCT away_team_id AS id FROM fixtures
      WHERE competition_id = v_comp_id AND away_team_id IS NOT NULL
  LOOP
    -- Ensure 5 players exist for this team; create if missing.
    SELECT array_agg(id ORDER BY shirt_number NULLS LAST, name)
      INTO v_player_ids
      FROM players WHERE team = v_team.id;
    IF v_player_ids IS NULL OR array_length(v_player_ids, 1) < 5 THEN
      FOR v_idx IN COALESCE(array_length(v_player_ids, 1), 0) + 1 .. 5 LOOP
        INSERT INTO players (id, team, name, shirt_number, status)
        VALUES (
          v_team.id || '_p' || v_idx::text,
          v_team.id,
          'Demo Player ' || v_idx::text,
          v_idx,
          'active'
        ) ON CONFLICT (id) DO NOTHING;
      END LOOP;
      SELECT array_agg(id ORDER BY shirt_number NULLS LAST, name)
        INTO v_player_ids
        FROM players WHERE team = v_team.id;
    END IF;

    -- Backfill any missing shirt numbers.
    UPDATE players SET shirt_number = sub.rn
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS rn
      FROM players WHERE team = v_team.id AND shirt_number IS NULL
    ) sub WHERE players.id = sub.id;

    -- Register each player into the demo competition (idempotent).
    FOREACH v_player_id IN ARRAY v_player_ids LOOP
      INSERT INTO player_registrations (
        player_id, competition_id, team_id, status, registered_at
      ) VALUES (
        v_player_id, v_comp_id, v_team.id, 'active', now()
      ) ON CONFLICT (player_id, competition_id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
