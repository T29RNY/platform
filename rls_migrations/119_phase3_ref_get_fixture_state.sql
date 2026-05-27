-- 119_phase3_ref_get_fixture_state.sql
--
-- Phase 3 (League Mode) — Cycle 3.1 read RPC for the ref view.
--
-- A referee opens https://app/ref/<ref_token> on their phone. The
-- single read needed for the pre-match screen (and for resume after
-- a tab reload or connection blip) is: fetch this one fixture +
-- both squads + any match_events recorded so far.
--
-- `fixtures.ref_token` is a UUID text already auto-generated at
-- INSERT time (mig 055 default). No new column needed.
--
-- Scope of return shape:
--   - fixture        — one row, with all status / score / forfeit cols
--   - competition    — name, type, format (so the UI can label the page)
--   - venue          — name only (no admin token)
--   - league         — name only
--   - pitch          — id + name + surface (nullable if unassigned)
--   - official       — id + name + preferred_channel (nullable)
--   - home_team / away_team   — { id, name, primary_colour }
--   - home_squad / away_squad — confirmed active player_registrations
--                               joined to players for shirt_number + name,
--                               ordered by shirt_number nulls last
--   - events         — every match_events row for this fixture, ordered
--                      by minute then created_at, for offline-resume
--   - caller         — { actor_type: 'ref_token', fixture_id }
--
-- HARD security rules honoured:
--   - Token grants access to EXACTLY this one fixture. No other
--     fixtures, no admin tokens, no cross-fixture data leaked.
--   - SECURITY DEFINER + SET search_path TO public, pg_temp.
--   - REVOKE ALL FROM PUBLIC + GRANT to anon, authenticated
--     (refs hit this anon from the phone; authenticated path covers
--     future ref-OAuth without re-grant).

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
  IF p_ref_token IS NULL OR length(trim(p_ref_token)) = 0 THEN
    RAISE EXCEPTION 'invalid_ref_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.* INTO v_fixture
  FROM fixtures f
  WHERE f.ref_token = p_ref_token;

  IF v_fixture.id IS NULL THEN
    RAISE EXCEPTION 'invalid_ref_token' USING ERRCODE = 'P0001';
  END IF;

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
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'id',                 p.id,
          'name',               p.name,
          'shirt_number',       p.shirt_number,
          'registration_status', pr.status,
          'suspension_until',   pr.suspension_until
        )
        ORDER BY p.shirt_number NULLS LAST, p.name
      ) AS list
    FROM player_registrations pr
    JOIN players p ON p.id = pr.player_id
    WHERE pr.competition_id = v_fixture.competition_id
      AND pr.team_id        = v_fixture.home_team_id
      AND pr.status         = 'active'
  ),
  away_squad AS (
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'id',                 p.id,
          'name',               p.name,
          'shirt_number',       p.shirt_number,
          'registration_status', pr.status,
          'suspension_until',   pr.suspension_until
        )
        ORDER BY p.shirt_number NULLS LAST, p.name
      ) AS list
    FROM player_registrations pr
    JOIN players p ON p.id = pr.player_id
    WHERE pr.competition_id = v_fixture.competition_id
      AND pr.team_id        = v_fixture.away_team_id
      AND pr.status         = 'active'
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
      'forfeit_reason',      v_fixture.forfeit_reason
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
