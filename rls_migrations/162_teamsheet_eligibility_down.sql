-- 162_teamsheet_eligibility_down.sql — strict revert of mig 162.
-- Drops the eligibility check + the 4-arg submit, and restores the mig-159 bodies
-- (3-arg submit with non-blocking warnings; get_team_next_fixture_lineup with the plain
-- teams.admin_token lookup). league_config.min_starting/max_subs survive (owned by mig 161).

DROP FUNCTION IF EXISTS public.team_admin_check_eligibility(text, uuid, text[]);
DROP FUNCTION IF EXISTS public.team_admin_submit_lineup(text, uuid, jsonb, text[]);

-- restore mig-159 submit (warns, never blocks; admin_token-only lookup)
CREATE OR REPLACE FUNCTION public.team_admin_submit_lineup(
  p_admin_token text,
  p_fixture_id  uuid,
  p_lineup      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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

  SELECT array_agg(pid) INTO v_all FROM (
    SELECT jsonb_array_elements_text(v_starting) AS pid
    UNION ALL
    SELECT jsonb_array_elements_text(v_bench)
  ) s;
  v_all := coalesce(v_all, ARRAY[]::text[]);

  SELECT array_agg(pid) INTO v_dup FROM (
    SELECT jsonb_array_elements_text(v_starting) AS pid
    INTERSECT
    SELECT jsonb_array_elements_text(v_bench)
  ) d;
  IF v_dup IS NOT NULL AND array_length(v_dup, 1) > 0 THEN
    RAISE EXCEPTION 'player_in_starting_and_bench' USING ERRCODE = 'P0001',
      DETAIL = array_to_string(v_dup, ',');
  END IF;

  SELECT array_agg(pid) INTO v_bad FROM unnest(v_all) AS pid
   WHERE pid NOT IN (SELECT player_id FROM team_players WHERE team_id = v_team_id);
  IF v_bad IS NOT NULL AND array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'players_not_in_squad' USING ERRCODE = 'P0001',
      DETAIL = array_to_string(v_bad, ',');
  END IF;

  WITH ins AS (
    INSERT INTO player_registrations (player_id, competition_id, team_id, status)
    SELECT pid, v_comp_id, v_team_id, 'active' FROM unnest(v_all) AS pid
    ON CONFLICT (player_id, competition_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_registered FROM ins;

  INSERT INTO fixture_lineups (fixture_id, team_id, starting, bench, shirt_numbers, submitted_at)
  VALUES (p_fixture_id, v_team_id, v_starting, v_bench, v_shirts, now())
  ON CONFLICT (fixture_id, team_id) DO UPDATE
    SET starting      = EXCLUDED.starting,
        bench         = EXCLUDED.bench,
        shirt_numbers = EXCLUDED.shirt_numbers,
        submitted_at  = now();

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
$$;

REVOKE ALL ON FUNCTION public.team_admin_submit_lineup(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_admin_submit_lineup(text, uuid, jsonb) TO anon, authenticated;

-- restore mig-159 get_team_next_fixture_lineup (plain admin_token lookup)
CREATE OR REPLACE FUNCTION public.get_team_next_fixture_lineup(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_team_id text;
  v_fix     record;
  v_opp     text;
  v_fixture jsonb;
  v_lineup  jsonb;
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
$$;

REVOKE ALL ON FUNCTION public.get_team_next_fixture_lineup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_next_fixture_lineup(text) TO anon, authenticated;
