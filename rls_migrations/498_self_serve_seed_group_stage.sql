-- 498_self_serve_seed_group_stage.sql
--
-- Standalone Tournament Self-Serve epic — "Groups, then knockout" format, PR #1.
--
-- THE GAP: self_serve_create_tournament (mig 489) already accepts format='groups'
-- → competitions(type='cup', format='group_stage'), self_serve_enter_result (mig 493)
-- already scores group fixtures (group_label set → draws allowed, no advance) AND
-- knockout fixtures (group_label NULL → advance), and venue_seed_knockout (mig 452,
-- CONFIG-DRIVEN as of mig 500) already seeds the KO bracket from group qualifiers. The
-- ONLY missing tournament-mode piece is a seeder that (a) assigns approved teams to
-- groups and (b) generates the per-group all-play-all fixtures. This RPC is that piece.
--
-- WHY NOT the phase-11 league-mode functions (venue_persist_group_stage mig 192,
-- get_group_standings mig 193, venue_seed_knockout_from_groups): they write
-- fixtures.home_team_id (text) and guard on cup_ties, which self_serve_enter_result
-- CANNOT score (mig 493:18-19). This seeder writes tournament-mode fixtures
-- (home_competition_team_id + group_label) exactly as venue_seed_knockout's standings
-- CTE and its incomplete_group_fixtures gate expect.
--
-- LOAD-BEARING: venue_seed_knockout refuses to seed the KO unless every fixture with
-- group_label IS NOT NULL is 'completed', and reads groups from
-- competition_teams.group_label. So this seeder MUST set group_label on BOTH the
-- competition_teams rows AND on every group fixture.
--
-- QUALIFIERS-PER-GROUP (configurable, v1 = 1 or 2): the organiser chooses how many teams
-- advance from each group (top-1 → a smaller/robust bracket; top-2 → classic). Recorded
-- in competitions.config.qualifiers_per_group; venue_seed_knockout (mig 500) reads it to
-- pick the qualifiers (defaults to 2 when absent → the paid venue-operator flow is
-- unchanged). Total qualifiers = num_groups × qualifiers_per_group must be a power of 2
-- (2/4/8/16). num_groups ∈ {2,4,8} × qpg ∈ {1,2} → 2/4/8/16 always (all valid); the
-- power-of-2 assertion is defensive.
--
-- MIN TEAMS PER GROUP = qualifiers_per_group + 1: every group must have at least one team
-- that does NOT qualify (else it isn't a real group), which also gives no-show headroom —
-- top-1 needs ≥2/group, top-2 needs ≥3/group. This closes the "a no-show strands the KO"
-- dead-end for the common single-no-show case (mig 499 guards the rest).
--
-- DRAW: auto snake-draw by registration order (1,2,3,3,2,1…) for balance. Uneven group
-- sizes get an in-group bye via the circle method's NULL slot — never an empty
-- competition_team row. System letter labels (A/B/C…), never operator free-text
-- (Decision #5 — keeps group names out of the UGC surface).
--
-- FIXTURES: unscheduled (no date/pitch/time — Decision #6); circle method verbatim from
-- venue_generate_schedule (452:909-948) but partitioned per group with group_label SET.
--
-- AUTH / grants: Stage-1b venue_id-as-token via _authorise_venue_tournament — identical
-- surface to mig 491 / venue_seed_knockout. authenticated-only.

CREATE OR REPLACE FUNCTION public.self_serve_seed_group_stage(
  p_venue_token           text,
  p_tournament_event_id   uuid,
  p_competition_id        uuid,
  p_num_groups            int,
  p_qualifiers_per_group  int
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth          record;
  v_comp_format   text;
  v_qualifiers    int;
  v_min_teams     int;
  v_teams         uuid[];
  v_n             int;
  v_g             int;
  v_row           int;
  v_pos           int;
  v_label         text;
  t               int;
  v_glabel        text;
  v_gteams        uuid[];
  v_gn            int;
  v_gm            int;
  v_round         int;
  v_slot          int;
  v_home          uuid;
  v_away          uuid;
  v_fixture_count int := 0;
BEGIN
  -- Authorise: caller owns this tournament's venue (Stage-1b re-checks auth.uid()).
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  -- Competition must belong to the event AND be a group_stage cup (load-bearing IDOR
  -- guard — mirror mig 491:69-79).
  SELECT c.format INTO v_comp_format
  FROM public.competitions c
  WHERE c.id = p_competition_id AND c.tournament_event_id = p_tournament_event_id
  FOR UPDATE;

  IF v_comp_format IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp_format <> 'group_stage' THEN
    RAISE EXCEPTION 'not_group_stage' USING ERRCODE = 'P0001',
      DETAIL = 'competition format is ' || v_comp_format;
  END IF;

  -- Idempotency: refuse a double-seed (config flag OR any existing fixtures).
  IF COALESCE((SELECT (config->>'groups_seeded')::boolean FROM public.competitions WHERE id = p_competition_id), false) THEN
    RAISE EXCEPTION 'groups_already_seeded' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixtures WHERE competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'groups_already_seeded' USING ERRCODE = 'P0001';
  END IF;

  -- Validate the shape: num_groups ∈ {2,4,8}, qualifiers_per_group ∈ {1,2}, and the
  -- resulting bracket size (num_groups × qpg) is a power of 2 (2/4/8/16).
  IF p_num_groups NOT IN (2, 4, 8) THEN
    RAISE EXCEPTION 'num_groups_not_supported' USING ERRCODE = 'P0001',
      DETAIL = p_num_groups::text || ' groups — must be 2, 4 or 8';
  END IF;
  IF p_qualifiers_per_group NOT IN (1, 2) THEN
    RAISE EXCEPTION 'qualifiers_per_group_not_supported' USING ERRCODE = 'P0001',
      DETAIL = p_qualifiers_per_group::text || ' per group — must be 1 or 2';
  END IF;

  v_qualifiers := p_num_groups * p_qualifiers_per_group;
  IF v_qualifiers < 2 OR (v_qualifiers & (v_qualifiers - 1)) <> 0 THEN
    RAISE EXCEPTION 'bracket_size_not_supported' USING ERRCODE = 'P0001',
      DETAIL = v_qualifiers::text || ' qualifiers — must be a power of 2 (2/4/8/16)';
  END IF;

  -- Approved (active) teams, in registration order.
  SELECT ARRAY(
    SELECT id FROM public.competition_teams
    WHERE competition_id = p_competition_id AND status = 'active'
    ORDER BY registered_at, team_name
  ) INTO v_teams;

  v_n := COALESCE(array_length(v_teams, 1), 0);

  -- Min teams per group = qualifiers_per_group + 1 (a real group always has at least one
  -- non-qualifier, and this absorbs a single no-show without stranding the KO).
  v_min_teams := p_num_groups * (p_qualifiers_per_group + 1);
  IF v_n < v_min_teams THEN
    RAISE EXCEPTION 'not_enough_teams' USING ERRCODE = 'P0001',
      DETAIL = v_n::text || ' teams — need at least ' || v_min_teams::text
        || ' for ' || p_num_groups::text || ' groups with top-' || p_qualifiers_per_group::text || ' advancing';
  END IF;

  -- Snake-draw: teams walk into groups serpentine (0,1,..,N-1, N-1,..,1,0, 0,1,..) so
  -- registration strength is spread evenly, never stacked in group A.
  FOR t IN 0..(v_n - 1) LOOP
    v_row := t / p_num_groups;
    v_pos := t % p_num_groups;
    IF v_row % 2 = 0 THEN
      v_g := v_pos;
    ELSE
      v_g := p_num_groups - 1 - v_pos;
    END IF;
    v_label := chr(65 + v_g);  -- 0→'A', 1→'B', …
    UPDATE public.competition_teams
    SET group_label = v_label
    WHERE id = v_teams[t + 1];
  END LOOP;

  -- Per-group all-play-all fixtures. Circle method verbatim from venue_generate_schedule
  -- (452:909-948) but partitioned per group, with group_label SET and NO scheduling
  -- (Decision #6). Odd-sized groups get an in-group bye (NULL slot → skip).
  FOR v_g IN 0..(p_num_groups - 1) LOOP
    v_glabel := chr(65 + v_g);

    SELECT ARRAY(
      SELECT id FROM public.competition_teams
      WHERE competition_id = p_competition_id AND status = 'active' AND group_label = v_glabel
      ORDER BY registered_at, team_name
    ) INTO v_gteams;

    v_gn := COALESCE(array_length(v_gteams, 1), 0);
    IF v_gn < 2 THEN
      CONTINUE;  -- defensive: guarded above, but never emit a group with <2 teams
    END IF;

    IF v_gn % 2 = 1 THEN
      v_gteams := v_gteams || ARRAY[NULL::uuid];
      v_gn     := v_gn + 1;
    END IF;

    v_gm := v_gn - 1;

    FOR v_round IN 1..v_gm LOOP
      FOR v_slot IN 1..(v_gn / 2) LOOP
        v_home := v_gteams[v_slot];
        v_away := v_gteams[v_gn - v_slot + 1];

        IF v_home IS NULL OR v_away IS NULL THEN
          CONTINUE;  -- bye
        END IF;

        INSERT INTO public.fixtures (
          competition_id,
          home_competition_team_id,
          away_competition_team_id,
          week_number,
          round_name,
          group_label,
          status
        ) VALUES (
          p_competition_id,
          v_home,
          v_away,
          v_round,
          'Group ' || v_glabel,
          v_glabel,
          'scheduled'
        );
        v_fixture_count := v_fixture_count + 1;
      END LOOP;

      -- Rotate all but the fixed first team (circle method).
      v_gteams := ARRAY[v_gteams[1]] || ARRAY[v_gteams[v_gn]] || v_gteams[2:v_gn - 1];
    END LOOP;
  END LOOP;

  -- Persist group intent as data. venue_seed_knockout (mig 500) reads qualifiers_per_group
  -- to pick the top-N of each group; recording it here (not hardcoding) means the qualifier
  -- rule is data, not code buried in the seeder.
  UPDATE public.competitions
  SET config = COALESCE(config, '{}'::jsonb)
             || jsonb_build_object('groups_seeded', true, 'num_groups', p_num_groups, 'qualifiers_per_group', p_qualifiers_per_group)
  WHERE id = p_competition_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_group_stage_seeded', 'competition', p_competition_id::text,
    jsonb_build_object(
      'tournament_event_id',   p_tournament_event_id,
      'total_teams',           v_n,
      'num_groups',            p_num_groups,
      'qualifiers_per_group',  p_qualifiers_per_group,
      'fixtures_created',      v_fixture_count
    )
  );

  RETURN jsonb_build_object(
    'ok',                   true,
    'total_teams',          v_n,
    'num_groups',           p_num_groups,
    'qualifiers_per_group', p_qualifiers_per_group,
    'bracket_size',         v_qualifiers,
    'fixtures_created',     v_fixture_count
  );
END;
$function$;

-- Grants: authenticated-only (self-serve organisers are always signed in). Strip PUBLIC
-- and the auto-granted anon explicitly (default-privileges gotcha).
REVOKE ALL ON FUNCTION public.self_serve_seed_group_stage(text, uuid, uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_seed_group_stage(text, uuid, uuid, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_seed_group_stage(text, uuid, uuid, int, int) TO authenticated;
