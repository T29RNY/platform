-- Migration 265 — Ref V2: extend get_fixture_state_by_ref_token with resolved match-format
-- config, clock/stoppage/override state, and RESTORE actual_kickoff_at.
-- Cycle "RefSix-killer" / apps/ref/REF_V2_BUILD_PLAN.md, §5 (read-side).
--
-- REGRESSION FIX: mig 120 added actual_kickoff_at to the returned fixture object; mig 160
-- (lineup-aware rewrite) silently dropped it. The ref live clock derives from it, so it has
-- been missing from the payload since mig 160. Restored here.
--
-- ADDITIVE (hard-rule #12 — additive return-shape fields, ref app is the sole consumer and
-- is being rebuilt in the same epic):
--   fixture.actual_kickoff_at, .clock_paused_at, .clock_paused_ms, .added_time, .format_override
--   + new top-level 'match_format' — the RESOLVED timing config the ref clock uses:
--       league_config (default) → competitions.config->'match_format' (override)
--       → fixtures.format_override (per-fixture override).  Shallow-merged, right wins.
--       'is_overridden' = fixtures.format_override IS NOT NULL (the fairness flag).
--
-- _fixture_squad_json is unchanged (mig 160) and not redefined here.

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
  JOIN leagues l ON l.id = s.league_id
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
  ),
  away_team AS (
    SELECT t.id, t.name, t.primary_colour, t.secondary_colour
    FROM teams t WHERE t.id = v_fixture.away_team_id
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
      'id',                  v_fixture.id,
      'competition_id',      v_fixture.competition_id,
      'home_team_id',        v_fixture.home_team_id,
      'away_team_id',        v_fixture.away_team_id,
      'week_number',         v_fixture.week_number,
      'round_name',          v_fixture.round_name,
      'scheduled_date',      v_fixture.scheduled_date,
      'kickoff_time',        v_fixture.kickoff_time,
      'playing_area_id',     v_fixture.playing_area_id,
      'official_id',         v_fixture.official_id,
      'status',              v_fixture.status,
      'home_score',          v_fixture.home_score,
      'away_score',          v_fixture.away_score,
      'walkover_winner_id',  v_fixture.walkover_winner_id,
      'forfeit_winner_id',   v_fixture.forfeit_winner_id,
      'postpone_reason',     v_fixture.postpone_reason,
      'void_reason',         v_fixture.void_reason,
      'forfeit_reason',      v_fixture.forfeit_reason,
      -- Ref V2 additions (mig 265)
      'actual_kickoff_at',   v_fixture.actual_kickoff_at,   -- restored regression (mig 160 dropped it)
      'clock_paused_at',     v_fixture.clock_paused_at,
      'clock_paused_ms',     v_fixture.clock_paused_ms,
      'added_time',          v_fixture.added_time,
      'format_override',     v_fixture.format_override
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
GRANT EXECUTE ON FUNCTION public.get_fixture_state_by_ref_token(text) TO anon, authenticated;
