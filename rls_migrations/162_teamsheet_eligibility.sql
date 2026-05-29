-- 162_teamsheet_eligibility.sql
-- League Mode Cycle 5.7, STAGE A (part 2) — eligibility enforcement (closes Phase 5).
--
-- Turns the 5.6 non-blocking warnings into real gates on teamsheet submit, and adds a
-- read-only pre-submit check the UI uses to badge players + show squad-size validity.
--
-- Product decisions (session 56):
--   * Suspended/ineligible  → BLOCK by default; team admin may proceed only by passing
--     the player_id in p_override_player_ids (override is audited). (scope §1147)
--   * Squad size            → matchday sheet: starting_count >= min_starting and
--     bench_count <= max_subs (league_config, mig 161). NULL bound = unbounded. HARD block.
--   * Double-registration   → a picked player with a registration to a DIFFERENT team in
--     this competition is a HARD block, surfaced to the team admin + audited. The two-sided
--     league-admin confirm UI is deferred to Phase 4/6 (apps/venue has no per-player view).
--
-- Also fixes a latent 5.6 VC bug: team_admin_submit_lineup and get_team_next_fixture_lineup
-- resolved the caller via a plain teams.admin_token lookup, so a Vice Captain opening the
-- Teamsheet via /p/<vc_token> got invalid_admin_token. Both now use resolve_admin_caller
-- (mig 074) — the session-49 dual-lookup rule. resolve_admin_caller RETURNS empty (does not
-- raise) on a bad/NULL token, so each call is followed by an explicit NULL guard.

-- ── Read: pre-submit eligibility check (no writes) ───────────────────────────
CREATE OR REPLACE FUNCTION public.team_admin_check_eligibility(
  p_admin_token text,
  p_fixture_id  uuid,
  p_player_ids  text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_team_id   text;
  v_comp_id   uuid;
  v_league_id text;
  v_home      text;
  v_away      text;
  v_min_start int;
  v_max_subs  int;
  v_ids       text[] := coalesce(p_player_ids, ARRAY[]::text[]);
  v_players   jsonb;
BEGIN
  SELECT team_id INTO v_team_id FROM resolve_admin_caller(p_admin_token);
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

  SELECT s.league_id INTO v_league_id
    FROM competitions c JOIN seasons s ON s.id = c.season_id
   WHERE c.id = v_comp_id;
  SELECT COALESCE(lc.min_starting, def.min_starting),
         COALESCE(lc.max_subs,     def.max_subs)
    INTO v_min_start, v_max_subs
    FROM (SELECT 1) one
    LEFT JOIN league_config lc  ON lc.league_id  = v_league_id
    LEFT JOIN league_config def ON def.league_id IS NULL;

  SELECT jsonb_agg(jsonb_build_object(
           'player_id', pid,
           'name', (SELECT name FROM players WHERE id = pid),
           'in_squad', EXISTS (
              SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = pid),
           'double_registered', EXISTS (
              SELECT 1 FROM player_registrations pr
               WHERE pr.competition_id = v_comp_id AND pr.player_id = pid
                 AND pr.team_id <> v_team_id),
           'suspended', EXISTS (
              SELECT 1 FROM player_registrations pr
               WHERE pr.competition_id = v_comp_id AND pr.team_id = v_team_id AND pr.player_id = pid
                 AND (pr.status IN ('suspended','ineligible')
                      OR (pr.suspension_until IS NOT NULL AND pr.suspension_until > current_date))),
           'registration_status', (
              SELECT pr.status FROM player_registrations pr
               WHERE pr.competition_id = v_comp_id AND pr.team_id = v_team_id AND pr.player_id = pid),
           'suspension_until', (
              SELECT pr.suspension_until FROM player_registrations pr
               WHERE pr.competition_id = v_comp_id AND pr.team_id = v_team_id AND pr.player_id = pid)
         ))
    INTO v_players
    FROM unnest(v_ids) AS pid;

  RETURN jsonb_build_object(
    'ok',           true,
    'team_id',      v_team_id,
    'fixture_id',   p_fixture_id,
    'min_starting', v_min_start,
    'max_subs',     v_max_subs,
    'players',      coalesce(v_players, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.team_admin_check_eligibility(text, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_admin_check_eligibility(text, uuid, text[]) TO anon, authenticated;

-- ── Write: submit a lineup — now an authoritative eligibility gate ───────────
-- New 4th param p_override_player_ids changes the signature → DROP the old 3-arg first
-- (Postgres treats differing arg lists as separate overloads; single-overload rule).
DROP FUNCTION IF EXISTS public.team_admin_submit_lineup(text, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.team_admin_submit_lineup(
  p_admin_token         text,
  p_fixture_id          uuid,
  p_lineup              jsonb,
  p_override_player_ids text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_team_id     text;
  v_actor_type  text;
  v_actor_ident text;
  v_comp_id     uuid;
  v_league_id   text;
  v_home        text;
  v_away        text;
  v_starting    jsonb := coalesce(p_lineup->'starting', '[]'::jsonb);
  v_bench       jsonb := coalesce(p_lineup->'bench', '[]'::jsonb);
  v_shirts      jsonb := coalesce(p_lineup->'shirt_numbers', '{}'::jsonb);
  v_start_ct    int;
  v_bench_ct    int;
  v_all         text[];
  v_dup         text[];
  v_bad         text[];
  v_double      text[];
  v_susp        text[];
  v_min_start   int;
  v_max_subs    int;
  v_override    text[] := coalesce(p_override_player_ids, ARRAY[]::text[]);
  v_registered  int := 0;
BEGIN
  -- caller: admin_token OR VC player_token (session-49 dual-lookup, mig 074)
  SELECT team_id, actor_type, actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token);
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

  v_start_ct := jsonb_array_length(v_starting);
  v_bench_ct := jsonb_array_length(v_bench);

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

  -- squad-size bounds on the matchday sheet (league_config, NULL = unbounded)
  SELECT s.league_id INTO v_league_id
    FROM competitions c JOIN seasons s ON s.id = c.season_id
   WHERE c.id = v_comp_id;
  SELECT COALESCE(lc.min_starting, def.min_starting),
         COALESCE(lc.max_subs,     def.max_subs)
    INTO v_min_start, v_max_subs
    FROM (SELECT 1) one
    LEFT JOIN league_config lc  ON lc.league_id  = v_league_id
    LEFT JOIN league_config def ON def.league_id IS NULL;
  IF v_min_start IS NOT NULL AND v_start_ct < v_min_start THEN
    RAISE EXCEPTION 'too_few_starters' USING ERRCODE = 'P0001',
      DETAIL = v_start_ct || '/' || v_min_start;
  END IF;
  IF v_max_subs IS NOT NULL AND v_bench_ct > v_max_subs THEN
    RAISE EXCEPTION 'too_many_subs' USING ERRCODE = 'P0001',
      DETAIL = v_bench_ct || '/' || v_max_subs;
  END IF;

  -- double-registration: picked player registered to a DIFFERENT team in this comp.
  -- HARD block (team admin can't override; league admin resolves later — Phase 4/6).
  SELECT array_agg(DISTINCT pr.player_id) INTO v_double
    FROM player_registrations pr
   WHERE pr.competition_id = v_comp_id
     AND pr.player_id = ANY(v_all)
     AND pr.team_id <> v_team_id;
  IF v_double IS NOT NULL AND array_length(v_double, 1) > 0 THEN
    -- audit the integrity clash for the league admin to act on later
    INSERT INTO audit_events (
      team_id, actor_user_id, actor_type, actor_identifier,
      action, entity_type, entity_id, metadata
    ) VALUES (
      v_team_id, auth.uid(), v_actor_type, v_actor_ident,
      'lineup_double_registration_blocked', 'fixture', p_fixture_id::text,
      jsonb_build_object('competition_id', v_comp_id, 'player_ids', to_jsonb(v_double))
    );
    RAISE EXCEPTION 'player_double_registered' USING ERRCODE = 'P0001',
      DETAIL = array_to_string(v_double, ',');
  END IF;

  -- suspended / ineligible on this team's registration: BLOCK unless overridden
  SELECT array_agg(DISTINCT pr.player_id) INTO v_susp
    FROM player_registrations pr
   WHERE pr.competition_id = v_comp_id
     AND pr.team_id = v_team_id
     AND pr.player_id = ANY(v_all)
     AND (pr.status IN ('suspended','ineligible')
          OR (pr.suspension_until IS NOT NULL AND pr.suspension_until > current_date))
     AND NOT (pr.player_id = ANY(v_override));
  IF v_susp IS NOT NULL AND array_length(v_susp, 1) > 0 THEN
    RAISE EXCEPTION 'player_ineligible' USING ERRCODE = 'P0001',
      DETAIL = array_to_string(v_susp, ',');
  END IF;

  -- ── all gates passed → write ───────────────────────────────────────────────
  -- auto-register picked players (idempotent — submit registers)
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

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, auth.uid(), v_actor_type, v_actor_ident,
    'lineup_submitted', 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'competition_id',     v_comp_id,
      'starting_count',     v_start_ct,
      'bench_count',        v_bench_ct,
      'registered_count',   v_registered,
      'override_player_ids', to_jsonb(v_override)
    )
  );

  RETURN jsonb_build_object(
    'ok',               true,
    'fixture_id',       p_fixture_id,
    'team_id',          v_team_id,
    'starting_count',   v_start_ct,
    'bench_count',      v_bench_ct,
    'registered_count', v_registered,
    'overridden',       to_jsonb(v_override),
    'warnings',         '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.team_admin_submit_lineup(text, uuid, jsonb, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_admin_submit_lineup(text, uuid, jsonb, text[]) TO anon, authenticated;

-- ── Read: next-fixture lineup — VC dual-lookup parity (paired-read rule) ──────
-- Body unchanged except the caller resolution now accepts a VC player_token.
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
  SELECT team_id INTO v_team_id FROM resolve_admin_caller(p_admin_token);
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
