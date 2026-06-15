-- Migration 325 — Event OS: Phase 7D Double Elimination
--
-- Implements the double_elimination competition format: a team must lose TWICE
-- to be eliminated. Two brackets run in parallel (Winners + Losers) plus a
-- Grand Final. No bracket reset — LB winner who beats the WB winner in the GF
-- IS the champion.
--
-- Changes:
--   1. ALTER TABLE fixtures: ADD de_bracket, de_loser_to_fixture_id, de_loser_to_slot
--   2. Widen fixtures_home_identity CHECK to permit DE bracket slots (teams TBD at creation)
--   3. CREATE FUNCTION _advance_tournament_double_elim — internal bracket-advance helper
--   4. CREATE FUNCTION club_admin_seed_double_elimination — director seeds DE bracket
--   5. REPLACE ref_confirm_tournament_match — branch on de_bracket for advancement
--   6. REPLACE club_admin_get_schedule — add de_bracket to fixture rows
--   7. REPLACE get_tournament_public — add de_bracket to knockout_fixture rows

-- ─── 1. Schema additions ──────────────────────────────────────────────────────

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS de_bracket text
    CHECK (de_bracket IN ('winners','losers','grand_final') OR de_bracket IS NULL),
  ADD COLUMN IF NOT EXISTS de_loser_to_fixture_id uuid
    REFERENCES public.fixtures(id),
  ADD COLUMN IF NOT EXISTS de_loser_to_slot text
    CHECK (de_loser_to_slot IN ('home','away') OR de_loser_to_slot IS NULL);

-- Widen fixtures_home_identity to allow DE bracket slots created with teams TBD.
-- de_bracket IS NOT NULL is sufficient identity: the fixture belongs to a known bracket.
ALTER TABLE public.fixtures DROP CONSTRAINT IF EXISTS fixtures_home_identity;
ALTER TABLE public.fixtures ADD CONSTRAINT fixtures_home_identity CHECK (
  (home_team_id IS NOT NULL)
  OR (home_competition_team_id IS NOT NULL)
  OR (knockout_home_feeder_id IS NOT NULL)
  OR (de_bracket IS NOT NULL)
);

-- ─── 2. _advance_tournament_double_elim ──────────────────────────────────────
-- Internal helper: on match completion, advance the winner to the next bracket
-- slot (via knockout_home/away_feeder_id) and route the loser to their
-- de_loser_to_fixture_id slot (de_loser_to_slot = 'home' | 'away').
--
-- Slot assignments set at seeding time:
--   WB R1 losers → LB R1 (home for the 1st loser, away for the 2nd)
--   WB R2+ losers → LB drop rounds (always away; home is reserved for LB survivor)
--   LB fixtures → de_loser_to_fixture_id IS NULL (loser eliminated)
--   Grand Final → de_loser_to_fixture_id IS NULL (runner-up, no further routing)
-- Draws: no auto-advance (director must re-ref).

CREATE OR REPLACE FUNCTION public._advance_tournament_double_elim(p_fixture_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_fx     public.fixtures;
  v_winner uuid;
  v_loser  uuid;
  v_next   uuid;
BEGIN
  SELECT * INTO v_fx FROM public.fixtures WHERE id = p_fixture_id;
  IF v_fx.id IS NULL THEN RETURN; END IF;
  IF v_fx.home_score IS NULL OR v_fx.away_score IS NULL THEN RETURN; END IF;
  IF v_fx.home_score = v_fx.away_score THEN RETURN; END IF;

  IF v_fx.home_score > v_fx.away_score THEN
    v_winner := v_fx.home_competition_team_id;
    v_loser  := v_fx.away_competition_team_id;
  ELSE
    v_winner := v_fx.away_competition_team_id;
    v_loser  := v_fx.home_competition_team_id;
  END IF;

  -- Advance winner via existing feeder mechanism (same as single-elim)
  UPDATE public.fixtures
     SET home_competition_team_id = v_winner
   WHERE knockout_home_feeder_id = p_fixture_id
  RETURNING id INTO v_next;

  IF v_next IS NULL THEN
    UPDATE public.fixtures
       SET away_competition_team_id = v_winner
     WHERE knockout_away_feeder_id = p_fixture_id
    RETURNING id INTO v_next;
  END IF;

  IF v_next IS NOT NULL THEN
    UPDATE public.fixtures
       SET status = 'scheduled'
     WHERE id = v_next
       AND home_competition_team_id IS NOT NULL
       AND away_competition_team_id IS NOT NULL
       AND status = 'allocated';
  END IF;

  -- Route loser to Losers Bracket slot (WB fixtures only).
  -- de_loser_to_slot tells us which slot to fill ('home' or 'away').
  IF v_fx.de_loser_to_fixture_id IS NOT NULL AND v_loser IS NOT NULL THEN
    IF v_fx.de_loser_to_slot = 'home' THEN
      UPDATE public.fixtures
         SET home_competition_team_id = v_loser
       WHERE id = v_fx.de_loser_to_fixture_id;
    ELSE
      UPDATE public.fixtures
         SET away_competition_team_id = v_loser
       WHERE id = v_fx.de_loser_to_fixture_id;
    END IF;

    -- Promote LB fixture to 'scheduled' when both slots are filled
    UPDATE public.fixtures
       SET status = 'scheduled'
     WHERE id = v_fx.de_loser_to_fixture_id
       AND home_competition_team_id IS NOT NULL
       AND away_competition_team_id IS NOT NULL
       AND status = 'allocated';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._advance_tournament_double_elim(uuid) FROM PUBLIC, anon, authenticated;

-- ─── 3. club_admin_seed_double_elimination ────────────────────────────────────
-- Director RPC: creates the full DE bracket for a competition.
-- Teams seeded in registration order (v_teams[1] = earliest registrant).
-- WB R1 pairing: seed i vs seed (N+1-i).
-- Bracket structure:
--   WB: standard single-elim bracket (v_k rounds)
--   LB R1: pairs of WB R1 losers (home=first, away=second in each pair)
--   For WB rounds 2..k:
--     LB drop round: LB survivor (home via feeder) vs WB loser (away via de_loser_to_fixture_id)
--     LB consolidation round (if not the last WB round): pair LB drop winners
--   GF: WB Final winner (home) vs LB Final winner (away)
-- Constraint: N teams must be a power of 2 and >= 4.

CREATE OR REPLACE FUNCTION public.club_admin_seed_double_elimination(
  p_tournament_event_id uuid,
  p_competition_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_profile_id   uuid;
  v_club_id      text;
  v_config       jsonb;
  v_teams        uuid[];
  v_n            int;
  v_k            int;
  v_max_week     int;
  v_wk           int;
  v_fx_id        uuid;
  v_lb_id        uuid;
  v_wbf_id       uuid;

  v_wb_prev_ids  uuid[];
  v_wb_cur_ids   uuid[];
  v_wb_size      int;
  v_wb_round     int;

  v_lb_current   uuid[];
  v_lb_drop_ids  uuid[];
  v_lb_cons_ids  uuid[];
  v_lb_round_num int;

  v_total_wb     int := 0;
  v_total_lb     int := 0;
  i              int;
  j              int;
BEGIN
  -- ── auth ──────────────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles
  WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM public.tournament_events
  WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers ctm
    JOIN public.club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- ── pre-checks ────────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = p_competition_id AND format = 'double_elimination'
  ) THEN
    RAISE EXCEPTION 'not_double_elimination' USING ERRCODE = 'P0001';
  END IF;

  SELECT config INTO v_config FROM public.competitions WHERE id = p_competition_id;
  IF COALESCE((v_config->>'knockout_seeded')::boolean, false) THEN
    RAISE EXCEPTION 'already_seeded' USING ERRCODE = 'P0001';
  END IF;

  -- ── collect active teams in registration order ─────────────────────────────
  SELECT ARRAY(
    SELECT id FROM public.competition_teams
    WHERE competition_id = p_competition_id AND status = 'active'
    ORDER BY registered_at
  ) INTO v_teams;

  v_n := COALESCE(array_length(v_teams, 1), 0);

  IF v_n < 4 THEN
    RAISE EXCEPTION 'not_enough_teams' USING ERRCODE = 'P0001';
  END IF;

  IF (v_n & (v_n - 1)) <> 0 THEN
    RAISE EXCEPTION 'bracket_size_not_supported' USING ERRCODE = 'P0001';
  END IF;

  v_k := CAST(round(log(2, v_n)) AS int);

  SELECT COALESCE(MAX(week_number), 0) INTO v_max_week
  FROM public.fixtures WHERE competition_id = p_competition_id;

  v_wk := v_max_week + 1;

  -- ── WB Round 1 ────────────────────────────────────────────────────────────
  -- Pair seed i vs seed (N+1-i). Both teams known at seeding time → 'scheduled'.
  v_wb_size    := v_n / 2;
  v_wb_cur_ids := '{}';

  FOR i IN 1..v_wb_size LOOP
    INSERT INTO public.fixtures (
      competition_id, home_competition_team_id, away_competition_team_id,
      week_number, round_name, de_bracket, status
    ) VALUES (
      p_competition_id, v_teams[i], v_teams[v_n - i + 1],
      v_wk, 'WB R1', 'winners', 'scheduled'
    ) RETURNING id INTO v_fx_id;
    v_wb_cur_ids := v_wb_cur_ids || v_fx_id;
  END LOOP;
  v_total_wb := v_wb_size;
  v_wk := v_wk + 1;

  -- ── LB Round 1: pair WB R1 losers ─────────────────────────────────────────
  -- WB R1 has v_wb_size fixtures; each pair (2j-1, 2j) feeds one LB R1 fixture.
  -- First loser of each pair → home slot; second → away slot.
  v_lb_current   := '{}';
  v_lb_round_num := 1;

  FOR j IN 1..(v_wb_size / 2) LOOP
    INSERT INTO public.fixtures (
      competition_id, home_competition_team_id, away_competition_team_id,
      week_number, round_name, de_bracket, status
    ) VALUES (
      p_competition_id, NULL, NULL,
      v_wk, 'LB R' || v_lb_round_num, 'losers', 'allocated'
    ) RETURNING id INTO v_lb_id;
    v_lb_current := v_lb_current || v_lb_id;

    UPDATE public.fixtures
       SET de_loser_to_fixture_id = v_lb_id, de_loser_to_slot = 'home'
     WHERE id = v_wb_cur_ids[2*j - 1];

    UPDATE public.fixtures
       SET de_loser_to_fixture_id = v_lb_id, de_loser_to_slot = 'away'
     WHERE id = v_wb_cur_ids[2*j];
  END LOOP;
  v_total_lb     := v_wb_size / 2;
  v_lb_round_num := v_lb_round_num + 1;
  v_wk           := v_wk + 1;

  -- ── WB Rounds 2..k + corresponding LB rounds ──────────────────────────────
  v_wb_prev_ids := v_wb_cur_ids;

  FOR v_wb_round IN 2..v_k LOOP

    -- WB round: pair consecutive winners from the previous WB round
    v_wb_size    := v_wb_size / 2;
    v_wb_cur_ids := '{}';

    FOR i IN 1..v_wb_size LOOP
      INSERT INTO public.fixtures (
        competition_id, home_competition_team_id, away_competition_team_id,
        knockout_home_feeder_id, knockout_away_feeder_id,
        week_number, round_name, de_bracket, status
      ) VALUES (
        p_competition_id, NULL, NULL,
        v_wb_prev_ids[2*i - 1], v_wb_prev_ids[2*i],
        v_wk,
        CASE WHEN v_wb_round = v_k THEN 'WB Final' ELSE 'WB R' || v_wb_round END,
        'winners', 'allocated'
      ) RETURNING id INTO v_fx_id;
      v_wb_cur_ids := v_wb_cur_ids || v_fx_id;
      v_total_wb   := v_total_wb + 1;
    END LOOP;
    v_wk := v_wk + 1;

    -- LB drop round: each LB survivor (home via feeder) meets the corresponding
    -- WB loser (away via de_loser_to_fixture_id).
    -- When this is the last WB round (v_wb_round = v_k), this drop round IS
    -- the LB Final.
    v_lb_drop_ids := '{}';

    FOR i IN 1..v_wb_size LOOP
      INSERT INTO public.fixtures (
        competition_id, home_competition_team_id, away_competition_team_id,
        knockout_home_feeder_id,
        week_number, round_name, de_bracket, status
      ) VALUES (
        p_competition_id, NULL, NULL,
        v_lb_current[i],
        v_wk,
        CASE WHEN v_wb_round = v_k THEN 'LB Final' ELSE 'LB R' || v_lb_round_num END,
        'losers', 'allocated'
      ) RETURNING id INTO v_lb_id;
      v_lb_drop_ids := v_lb_drop_ids || v_lb_id;

      -- Wire the WB loser into the away slot of this LB drop fixture
      UPDATE public.fixtures
         SET de_loser_to_fixture_id = v_lb_id, de_loser_to_slot = 'away'
       WHERE id = v_wb_cur_ids[i];

      v_total_lb := v_total_lb + 1;
    END LOOP;
    v_lb_round_num := v_lb_round_num + 1;
    v_wk           := v_wk + 1;

    -- LB consolidation round: between WB rounds, LB drop winners play each other
    -- before the next WB drop arrives. Skip after the final WB round.
    IF v_wb_round < v_k THEN
      v_lb_cons_ids := '{}';

      FOR i IN 1..(v_wb_size / 2) LOOP
        INSERT INTO public.fixtures (
          competition_id, home_competition_team_id, away_competition_team_id,
          knockout_home_feeder_id, knockout_away_feeder_id,
          week_number, round_name, de_bracket, status
        ) VALUES (
          p_competition_id, NULL, NULL,
          v_lb_drop_ids[2*i - 1], v_lb_drop_ids[2*i],
          v_wk, 'LB R' || v_lb_round_num, 'losers', 'allocated'
        ) RETURNING id INTO v_lb_id;
        v_lb_cons_ids  := v_lb_cons_ids || v_lb_id;
        v_total_lb     := v_total_lb + 1;
      END LOOP;
      v_lb_round_num := v_lb_round_num + 1;
      v_wk           := v_wk + 1;

      v_lb_current := v_lb_cons_ids;
    END IF;

    v_wb_prev_ids := v_wb_cur_ids;
  END LOOP;

  -- After the loop:
  --   v_wb_cur_ids[1]  = WB Final fixture
  --   v_lb_drop_ids[1] = LB Final fixture (last drop round always produces 1 fixture)
  v_wbf_id := v_wb_cur_ids[1];

  -- ── Grand Final ────────────────────────────────────────────────────────────
  INSERT INTO public.fixtures (
    competition_id, home_competition_team_id, away_competition_team_id,
    knockout_home_feeder_id, knockout_away_feeder_id,
    week_number, round_name, de_bracket, status
  ) VALUES (
    p_competition_id, NULL, NULL,
    v_wbf_id, v_lb_drop_ids[1],
    v_wk, 'Grand Final', 'grand_final', 'allocated'
  );

  -- ── mark competition as seeded ─────────────────────────────────────────────
  UPDATE public.competitions
     SET config = COALESCE(config, '{}') || '{"knockout_seeded": true}'::jsonb
   WHERE id = p_competition_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_de_seeded', 'competition', p_competition_id::text,
    jsonb_build_object(
      'tournament_event_id', p_tournament_event_id,
      'total_teams',         v_n,
      'wb_fixtures',         v_total_wb,
      'lb_fixtures',         v_total_lb
    )
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'total_teams', v_n,
    'wb_fixtures', v_total_wb,
    'lb_fixtures', v_total_lb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.club_admin_seed_double_elimination(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_admin_seed_double_elimination(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_admin_seed_double_elimination(uuid, uuid) TO authenticated;

-- ─── 4. ref_confirm_tournament_match (REPLACE) ───────────────────────────────
-- Branch on de_bracket: DE fixtures use _advance_tournament_double_elim;
-- single-elim knockout fixtures (de_bracket IS NULL, group_label IS NULL)
-- continue to use _advance_tournament_winner.

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

  -- Advance bracket:
  -- DE fixtures (de_bracket IS NOT NULL): use double-elim advance logic
  -- Single-elim knockout (de_bracket IS NULL + group_label IS NULL): single-elim advance
  -- Group stage (group_label IS NOT NULL): no advancement
  IF v_fixture.group_label IS NULL THEN
    IF v_fixture.de_bracket IS NOT NULL THEN
      PERFORM public._advance_tournament_double_elim(v_fixture.id);
    ELSE
      PERFORM public._advance_tournament_winner(v_fixture.id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'home_score', v_home, 'away_score', v_away, 'status', 'completed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_confirm_tournament_match(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_confirm_tournament_match(text)
  TO anon, authenticated;

-- ─── 5. club_admin_get_schedule (REPLACE) ─────────────────────────────────────
-- Adds de_bracket to every fixture row so the director UI can split WB/LB/GF.

CREATE OR REPLACE FUNCTION public.club_admin_get_schedule(p_tournament_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_venue_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id, venue_id INTO v_club_id, v_venue_id
  FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers ctm
    JOIN public.club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'tournament_event_id', p_tournament_event_id,
    'venue_playing_areas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',   pa.id,
        'name', pa.name
      ) ORDER BY pa.sort_order, pa.name)
      FROM playing_areas pa
      WHERE pa.venue_id = v_venue_id AND pa.active = true
    ), '[]'::jsonb),
    'competitions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id',  comp.id,
        'name',            comp.name,
        'type',            comp.type,
        'format',          comp.format,
        'status',          comp.status,
        'knockout_seeded', COALESCE((comp.config->>'knockout_seeded')::boolean, false),
        'fixtures', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'fixture_id',      fx.id,
            'round',           fx.week_number,
            'round_name',      fx.round_name,
            'group_label',     fx.group_label,
            'de_bracket',      fx.de_bracket,
            'home_team_id',    fx.home_competition_team_id,
            'home_team_name',  ht.team_name,
            'away_team_id',    fx.away_competition_team_id,
            'away_team_name',  att.team_name,
            'scheduled_date',  fx.scheduled_date,
            'kickoff_time',    fx.kickoff_time,
            'playing_area_id', fx.playing_area_id,
            'pitch_name',      pa.name,
            'slot_minutes',    fx.slot_minutes,
            'status',          fx.status,
            'ref_token',       fx.ref_token,
            'home_score',      fx.home_score,
            'away_score',      fx.away_score
          ) ORDER BY fx.week_number, fx.kickoff_time NULLS LAST, fx.id)
          FROM fixtures fx
          LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
          LEFT JOIN competition_teams att ON att.id = fx.away_competition_team_id
          LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
          WHERE fx.competition_id = comp.id
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = p_tournament_event_id
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_get_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_schedule(uuid) TO authenticated;

-- ─── 6. get_tournament_public (REPLACE) ───────────────────────────────────────
-- Adds de_bracket to knockout_fixture rows so the public bracket page
-- can split Winners / Losers / Grand Final sections.

CREATE OR REPLACE FUNCTION public.get_tournament_public(
  p_slug text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_te record;
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
        'competition_id',  comp.id,
        'name',            comp.name,
        'type',            comp.type,
        'format',          comp.format,
        'status',          comp.status,
        'knockout_seeded', COALESCE((comp.config->>'knockout_seeded')::boolean, false),
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
    -- group-stage fixtures only (group_label IS NOT NULL)
    'fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fixture_id',       fx.id,
        'competition_id',   fx.competition_id,
        'competition_name', comp.name,
        'round',            fx.week_number,
        'round_name',       fx.round_name,
        'group_label',      fx.group_label,
        'scheduled_date',   fx.scheduled_date,
        'kickoff_time',     CASE
          WHEN fx.kickoff_time IS NOT NULL THEN to_char(fx.kickoff_time, 'HH24:MI')
          ELSE NULL END,
        'pitch_name',       pa.name,
        'home_team_name',   ht.team_name,
        'away_team_name',   at2.team_name,
        'home_score',       fx.home_score,
        'away_score',       fx.away_score,
        'status',           fx.status,
        'current_period',   fx.current_period
      ) ORDER BY fx.scheduled_date NULLS LAST, fx.kickoff_time NULLS LAST, fx.week_number, fx.id)
      FROM fixtures fx
      JOIN competitions comp    ON comp.id = fx.competition_id
      LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
      LEFT JOIN competition_teams at2 ON at2.id = fx.away_competition_team_id
      LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
      WHERE comp.tournament_event_id = v_te.id
        AND fx.group_label IS NOT NULL
    ), '[]'::jsonb),
    -- non-group fixtures (group_label IS NULL): covers single-elim knockouts AND DE brackets.
    -- de_bracket field lets the client split 'winners' / 'losers' / 'grand_final' sections.
    'knockout_fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fixture_id',       fx.id,
        'competition_id',   fx.competition_id,
        'competition_name', comp.name,
        'round',            fx.week_number,
        'round_name',       fx.round_name,
        'de_bracket',       fx.de_bracket,
        'scheduled_date',   fx.scheduled_date,
        'kickoff_time',     CASE
          WHEN fx.kickoff_time IS NOT NULL THEN to_char(fx.kickoff_time, 'HH24:MI')
          ELSE NULL END,
        'pitch_name',       pa.name,
        'home_team_name',   ht.team_name,
        'away_team_name',   at2.team_name,
        'home_score',       fx.home_score,
        'away_score',       fx.away_score,
        'status',           fx.status,
        'current_period',   fx.current_period
      ) ORDER BY fx.week_number, fx.kickoff_time NULLS LAST, fx.id)
      FROM fixtures fx
      JOIN competitions comp    ON comp.id = fx.competition_id
      LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
      LEFT JOIN competition_teams at2 ON at2.id = fx.away_competition_team_id
      LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
      WHERE comp.tournament_event_id = v_te.id
        AND fx.group_label IS NULL
    ), '[]'::jsonb),
    -- group standings (group-stage fixtures only; includes group_label + group_rank)
    'standings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id',   comp.id,
        'competition_name', comp.name,
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
              COUNT(CASE WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1 END)::int AS drawn,
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
               COUNT(CASE WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1 END))::int AS pts
            FROM competition_teams ct
            LEFT JOIN fixtures fx
              ON (fx.home_competition_team_id = ct.id OR fx.away_competition_team_id = ct.id)
              AND fx.competition_id = comp.id
              AND fx.status = 'completed'
              AND fx.home_score IS NOT NULL
              AND fx.away_score IS NOT NULL
              AND fx.group_label IS NOT NULL
            WHERE ct.competition_id = comp.id
              AND ct.status = 'active'
            GROUP BY ct.id, ct.team_name, ct.group_label, ct.group_rank
          ) row
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_tournament_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_public(text) TO anon, authenticated;
