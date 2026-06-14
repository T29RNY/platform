-- 320_phase5_tournament_match_day.sql
--
-- Event OS Phase 5 — Match Day Ops
--
-- Wires tournament fixtures into the ref app:
--   1. ALTER TABLE fixtures ADD COLUMN current_period text  — persist HT/2H across reloads
--   2. get_fixture_state_by_ref_token REPLACE — resolves team names from competition_teams
--      for tournament fixtures (home_team_id IS NULL); adds home/away_competition_team_id
--      and current_period to the returned fixture object.
--   3. ref_start_tournament_match   — start without match_events (FK constraint on team_id)
--   4. ref_set_tournament_period    — persist HT / 2H to fixtures.current_period
--   5. ref_record_tournament_goal   — increment home_score / away_score directly
--   6. ref_undo_tournament_goal     — decrement, min 0
--   7. ref_confirm_tournament_match — set status = completed
--   8. club_admin_get_standings     — P/W/D/L/GF/GA/GD/Pts from completed fixtures
--
-- Why no match_events rows for tournament goals:
--   match_events.team_id is text NOT NULL REFERENCES teams(id).
--   Tournament fixtures use competition_teams, not teams. The FK blocks any insert
--   that references a competition_team id.  Score is maintained on fixtures directly.

-- ─── 1. Add current_period column ─────────────────────────────────────────────

ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS current_period text;

-- ─── 2. get_fixture_state_by_ref_token (REPLACE) ─────────────────────────────
-- Backward-compatible: league fixtures unchanged (home_team_id non-null path).
-- Tournament additions: COALESCE team names from competition_teams; include
-- home/away_competition_team_id and current_period in the fixture payload.

CREATE OR REPLACE FUNCTION public.get_fixture_state_by_ref_token(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture      record;
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

  -- ── resolve match-format config (league default → competition → fixture override) ──
  SELECT l.id INTO v_league_id
  FROM competitions c
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues  l ON l.id = s.league_id
  WHERE c.id = v_fixture.competition_id;
  -- v_league_id is NULL for tournament competitions (season_id IS NULL) — handled below.

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
  -- League: from teams. Tournament (home_team_id IS NULL): from competition_teams.
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
      'format_override',           v_fixture.format_override
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

REVOKE ALL ON FUNCTION public.get_fixture_state_by_ref_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fixture_state_by_ref_token(text)
  TO anon, authenticated;

-- ─── 3. ref_start_tournament_match ────────────────────────────────────────────
-- Sets status → in_progress + actual_kickoff_at + current_period = '1H'.
-- Does NOT insert match_events (match_events.team_id FK to teams blocks NULL home_team_id).

CREATE OR REPLACE FUNCTION public.ref_start_tournament_match(
  p_ref_token       text,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status NOT IN ('scheduled', 'allocated') THEN
    RAISE EXCEPTION 'fixture_status_locks_start' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  UPDATE public.fixtures
     SET status            = 'in_progress',
         actual_kickoff_at = p_local_timestamp,
         current_period    = '1H'
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_start_tournament_match',
    'fixture', v_fixture.id::text,
    jsonb_build_object(
      'competition_id',   v_fixture.competition_id,
      'actual_kickoff_at', p_local_timestamp,
      'client_event_id',  p_client_event_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'fixture_id', v_fixture.id, 'status', 'in_progress');
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_start_tournament_match(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_start_tournament_match(text, uuid, timestamptz)
  TO anon, authenticated;

-- ─── 4. ref_set_tournament_period ─────────────────────────────────────────────
-- Writes the current period (HT / 2H / etc.) to fixtures.current_period so the
-- ref app can restore it on reload.

CREATE OR REPLACE FUNCTION public.ref_set_tournament_period(
  p_ref_token       text,
  p_period          text,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;

  IF p_period NOT IN ('HT', '2H', 'ET1', 'ET2', 'FT') THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = 'P0001', DETAIL = p_period;
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  UPDATE public.fixtures SET current_period = p_period WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_set_tournament_period',
    'fixture', v_fixture.id::text,
    jsonb_build_object('period', p_period, 'client_event_id', p_client_event_id)
  );

  RETURN jsonb_build_object('ok', true, 'period', p_period);
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_set_tournament_period(text, text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_set_tournament_period(text, text, uuid, timestamptz)
  TO anon, authenticated;

-- ─── 5. ref_record_tournament_goal ────────────────────────────────────────────
-- Increments fixtures.home_score or away_score directly.
-- p_side = 'home' | 'away'  (the side whose player scored or committed the own goal).
-- Own goals: p_own_goal = true flips the credit to the opposite side.
-- Optional p_player_id / p_player_name_override recorded in audit only (no match_events FK).

CREATE OR REPLACE FUNCTION public.ref_record_tournament_goal(
  p_ref_token            text,
  p_side                 text,
  p_minute               integer,
  p_period               text,
  p_client_event_id      uuid,
  p_player_id            text        DEFAULT NULL,
  p_player_name_override text        DEFAULT NULL,
  p_own_goal             boolean     DEFAULT false,
  p_local_timestamp      timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture      public.fixtures;
  v_scoring_side text;
  v_home         integer;
  v_away         integer;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;

  IF p_side NOT IN ('home', 'away') THEN
    RAISE EXCEPTION 'invalid_side' USING ERRCODE = 'P0001', DETAIL = p_side;
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  -- Own goals credit the opposite side.
  v_scoring_side := CASE
    WHEN p_own_goal THEN (CASE WHEN p_side = 'home' THEN 'away' ELSE 'home' END)
    ELSE p_side
  END;

  IF v_scoring_side = 'home' THEN
    UPDATE public.fixtures
       SET home_score = COALESCE(home_score, 0) + 1
     WHERE id = v_fixture.id
    RETURNING home_score, away_score INTO v_home, v_away;
  ELSE
    UPDATE public.fixtures
       SET away_score = COALESCE(away_score, 0) + 1
     WHERE id = v_fixture.id
    RETURNING home_score, away_score INTO v_home, v_away;
  END IF;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token,
    CASE WHEN p_own_goal THEN 'ref_record_tournament_own_goal' ELSE 'ref_record_tournament_goal' END,
    'fixture', v_fixture.id::text,
    jsonb_build_object(
      'side',              p_side,
      'scoring_side',      v_scoring_side,
      'minute',            p_minute,
      'period',            p_period,
      'player_id',         p_player_id,
      'player_name',       p_player_name_override,
      'home_score',        v_home,
      'away_score',        v_away,
      'client_event_id',   p_client_event_id,
      'own_goal',          p_own_goal
    )
  );

  RETURN jsonb_build_object('ok', true, 'home_score', v_home, 'away_score', v_away);
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_record_tournament_goal(text, text, integer, text, uuid, text, text, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_record_tournament_goal(text, text, integer, text, uuid, text, text, boolean, timestamptz)
  TO anon, authenticated;

-- ─── 6. ref_undo_tournament_goal ──────────────────────────────────────────────
-- Decrements the score on the given side by 1, floor 0.
-- No client_event_id needed — this is a simple decrement.

CREATE OR REPLACE FUNCTION public.ref_undo_tournament_goal(
  p_ref_token text,
  p_side      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_home    integer;
  v_away    integer;
BEGIN
  IF p_side NOT IN ('home', 'away') THEN
    RAISE EXCEPTION 'invalid_side' USING ERRCODE = 'P0001', DETAIL = p_side;
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  IF p_side = 'home' THEN
    UPDATE public.fixtures
       SET home_score = GREATEST(0, COALESCE(home_score, 0) - 1)
     WHERE id = v_fixture.id
    RETURNING home_score, away_score INTO v_home, v_away;
  ELSE
    UPDATE public.fixtures
       SET away_score = GREATEST(0, COALESCE(away_score, 0) - 1)
     WHERE id = v_fixture.id
    RETURNING home_score, away_score INTO v_home, v_away;
  END IF;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_undo_tournament_goal',
    'fixture', v_fixture.id::text,
    jsonb_build_object('side', p_side, 'home_score', v_home, 'away_score', v_away)
  );

  RETURN jsonb_build_object('ok', true, 'home_score', v_home, 'away_score', v_away);
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_undo_tournament_goal(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_undo_tournament_goal(text, text)
  TO anon, authenticated;

-- ─── 7. ref_confirm_tournament_match ──────────────────────────────────────────
-- Sets status → completed. Score already lives on fixtures.home_score/away_score.

CREATE OR REPLACE FUNCTION public.ref_confirm_tournament_match(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_home    integer;
  v_away    integer;
BEGIN
  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  v_home := COALESCE(v_fixture.home_score, 0);
  v_away := COALESCE(v_fixture.away_score, 0);

  UPDATE public.fixtures
     SET status         = 'completed',
         current_period = 'FT'
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_confirm_tournament_match',
    'fixture', v_fixture.id::text,
    jsonb_build_object('home_score', v_home, 'away_score', v_away)
  );

  RETURN jsonb_build_object(
    'ok', true, 'home_score', v_home, 'away_score', v_away, 'status', 'completed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_confirm_tournament_match(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_confirm_tournament_match(text)
  TO anon, authenticated;

-- ─── 8. club_admin_get_standings ──────────────────────────────────────────────
-- Authenticated. Returns P/W/D/L/GF/GA/GD/Pts per active competition_team,
-- computed from completed fixtures for the given competition.

CREATE OR REPLACE FUNCTION public.club_admin_get_standings(
  p_tournament_event_id uuid,
  p_competition_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Ownership guard: caller must be a club_admin for this tournament's club.
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_events te
    JOIN public.club_admins ca ON ca.club_id = te.club_id
    WHERE te.id = p_tournament_event_id AND ca.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Competition must belong to this tournament.
  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
    'ok',             true,
    'competition_id', p_competition_id,
    'standings',      COALESCE((
      SELECT jsonb_agg(row ORDER BY pts DESC, gd DESC, gf DESC, team_name ASC)
      FROM (
        SELECT
          ct.id::text                                                               AS team_id,
          ct.team_name,
          COUNT(fx.id)::int                                                         AS played,
          COUNT(CASE
            WHEN fx.home_competition_team_id = ct.id AND fx.home_score > fx.away_score THEN 1
            WHEN fx.away_competition_team_id = ct.id AND fx.away_score > fx.home_score THEN 1
          END)::int                                                                 AS won,
          COUNT(CASE
            WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1
          END)::int                                                                 AS drawn,
          COUNT(CASE
            WHEN fx.home_competition_team_id = ct.id AND fx.home_score < fx.away_score THEN 1
            WHEN fx.away_competition_team_id = ct.id AND fx.away_score < fx.home_score THEN 1
          END)::int                                                                 AS lost,
          COALESCE(SUM(CASE
            WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
            WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
          END), 0)::int                                                             AS gf,
          COALESCE(SUM(CASE
            WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
            WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
          END), 0)::int                                                             AS ga,
          (COALESCE(SUM(CASE
            WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
            WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
          END), 0) -
           COALESCE(SUM(CASE
            WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
            WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
          END), 0))::int                                                            AS gd,
          (COUNT(CASE
            WHEN fx.home_competition_team_id = ct.id AND fx.home_score > fx.away_score THEN 1
            WHEN fx.away_competition_team_id = ct.id AND fx.away_score > fx.home_score THEN 1
          END) * 3 +
           COUNT(CASE
            WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1
          END))::int                                                                AS pts
        FROM public.competition_teams ct
        LEFT JOIN public.fixtures fx
          ON (fx.home_competition_team_id = ct.id OR fx.away_competition_team_id = ct.id)
          AND fx.competition_id = p_competition_id
          AND fx.status = 'completed'
          AND fx.home_score IS NOT NULL
          AND fx.away_score IS NOT NULL
        WHERE ct.competition_id = p_competition_id
          AND ct.status = 'active'
        GROUP BY ct.id, ct.team_name
      ) row
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.club_admin_get_standings(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_admin_get_standings(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_standings(uuid, uuid)
  TO authenticated;
