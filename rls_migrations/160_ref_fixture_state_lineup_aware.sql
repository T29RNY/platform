-- 160_ref_fixture_state_lineup_aware.sql
-- League Mode Cycle 5.6, STAGE B — make the ref pre-match RPC lineup-aware,
-- BACKWARD COMPATIBLE: if a fixture_lineups row exists for a team, return only its
-- starting+bench (tagged lineup_role, shirt from the lineup overriding players.shirt_number,
-- ordered starting-then-bench); otherwise the full active player_registrations squad
-- exactly as before, with lineup_role:null added. Additive field only (hard-rule #12).
--
-- Internal helper centralises the squad logic so home/away can never diverge. It is
-- SECURITY DEFINER + search_path pinned and granted to NOBODY (called only by the parent
-- RPC, which runs as the definer/owner). The explicit REVOKE from anon/authenticated
-- undoes Supabase default-privileges grants on new public functions.

CREATE OR REPLACE FUNCTION public._fixture_squad_json(
  p_fixture_id     uuid,
  p_team_id        text,
  p_competition_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH lu AS (
    SELECT starting, bench, shirt_numbers
    FROM fixture_lineups
    WHERE fixture_id = p_fixture_id AND team_id = p_team_id
  ),
  picked AS (
    SELECT pid AS player_id, 'starting'::text AS role, 0 AS role_ord, ord AS pos
    FROM lu CROSS JOIN LATERAL jsonb_array_elements_text(lu.starting) WITH ORDINALITY AS s(pid, ord)
    UNION ALL
    SELECT pid, 'bench', 1, ord
    FROM lu CROSS JOIN LATERAL jsonb_array_elements_text(lu.bench) WITH ORDINALITY AS b(pid, ord)
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM lu) THEN
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                  p.id,
          'name',                p.name,
          'shirt_number',        COALESCE((lu.shirt_numbers->>pk.player_id)::int, p.shirt_number),
          'registration_status', pr.status,
          'suspension_until',    pr.suspension_until,
          'lineup_role',         pk.role
        )
        ORDER BY pk.role_ord,
                 COALESCE((lu.shirt_numbers->>pk.player_id)::int, p.shirt_number) NULLS LAST,
                 pk.pos
      )
      FROM picked pk
      JOIN players p ON p.id = pk.player_id
      LEFT JOIN player_registrations pr
             ON pr.player_id = p.id AND pr.competition_id = p_competition_id
      CROSS JOIN lu
    ), '[]'::jsonb)
  ELSE
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                  p.id,
          'name',                p.name,
          'shirt_number',        p.shirt_number,
          'registration_status', pr.status,
          'suspension_until',    pr.suspension_until,
          'lineup_role',         NULL
        )
        ORDER BY p.shirt_number NULLS LAST, p.name
      )
      FROM player_registrations pr
      JOIN players p ON p.id = pr.player_id
      WHERE pr.competition_id = p_competition_id
        AND pr.team_id        = p_team_id
        AND pr.status         = 'active'
    ), '[]'::jsonb)
  END
$function$;

REVOKE ALL ON FUNCTION public._fixture_squad_json(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._fixture_squad_json(uuid, text, uuid) FROM anon, authenticated;
-- intentionally NOT granted to anon/authenticated — internal helper only.

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
