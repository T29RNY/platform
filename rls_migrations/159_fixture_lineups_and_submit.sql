-- 159_fixture_lineups_and_submit.sql
-- League Mode Cycle 5.6, STAGE A — server foundation (no live impact: nothing reads
-- fixture_lineups until Stage B recreates the ref RPC).
--
-- Adds: fixture_lineups table; team_admin_submit_lineup (write, auto-registers picked
-- players into player_registrations); get_team_next_fixture_lineup (read for the admin
-- Teamsheet screen). See plan: a league team is always a separate squad; a manager picks
-- the XI+bench from the squad, and submitting registers those players for the competition.

CREATE TABLE IF NOT EXISTS public.fixture_lineups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id    uuid NOT NULL REFERENCES public.fixtures(id) ON DELETE CASCADE,
  team_id       text NOT NULL REFERENCES public.teams(id)    ON DELETE CASCADE,
  starting      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of player_id (text)
  bench         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of player_id (text)
  shirt_numbers jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { player_id: int }
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fixture_id, team_id)
);
ALTER TABLE public.fixture_lineups ENABLE ROW LEVEL SECURITY;
-- No policies: RPC-only access via SECURITY DEFINER functions below.

-- ── Write: submit a lineup for a fixture ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.team_admin_submit_lineup(
  p_admin_token text,
  p_fixture_id  uuid,
  p_lineup      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_team_id    text;
  v_comp_id    uuid;
  v_home       text;
  v_away       text;
  v_starting   jsonb := coalesce(p_lineup->'starting', '[]'::jsonb);
  v_bench      jsonb := coalesce(p_lineup->'bench', '[]'::jsonb);
  v_shirts     jsonb := coalesce(p_lineup->'shirt_numbers', '{}'::jsonb);
  v_all        text[];
  v_dup        text[];
  v_bad        text[];
  v_registered int := 0;
  v_warnings   jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_token' USING ERRCODE = 'P0001';
  END IF;

  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT competition_id, home_team_id, away_team_id
    INTO v_comp_id, v_home, v_away
    FROM fixtures WHERE id = p_fixture_id;
  IF v_comp_id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_team_id <> v_home AND v_team_id IS DISTINCT FROM v_away THEN
    RAISE EXCEPTION 'not_your_fixture' USING ERRCODE = 'P0001';
  END IF;

  -- all picked ids (starting + bench)
  SELECT array_agg(pid) INTO v_all FROM (
    SELECT jsonb_array_elements_text(v_starting) AS pid
    UNION ALL
    SELECT jsonb_array_elements_text(v_bench)
  ) s;
  v_all := coalesce(v_all, ARRAY[]::text[]);

  -- a player cannot be both starting and bench
  SELECT array_agg(pid) INTO v_dup FROM (
    SELECT jsonb_array_elements_text(v_starting) AS pid
    INTERSECT
    SELECT jsonb_array_elements_text(v_bench)
  ) d;
  IF v_dup IS NOT NULL AND array_length(v_dup, 1) > 0 THEN
    RAISE EXCEPTION 'player_in_starting_and_bench' USING ERRCODE = 'P0001',
      DETAIL = array_to_string(v_dup, ',');
  END IF;

  -- every picked player must be in the team's squad (team_players)
  SELECT array_agg(pid) INTO v_bad FROM unnest(v_all) AS pid
   WHERE pid NOT IN (SELECT player_id FROM team_players WHERE team_id = v_team_id);
  IF v_bad IS NOT NULL AND array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'players_not_in_squad' USING ERRCODE = 'P0001',
      DETAIL = array_to_string(v_bad, ',');
  END IF;

  -- auto-register picked players into the competition (idempotent — submit registers)
  WITH ins AS (
    INSERT INTO player_registrations (player_id, competition_id, team_id, status)
    SELECT pid, v_comp_id, v_team_id, 'active' FROM unnest(v_all) AS pid
    ON CONFLICT (player_id, competition_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_registered FROM ins;

  -- upsert the lineup
  INSERT INTO fixture_lineups (fixture_id, team_id, starting, bench, shirt_numbers, submitted_at)
  VALUES (p_fixture_id, v_team_id, v_starting, v_bench, v_shirts, now())
  ON CONFLICT (fixture_id, team_id) DO UPDATE
    SET starting      = EXCLUDED.starting,
        bench         = EXCLUDED.bench,
        shirt_numbers = EXCLUDED.shirt_numbers,
        submitted_at  = now();

  -- non-blocking warnings: suspended/ineligible, or registered to another team in this comp
  SELECT jsonb_agg(jsonb_build_object(
           'player_id', pr.player_id,
           'type', CASE
             WHEN pr.team_id <> v_team_id THEN 'registered_to_other_team'
             ELSE 'suspended'
           END))
    INTO v_warnings
    FROM player_registrations pr
   WHERE pr.competition_id = v_comp_id
     AND pr.player_id = ANY(v_all)
     AND (pr.team_id <> v_team_id
          OR pr.status IN ('suspended','ineligible')
          OR (pr.suspension_until IS NOT NULL AND pr.suspension_until > current_date));

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, auth.uid(), 'team_admin', 'admin_token:' || md5(p_admin_token),
    'lineup_submitted', 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'competition_id',   v_comp_id,
      'starting_count',   jsonb_array_length(v_starting),
      'bench_count',      jsonb_array_length(v_bench),
      'registered_count', v_registered
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'fixture_id', p_fixture_id,
    'team_id', v_team_id,
    'starting_count', jsonb_array_length(v_starting),
    'bench_count', jsonb_array_length(v_bench),
    'registered_count', v_registered,
    'warnings', coalesce(v_warnings, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.team_admin_submit_lineup(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_admin_submit_lineup(text, uuid, jsonb) TO anon, authenticated;

-- ── Read: next fixture + existing lineup for the admin's team ─────────────────
CREATE OR REPLACE FUNCTION public.get_team_next_fixture_lineup(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_team_id  text;
  v_fix      record;
  v_opp      text;
  v_fixture  jsonb;
  v_lineup   jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.id, f.competition_id, f.home_team_id, f.away_team_id, f.scheduled_date,
         f.kickoff_time, f.round_name, f.week_number, f.playing_area_id,
         c.name AS competition_name
    INTO v_fix
    FROM fixtures f
    JOIN competitions c ON c.id = f.competition_id
   WHERE (f.home_team_id = v_team_id OR f.away_team_id = v_team_id)
     AND c.type = 'league'
     AND f.status IN ('scheduled','allocated')
   ORDER BY f.scheduled_date NULLS LAST, f.kickoff_time NULLS LAST
   LIMIT 1;

  IF v_fix.id IS NULL THEN
    RETURN jsonb_build_object('team_id', v_team_id, 'fixture', NULL, 'lineup', NULL);
  END IF;

  v_opp := CASE WHEN v_fix.home_team_id = v_team_id THEN v_fix.away_team_id ELSE v_fix.home_team_id END;

  v_fixture := jsonb_build_object(
    'id',               v_fix.id,
    'competition_id',   v_fix.competition_id,
    'competition_name', v_fix.competition_name,
    'is_home',          v_fix.home_team_id = v_team_id,
    'opponent_team_id', v_opp,
    'opponent_name',    (SELECT name FROM teams WHERE id = v_opp),
    'scheduled_date',   v_fix.scheduled_date,
    'kickoff_time',     v_fix.kickoff_time,
    'round_name',       v_fix.round_name,
    'week_number',      v_fix.week_number,
    'playing_area',     (SELECT name FROM playing_areas WHERE id = v_fix.playing_area_id)
  );

  SELECT jsonb_build_object(
           'starting',      fl.starting,
           'bench',         fl.bench,
           'shirt_numbers', fl.shirt_numbers,
           'submitted_at',  fl.submitted_at
         )
    INTO v_lineup
    FROM fixture_lineups fl
   WHERE fl.fixture_id = v_fix.id AND fl.team_id = v_team_id;

  RETURN jsonb_build_object('team_id', v_team_id, 'fixture', v_fixture, 'lineup', v_lineup);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_team_next_fixture_lineup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_next_fixture_lineup(text) TO anon, authenticated;
