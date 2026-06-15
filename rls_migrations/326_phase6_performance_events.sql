-- Migration 326 — Event OS: Phase 6 Performance Events
--
-- Schema fixes on performance_results:
--   • athlete_id made nullable (sports day athletes are not casual squad players)
--   • athlete_name text column added (free-text judge entry)
--   • competition_team_id uuid FK → competition_teams (tournament team attribution)
--   • unique constraint + index on (performance_event_id, competition_team_id, athlete_name, attempt_number)
--
-- tournament_events.points_config:
--   • column default changed to standard athletics 10-8-6-5-4-3-2-1 table
--   • existing rows with '{}' backfilled
--
-- New RPCs (all SECURITY DEFINER, SET search_path, authenticated-only):
--   1. club_admin_set_performance_config   — set points table per tournament (locked once results exist)
--   2. club_admin_add_performance_event    — director creates a discipline
--   3. club_admin_list_performance_events  — director lists disciplines + result counts
--   4. club_admin_record_result            — judge records an attempt (upserts)
--   5. club_admin_get_performance_results  — ranked leaderboard per event
--   6. club_admin_get_sports_day_standings — team totals across all events
--
-- get_tournament_public extended (4th CREATE OR REPLACE, same signature):
--   • adds performance_events[] with per-event results
--   • adds performance_standings[] (team totals)

-- ─── Schema fixes ─────────────────────────────────────────────────────────────

ALTER TABLE public.performance_results
  ALTER COLUMN athlete_id DROP NOT NULL;

ALTER TABLE public.performance_results
  ADD COLUMN athlete_name        text    NOT NULL DEFAULT '',
  ADD COLUMN competition_team_id uuid    REFERENCES public.competition_teams(id);

CREATE INDEX IF NOT EXISTS performance_results_event_idx
  ON public.performance_results(performance_event_id);

ALTER TABLE public.tournament_events
  ALTER COLUMN points_config
  SET DEFAULT '{"1":10,"2":8,"3":6,"4":5,"5":4,"6":3,"7":2,"8":1}'::jsonb;

UPDATE public.tournament_events
   SET points_config = '{"1":10,"2":8,"3":6,"4":5,"5":4,"6":3,"7":2,"8":1}'::jsonb
 WHERE points_config = '{}'::jsonb;

-- ─── 1. club_admin_set_performance_config ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_set_performance_config(
  p_tournament_event_id uuid,
  p_points_config       jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile_id  uuid;
  v_club_id     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM performance_results pr
    JOIN performance_events pe ON pe.id = pr.performance_event_id
    WHERE pe.tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'results_already_recorded' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_points_config) <> 'object' THEN
    RAISE EXCEPTION 'invalid_points_config' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events
     SET points_config = p_points_config
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, action, metadata)
  VALUES ('_system', 'club_admin', v_uid,
          'tournament_performance_config_updated',
          jsonb_build_object('tournament_event_id', p_tournament_event_id, 'points_config', p_points_config));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_set_performance_config(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_set_performance_config(uuid, jsonb) TO authenticated;

-- ─── 2. club_admin_add_performance_event ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_add_performance_event(
  p_tournament_event_id uuid,
  p_name                text,
  p_measurement_type    text,
  p_unit                text,
  p_attempts_per_athlete int         DEFAULT 1,
  p_category            text         DEFAULT NULL,
  p_scheduled_time      timestamptz  DEFAULT NULL,
  p_display_order       int          DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile_id  uuid;
  v_club_id     text;
  v_event_id    uuid;
  v_name        text := NULLIF(btrim(p_name), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_measurement_type NOT IN ('time_asc','time_desc','distance','height','weight') THEN
    RAISE EXCEPTION 'invalid_measurement_type' USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(btrim(p_unit), '') IS NULL THEN
    RAISE EXCEPTION 'unit_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO performance_events (
    tournament_event_id, name, sport, measurement_type, unit,
    attempts_per_athlete, category, scheduled_time, display_order
  )
  VALUES (
    p_tournament_event_id, v_name, 'athletics', p_measurement_type, btrim(p_unit),
    COALESCE(p_attempts_per_athlete, 1), p_category, p_scheduled_time, p_display_order
  )
  RETURNING id INTO v_event_id;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, action, metadata)
  VALUES ('_system', 'club_admin', v_uid,
          'tournament_performance_event_added',
          jsonb_build_object('tournament_event_id', p_tournament_event_id,
                             'performance_event_id', v_event_id,
                             'name', v_name));

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_add_performance_event(uuid,text,text,text,int,text,timestamptz,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_add_performance_event(uuid,text,text,text,int,text,timestamptz,int) TO authenticated;

-- ─── 3. club_admin_list_performance_events ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_list_performance_events(
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'event_id',             pe.id,
      'name',                 pe.name,
      'measurement_type',     pe.measurement_type,
      'unit',                 pe.unit,
      'attempts_per_athlete', pe.attempts_per_athlete,
      'category',             pe.category,
      'scheduled_time',       pe.scheduled_time,
      'display_order',        pe.display_order,
      'result_count', (
        SELECT COUNT(*) FROM performance_results pr
        WHERE pr.performance_event_id = pe.id
          AND pr.status = 'recorded'
      )
    ) ORDER BY COALESCE(pe.display_order, 9999), pe.scheduled_time NULLS LAST, pe.name)
    FROM performance_events pe
    WHERE pe.tournament_event_id = p_tournament_event_id
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_list_performance_events(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_list_performance_events(uuid) TO authenticated;

-- ─── 4. club_admin_record_result ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_record_result(
  p_performance_event_id uuid,
  p_athlete_name         text,
  p_competition_team_id  uuid,
  p_value                numeric,
  p_attempt_number       int    DEFAULT 1,
  p_status               text   DEFAULT 'recorded'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_profile_id    uuid;
  v_club_id       text;
  v_tournament_id uuid;
  v_result_id     uuid;
  v_name          text := NULLIF(btrim(p_athlete_name), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT pe.tournament_event_id, te.club_id
    INTO v_tournament_id, v_club_id
    FROM performance_events pe
    JOIN tournament_events te ON te.id = pe.tournament_event_id
   WHERE pe.id = p_performance_event_id
   LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'athlete_name_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'competition_team_required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    WHERE ct.id = p_competition_team_id
      AND c.tournament_event_id = v_tournament_id
  ) THEN
    RAISE EXCEPTION 'team_not_in_tournament' USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('recorded','dns','dnf','disqualified') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO performance_results (
    performance_event_id, athlete_name, competition_team_id,
    value, attempt_number, status, recorded_by
  )
  VALUES (
    p_performance_event_id, v_name, p_competition_team_id,
    p_value, COALESCE(p_attempt_number, 1), p_status, v_uid
  )
  ON CONFLICT (performance_event_id, competition_team_id, athlete_name, attempt_number)
  DO UPDATE SET
    value       = EXCLUDED.value,
    status      = EXCLUDED.status,
    recorded_at = now(),
    recorded_by = EXCLUDED.recorded_by
  RETURNING id INTO v_result_id;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, action, metadata)
  VALUES ('_system', 'club_admin', v_uid,
          'tournament_result_recorded',
          jsonb_build_object('performance_event_id', p_performance_event_id,
                             'result_id', v_result_id,
                             'athlete_name', v_name,
                             'value', p_value,
                             'status', p_status));

  RETURN jsonb_build_object('ok', true, 'result_id', v_result_id);
END;
$fn$;

ALTER TABLE public.performance_results
  DROP CONSTRAINT IF EXISTS perf_results_upsert_key;
ALTER TABLE public.performance_results
  ADD CONSTRAINT perf_results_upsert_key
  UNIQUE (performance_event_id, competition_team_id, athlete_name, attempt_number);

REVOKE ALL ON FUNCTION public.club_admin_record_result(uuid,text,uuid,numeric,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_record_result(uuid,text,uuid,numeric,int,text) TO authenticated;

-- ─── 5. club_admin_get_performance_results ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_get_performance_results(
  p_performance_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_profile_id    uuid;
  v_club_id       text;
  v_mtype         text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id, pe.measurement_type
    INTO v_club_id, v_mtype
    FROM performance_events pe
    JOIN tournament_events te ON te.id = pe.tournament_event_id
   WHERE pe.id = p_performance_event_id
   LIMIT 1;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE((
    WITH best_attempts AS (
      SELECT
        pr.athlete_name,
        pr.competition_team_id,
        ct.team_name,
        CASE WHEN v_mtype = 'time_asc'
             THEN MIN(CASE WHEN pr.status = 'recorded' THEN pr.value END)
             ELSE MAX(CASE WHEN pr.status = 'recorded' THEN pr.value END)
        END AS best_value,
        MAX(CASE WHEN pr.status <> 'recorded' THEN pr.status END) AS non_recorded_status,
        jsonb_agg(jsonb_build_object(
          'attempt_number', pr.attempt_number,
          'value',          pr.value,
          'status',         pr.status
        ) ORDER BY pr.attempt_number) AS attempts
      FROM performance_results pr
      JOIN competition_teams ct ON ct.id = pr.competition_team_id
      WHERE pr.performance_event_id = p_performance_event_id
      GROUP BY pr.athlete_name, pr.competition_team_id, ct.team_name
    ),
    ranked AS (
      SELECT *,
        CASE WHEN best_value IS NOT NULL
             THEN RANK() OVER (ORDER BY best_value ASC)
             ELSE NULL
        END AS rank_asc,
        CASE WHEN best_value IS NOT NULL
             THEN RANK() OVER (ORDER BY best_value DESC)
             ELSE NULL
        END AS rank_desc
      FROM best_attempts
    )
    SELECT jsonb_agg(jsonb_build_object(
      'athlete_name',        r.athlete_name,
      'team_name',           r.team_name,
      'competition_team_id', r.competition_team_id,
      'best_value',          r.best_value,
      'status',              COALESCE(r.non_recorded_status, 'recorded'),
      'rank',                CASE WHEN v_mtype = 'time_asc' THEN r.rank_asc ELSE r.rank_desc END,
      'attempts',            r.attempts
    ) ORDER BY
        CASE WHEN r.best_value IS NULL THEN 1 ELSE 0 END,
        CASE WHEN v_mtype = 'time_asc' THEN r.rank_asc ELSE r.rank_desc END NULLS LAST,
        r.athlete_name
    )
    FROM ranked r
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_get_performance_results(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_performance_results(uuid) TO authenticated;

-- ─── 6. club_admin_get_sports_day_standings ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_get_sports_day_standings(
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_profile_id    uuid;
  v_club_id       text;
  v_points_config jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id, points_config
    INTO v_club_id, v_points_config
    FROM tournament_events
   WHERE id = p_tournament_event_id
   LIMIT 1;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE((
    WITH event_results AS (
      SELECT
        pe.id    AS event_id,
        pe.measurement_type,
        pr.competition_team_id,
        pr.athlete_name,
        CASE WHEN pe.measurement_type = 'time_asc'
             THEN MIN(CASE WHEN pr.status = 'recorded' THEN pr.value END)
             ELSE MAX(CASE WHEN pr.status = 'recorded' THEN pr.value END)
        END AS best_value
      FROM performance_events pe
      JOIN performance_results pr ON pr.performance_event_id = pe.id
      WHERE pe.tournament_event_id = p_tournament_event_id
        AND pr.status = 'recorded'
      GROUP BY pe.id, pe.measurement_type, pr.competition_team_id, pr.athlete_name
    ),
    ranked_results AS (
      SELECT
        er.*,
        CASE WHEN er.measurement_type = 'time_asc'
             THEN RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value ASC)
             ELSE RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value DESC)
        END AS finish_rank
      FROM event_results er
      WHERE er.best_value IS NOT NULL
    ),
    team_points AS (
      SELECT
        rr.competition_team_id,
        ct.team_name,
        SUM(COALESCE((v_points_config->>(rr.finish_rank::text))::int, 0)) AS total_points,
        COUNT(CASE WHEN rr.finish_rank = 1 THEN 1 END)::int AS gold,
        COUNT(CASE WHEN rr.finish_rank = 2 THEN 1 END)::int AS silver,
        COUNT(CASE WHEN rr.finish_rank = 3 THEN 1 END)::int AS bronze,
        COUNT(DISTINCT rr.event_id)::int AS events_entered
      FROM ranked_results rr
      JOIN competition_teams ct ON ct.id = rr.competition_team_id
      GROUP BY rr.competition_team_id, ct.team_name
    )
    SELECT jsonb_agg(jsonb_build_object(
      'competition_team_id', tp.competition_team_id,
      'team_name',           tp.team_name,
      'points',              tp.total_points,
      'gold',                tp.gold,
      'silver',              tp.silver,
      'bronze',              tp.bronze,
      'events_entered',      tp.events_entered
    ) ORDER BY tp.total_points DESC, tp.gold DESC, tp.silver DESC, tp.bronze DESC, tp.team_name ASC)
    FROM team_points tp
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_get_sports_day_standings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_sports_day_standings(uuid) TO authenticated;

-- ─── get_tournament_public — 4th CREATE OR REPLACE ────────────────────────────
-- Adds performance_events[] and performance_standings[].
-- Signature unchanged: get_tournament_public(p_slug text)

CREATE OR REPLACE FUNCTION public.get_tournament_public(
  p_slug text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_te            record;
  v_points_config jsonb;
BEGIN
  SELECT te.*, v.name AS venue_name, c.name AS club_name
    INTO v_te
    FROM tournament_events te
    JOIN venues v ON v.id = te.venue_id
    JOIN clubs  c ON c.id = te.club_id
   WHERE te.slug = p_slug
   LIMIT 1;

  IF v_te IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_te.status = 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_points_config := v_te.points_config;

  RETURN jsonb_build_object(
    'ok',                    true,
    'name',                  v_te.name,
    'slug',                  v_te.slug,
    'status',                v_te.status,
    'event_date',            v_te.event_date,
    'event_end_date',        v_te.event_end_date,
    'venue_name',            v_te.venue_name,
    'club_name',             v_te.club_name,
    'entry_fee_pence',       v_te.entry_fee_pence,
    'entry_fee_payer',       v_te.entry_fee_payer,
    'registration_deadline', v_te.registration_deadline,
    'competitions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id', comp.id,
        'name',           comp.name,
        'type',           comp.type,
        'format',         comp.format,
        'status',         comp.status,
        'teams', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'competition_team_id', ct.id,
            'team_name',           COALESCE(ct.team_name, t.name),
            'registered_at',       ct.registered_at
          ) ORDER BY ct.registered_at)
          FROM competition_teams ct
          LEFT JOIN teams t ON t.id = ct.team_id
          WHERE ct.competition_id = comp.id AND ct.status = 'active'
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    'fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fixture_id',       fx.id,
        'competition_id',   fx.competition_id,
        'competition_name', comp.name,
        'round',            fx.week_number,
        'round_name',       fx.round_name,
        'scheduled_date',   fx.scheduled_date,
        'kickoff_time',     CASE
          WHEN fx.kickoff_time IS NOT NULL
          THEN to_char(fx.kickoff_time, 'HH24:MI')
          ELSE NULL
        END,
        'pitch_name',       pa.name,
        'home_team_name',   ht.team_name,
        'away_team_name',   at2.team_name,
        'home_score',       fx.home_score,
        'away_score',       fx.away_score,
        'status',           fx.status,
        'current_period',   fx.current_period,
        'de_bracket',       fx.de_bracket
      ) ORDER BY fx.scheduled_date NULLS LAST, fx.kickoff_time NULLS LAST, fx.week_number, fx.id)
      FROM fixtures fx
      JOIN competitions comp    ON comp.id = fx.competition_id
      LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
      LEFT JOIN competition_teams at2 ON at2.id = fx.away_competition_team_id
      LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    'knockout_fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fixture_id',       fx.id,
        'competition_id',   fx.competition_id,
        'competition_name', comp.name,
        'round',            fx.week_number,
        'round_name',       fx.round_name,
        'scheduled_date',   fx.scheduled_date,
        'kickoff_time',     CASE
          WHEN fx.kickoff_time IS NOT NULL
          THEN to_char(fx.kickoff_time, 'HH24:MI')
          ELSE NULL
        END,
        'pitch_name',       pa.name,
        'home_team_name',   COALESCE(ht.team_name, hf_home.team_name, hf_away.team_name),
        'away_team_name',   COALESCE(at2.team_name, af_home.team_name, af_away.team_name),
        'home_score',       fx.home_score,
        'away_score',       fx.away_score,
        'status',           fx.status,
        'current_period',   fx.current_period,
        'de_bracket',       fx.de_bracket
      ) ORDER BY fx.week_number NULLS LAST, fx.id)
      FROM fixtures fx
      JOIN competitions comp         ON comp.id = fx.competition_id
      LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
      LEFT JOIN competition_teams at2 ON at2.id = fx.away_competition_team_id
      LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
      LEFT JOIN fixtures hf           ON hf.id  = fx.knockout_home_feeder_id
      LEFT JOIN competition_teams hf_home ON hf_home.id = hf.home_competition_team_id
      LEFT JOIN competition_teams hf_away ON hf_away.id = hf.away_competition_team_id
      LEFT JOIN fixtures af           ON af.id  = fx.knockout_away_feeder_id
      LEFT JOIN competition_teams af_home ON af_home.id = af.home_competition_team_id
      LEFT JOIN competition_teams af_away ON af_away.id = af.away_competition_team_id
      WHERE comp.tournament_event_id = v_te.id
        AND (fx.knockout_home_feeder_id IS NOT NULL OR fx.knockout_away_feeder_id IS NOT NULL
             OR fx.de_bracket IS NOT NULL)
    ), '[]'::jsonb),
    'standings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id',   comp.id,
        'competition_name', comp.name,
        'knockout_seeded',  (comp.config->>'knockout_seeded')::boolean,
        'rows', COALESCE((
          SELECT jsonb_agg(row ORDER BY pts DESC, gd DESC, gf DESC, team_name ASC)
          FROM (
            SELECT
              ct.id::text AS team_id,
              ct.team_name,
              ct.group_label,
              ct.group_rank,
              COUNT(fx.id)::int AS played,
              COUNT(CASE
                WHEN fx.home_competition_team_id = ct.id AND fx.home_score > fx.away_score THEN 1
                WHEN fx.away_competition_team_id = ct.id AND fx.away_score > fx.home_score THEN 1
              END)::int AS won,
              COUNT(CASE
                WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1
              END)::int AS drawn,
              COUNT(CASE
                WHEN fx.home_competition_team_id = ct.id AND fx.home_score < fx.away_score THEN 1
                WHEN fx.away_competition_team_id = ct.id AND fx.away_score < fx.home_score THEN 1
              END)::int AS lost,
              COALESCE(SUM(CASE
                WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
                WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
              END), 0)::int AS gf,
              COALESCE(SUM(CASE
                WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
                WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
              END), 0)::int AS ga,
              (COALESCE(SUM(CASE
                WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
                WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
              END), 0) -
               COALESCE(SUM(CASE
                WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
                WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
              END), 0))::int AS gd,
              (COUNT(CASE
                WHEN fx.home_competition_team_id = ct.id AND fx.home_score > fx.away_score THEN 1
                WHEN fx.away_competition_team_id = ct.id AND fx.away_score > fx.home_score THEN 1
              END) * 3 +
               COUNT(CASE
                WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1
              END))::int AS pts
            FROM competition_teams ct
            LEFT JOIN fixtures fx
              ON (fx.home_competition_team_id = ct.id OR fx.away_competition_team_id = ct.id)
              AND fx.competition_id = comp.id
              AND fx.status = 'completed'
              AND fx.home_score IS NOT NULL
              AND fx.away_score IS NOT NULL
              AND fx.knockout_home_feeder_id IS NULL
              AND fx.knockout_away_feeder_id IS NULL
              AND fx.de_bracket IS NULL
            WHERE ct.competition_id = comp.id
              AND ct.status = 'active'
            GROUP BY ct.id, ct.team_name, ct.group_label, ct.group_rank
          ) row
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    -- ── performance events with results (NEW) ─────────────────────────────────
    'performance_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_id',             pe.id,
        'name',                 pe.name,
        'measurement_type',     pe.measurement_type,
        'unit',                 pe.unit,
        'category',             pe.category,
        'scheduled_time',       pe.scheduled_time,
        'display_order',        pe.display_order,
        'results', COALESCE((
          WITH best AS (
            SELECT
              pr.athlete_name,
              pr.competition_team_id,
              ct.team_name,
              CASE WHEN pe.measurement_type = 'time_asc'
                   THEN MIN(CASE WHEN pr.status = 'recorded' THEN pr.value END)
                   ELSE MAX(CASE WHEN pr.status = 'recorded' THEN pr.value END)
              END AS best_value
            FROM performance_results pr
            JOIN competition_teams ct ON ct.id = pr.competition_team_id
            WHERE pr.performance_event_id = pe.id
              AND pr.status = 'recorded'
            GROUP BY pr.athlete_name, pr.competition_team_id, ct.team_name
          ),
          ranked AS (
            SELECT *,
              CASE WHEN pe.measurement_type = 'time_asc'
                   THEN RANK() OVER (ORDER BY best_value ASC)
                   ELSE RANK() OVER (ORDER BY best_value DESC)
              END AS finish_rank
            FROM best
            WHERE best_value IS NOT NULL
          )
          SELECT jsonb_agg(jsonb_build_object(
            'athlete_name', r.athlete_name,
            'team_name',    r.team_name,
            'value',        r.best_value,
            'rank',         r.finish_rank
          ) ORDER BY r.finish_rank, r.athlete_name)
          FROM ranked r
        ), '[]'::jsonb)
      ) ORDER BY COALESCE(pe.display_order, 9999), pe.scheduled_time NULLS LAST, pe.name)
      FROM performance_events pe
      WHERE pe.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    -- ── performance standings (NEW) ───────────────────────────────────────────
    'performance_standings', COALESCE((
      WITH event_results AS (
        SELECT
          pe.id AS event_id,
          pe.measurement_type,
          pr.competition_team_id,
          pr.athlete_name,
          CASE WHEN pe.measurement_type = 'time_asc'
               THEN MIN(CASE WHEN pr.status = 'recorded' THEN pr.value END)
               ELSE MAX(CASE WHEN pr.status = 'recorded' THEN pr.value END)
          END AS best_value
        FROM performance_events pe
        JOIN performance_results pr ON pr.performance_event_id = pe.id
        WHERE pe.tournament_event_id = v_te.id
          AND pr.status = 'recorded'
        GROUP BY pe.id, pe.measurement_type, pr.competition_team_id, pr.athlete_name
      ),
      ranked_results AS (
        SELECT
          er.*,
          CASE WHEN er.measurement_type = 'time_asc'
               THEN RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value ASC)
               ELSE RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value DESC)
          END AS finish_rank
        FROM event_results er
        WHERE er.best_value IS NOT NULL
      ),
      team_points AS (
        SELECT
          rr.competition_team_id,
          ct.team_name,
          SUM(COALESCE((v_points_config->>(rr.finish_rank::text))::int, 0)) AS total_points,
          COUNT(CASE WHEN rr.finish_rank = 1 THEN 1 END)::int AS gold,
          COUNT(CASE WHEN rr.finish_rank = 2 THEN 1 END)::int AS silver,
          COUNT(CASE WHEN rr.finish_rank = 3 THEN 1 END)::int AS bronze,
          COUNT(DISTINCT rr.event_id)::int AS events_entered
        FROM ranked_results rr
        JOIN competition_teams ct ON ct.id = rr.competition_team_id
        GROUP BY rr.competition_team_id, ct.team_name
      )
      SELECT jsonb_agg(jsonb_build_object(
        'competition_team_id', tp.competition_team_id,
        'team_name',           tp.team_name,
        'points',              tp.total_points,
        'gold',                tp.gold,
        'silver',              tp.silver,
        'bronze',              tp.bronze,
        'events_entered',      tp.events_entered
      ) ORDER BY tp.total_points DESC, tp.gold DESC, tp.silver DESC, tp.bronze DESC, tp.team_name ASC)
      FROM team_points tp
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_tournament_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_public(text) TO anon, authenticated;
