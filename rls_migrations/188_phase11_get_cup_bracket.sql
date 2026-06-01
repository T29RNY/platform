-- 188_phase11_get_cup_bracket.sql
-- LEAGUE MODE — Phase 11 Cycle 11.3: bracket read RPC.
--
-- One read serves all three surfaces (venue admin, player, display board). A bracket is
-- public match data — team names + scores, already shown on the no-login display board —
-- so it is keyed by competition_id (an unguessable uuid) and granted to anon + authenticated,
-- with no token gating. STABLE, read-only (no ephemeral-verify needed).
--
-- Returns the rounds (each with its ties, ordered by slot), every tie's teams/colours,
-- the linked fixture's schedule + score + decider detail, and the champion once the final
-- is decided. The venue scheduling UI filters ties by status='ready'.

CREATE OR REPLACE FUNCTION public.get_cup_bracket(p_competition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp record;
  v_champion jsonb;
  v_max_round int;
  v_result jsonb;
BEGIN
  IF p_competition_id IS NULL THEN
    RAISE EXCEPTION 'competition_id_required' USING ERRCODE='P0001';
  END IF;
  SELECT id, name, type, format, status INTO v_comp FROM competitions WHERE id = p_competition_id;
  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE='P0001';
  END IF;

  SELECT max(round_number) INTO v_max_round FROM cup_ties WHERE competition_id = p_competition_id;

  SELECT to_jsonb(t) INTO v_champion FROM (
    SELECT w.id, w.name
    FROM cup_ties ct JOIN teams w ON w.id = ct.winner_team_id
    WHERE ct.competition_id = p_competition_id AND ct.status = 'decided'
      AND ct.round_number = v_max_round
    LIMIT 1
  ) t;

  SELECT jsonb_build_object(
    'competition', jsonb_build_object('id', v_comp.id, 'name', v_comp.name,
      'type', v_comp.type, 'format', v_comp.format, 'status', v_comp.status),
    'champion', v_champion,
    'rounds', COALESCE((
      SELECT jsonb_agg(r ORDER BY (r->>'round_number')::int)
      FROM (
        SELECT jsonb_build_object(
          'round_number', ct.round_number,
          'round_name', max(ct.round_name),
          'ties', jsonb_agg(jsonb_build_object(
            'id', ct.id, 'slot_index', ct.slot_index, 'status', ct.status,
            'home_team_id', ct.home_team_id, 'home_team_name', ht.name, 'home_primary_colour', ht.primary_colour,
            'away_team_id', ct.away_team_id, 'away_team_name', at.name, 'away_primary_colour', at.primary_colour,
            'home_source', ct.home_source, 'away_source', ct.away_source,
            'winner_team_id', ct.winner_team_id,
            'fixture_id', ct.fixture_id,
            'scheduled_date', f.scheduled_date, 'kickoff_time', f.kickoff_time,
            'fixture_status', f.status,
            'home_score', f.home_score, 'away_score', f.away_score,
            'aet_home_score', f.aet_home_score, 'aet_away_score', f.aet_away_score,
            'pens_home_score', f.pens_home_score, 'pens_away_score', f.pens_away_score,
            'decided_by', f.decided_by
          ) ORDER BY ct.slot_index)
        ) AS r
        FROM cup_ties ct
        LEFT JOIN teams ht ON ht.id = ct.home_team_id
        LEFT JOIN teams at ON at.id = ct.away_team_id
        LEFT JOIN fixtures f ON f.id = ct.fixture_id
        WHERE ct.competition_id = p_competition_id
        GROUP BY ct.round_number
      ) sub
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cup_bracket(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_cup_bracket(uuid) TO anon, authenticated;
