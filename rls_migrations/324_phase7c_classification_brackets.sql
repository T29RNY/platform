-- Migration 324 — Event OS: Phase 7C Classification Brackets
--
-- Adds knockout bracket generation from group-stage standings.
-- Director triggers "advance to knockouts" after all group fixtures complete;
-- the system stamps per-group ranks, generates the full knockout bracket
-- seeded cross-group, and auto-advances winners as each match confirms.
--
-- Changes:
--   1. ALTER TABLE fixtures        ADD knockout_home_feeder_id, knockout_away_feeder_id
--   2. ALTER TABLE competition_teams ADD group_rank
--   3. CREATE FUNCTION _advance_tournament_winner   — internal bracket-advance helper
--   4. CREATE FUNCTION club_admin_seed_knockout     — director seeds the bracket
--   5. REPLACE ref_confirm_tournament_match         — add advance call on knockout FT
--   6. REPLACE club_admin_get_standings             — add group_label filter + group_label rows + knockout_seeded
--   7. REPLACE club_admin_get_schedule              — add group_label on fixtures + knockout_seeded on competition
--   8. REPLACE get_tournament_public               — filter standings to group stage; add knockout_seeded + knockout fixtures
--   9. REPLACE club_admin_get_tournament            — add group_label + group_rank to team rows; add knockout_seeded per competition

-- ─── 1. Schema additions ──────────────────────────────────────────────────────

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS knockout_home_feeder_id uuid REFERENCES public.fixtures(id),
  ADD COLUMN IF NOT EXISTS knockout_away_feeder_id uuid REFERENCES public.fixtures(id);

ALTER TABLE public.competition_teams
  ADD COLUMN IF NOT EXISTS group_rank int;

-- Widen fixtures_home_identity to allow allocated knockout fixtures (teams TBD).
-- Original: home_team_id IS NOT NULL OR home_competition_team_id IS NOT NULL
-- After:    also permits knockout_home_feeder_id IS NOT NULL (future-round bracket slots)
ALTER TABLE public.fixtures DROP CONSTRAINT IF EXISTS fixtures_home_identity;
ALTER TABLE public.fixtures ADD CONSTRAINT fixtures_home_identity CHECK (
  (home_team_id IS NOT NULL)
  OR (home_competition_team_id IS NOT NULL)
  OR (knockout_home_feeder_id IS NOT NULL)
);

-- ─── 2. _advance_tournament_winner ───────────────────────────────────────────
-- Internal helper: determine the winner of a completed knockout fixture and
-- slot them into the next-round fixture (home or away slot) via feeder IDs.
-- Called from ref_confirm_tournament_match after every knockout FT confirmation.
-- If scores are equal (draw): no advancement — the director must re-ref.

CREATE OR REPLACE FUNCTION public._advance_tournament_winner(p_fixture_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_fx       public.fixtures;
  v_winner   uuid;
  v_next_id  uuid;
BEGIN
  SELECT * INTO v_fx FROM public.fixtures WHERE id = p_fixture_id;
  IF v_fx.id IS NULL THEN RETURN; END IF;

  IF v_fx.home_score > v_fx.away_score THEN
    v_winner := v_fx.home_competition_team_id;
  ELSIF v_fx.away_score > v_fx.home_score THEN
    v_winner := v_fx.away_competition_team_id;
  ELSE
    RETURN; -- draw: no auto-advance
  END IF;

  UPDATE public.fixtures
     SET home_competition_team_id = v_winner
   WHERE knockout_home_feeder_id = p_fixture_id
  RETURNING id INTO v_next_id;

  IF v_next_id IS NULL THEN
    UPDATE public.fixtures
       SET away_competition_team_id = v_winner
     WHERE knockout_away_feeder_id = p_fixture_id
    RETURNING id INTO v_next_id;
  END IF;

  IF v_next_id IS NOT NULL THEN
    UPDATE public.fixtures
       SET status = 'scheduled'
     WHERE id = v_next_id
       AND home_competition_team_id IS NOT NULL
       AND away_competition_team_id IS NOT NULL
       AND status = 'allocated';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._advance_tournament_winner(uuid) FROM PUBLIC, anon, authenticated;

-- ─── 3. club_admin_seed_knockout ─────────────────────────────────────────────
-- Director call: ranks group-stage teams (H2H tiebreaker, same as Phase 7A),
-- stamps competition_teams.group_rank, then generates the full knockout bracket.
-- Seeding: all rank-1 teams (sorted by group_label), then all rank-2 teams.
-- Pairing: serpentine (seed i vs seed n-i+1, 0-indexed → avoids same-group R1).
-- Round-1 fixtures get teams populated; subsequent rounds have NULL teams and
-- knockout_home/away_feeder_id set so _advance_tournament_winner can slot winners.
-- Constraint: total qualifiers must be a power of 2 (2/4/8/16).

CREATE OR REPLACE FUNCTION public.club_admin_seed_knockout(
  p_tournament_event_id uuid,
  p_competition_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_profile_id      uuid;
  v_club_id         text;
  v_config          jsonb;
  v_num_groups      int;
  v_n               int;   -- total qualifiers
  v_num_rounds      int;
  v_max_week        int;
  v_qualifiers      uuid[];
  v_current_batch   uuid[] := '{}';
  v_next_batch      uuid[] := '{}';
  v_fx_id           uuid;
  v_next_id         uuid;
  i                 int;
  j                 int;
  v_round_num       int;
  v_batch_size      int;
  v_rnames          text[] := ARRAY['Final','Semi-Finals','Quarter-Finals','Round of 16'];
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
  SELECT config INTO v_config FROM public.competitions WHERE id = p_competition_id;
  IF COALESCE((v_config->>'knockout_seeded')::boolean, false) THEN
    RAISE EXCEPTION 'knockout_already_seeded' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.fixtures
    WHERE competition_id = p_competition_id
      AND group_label IS NOT NULL
      AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'incomplete_group_fixtures' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(DISTINCT group_label)::int INTO v_num_groups
  FROM public.competition_teams
  WHERE competition_id = p_competition_id AND status = 'active' AND group_label IS NOT NULL;

  IF v_num_groups < 2 THEN
    RAISE EXCEPTION 'no_groups_found' USING ERRCODE = 'P0001';
  END IF;

  -- ── stamp group_rank via H2H per-group standings (Phase 7A logic) ─────────
  WITH base_standings AS (
    SELECT
      ct.id,
      ct.team_name,
      ct.group_label,
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
    FROM public.competition_teams ct
    LEFT JOIN public.fixtures fx
      ON (fx.home_competition_team_id = ct.id OR fx.away_competition_team_id = ct.id)
      AND fx.competition_id = p_competition_id
      AND fx.status = 'completed'
      AND fx.home_score IS NOT NULL
      AND fx.away_score IS NOT NULL
      AND fx.group_label IS NOT NULL
    WHERE ct.competition_id = p_competition_id
      AND ct.status = 'active'
      AND ct.group_label IS NOT NULL
    GROUP BY ct.id, ct.team_name, ct.group_label
  ),
  h2h AS (
    SELECT
      bs.id AS team_id,
      COALESCE(SUM(CASE
        WHEN fx.home_competition_team_id = bs.id AND fx.home_score > fx.away_score THEN 3
        WHEN fx.home_competition_team_id = bs.id AND fx.home_score = fx.away_score THEN 1
        WHEN fx.away_competition_team_id = bs.id AND fx.away_score > fx.home_score THEN 3
        WHEN fx.away_competition_team_id = bs.id AND fx.away_score = fx.home_score THEN 1
        ELSE 0
      END), 0)::int AS h2h_pts,
      (COALESCE(SUM(CASE
        WHEN fx.home_competition_team_id = bs.id THEN COALESCE(fx.home_score, 0)
        WHEN fx.away_competition_team_id = bs.id THEN COALESCE(fx.away_score, 0)
        ELSE 0
      END), 0) -
       COALESCE(SUM(CASE
        WHEN fx.home_competition_team_id = bs.id THEN COALESCE(fx.away_score, 0)
        WHEN fx.away_competition_team_id = bs.id THEN COALESCE(fx.home_score, 0)
        ELSE 0
      END), 0))::int AS h2h_gd,
      COALESCE(SUM(CASE
        WHEN fx.home_competition_team_id = bs.id THEN COALESCE(fx.home_score, 0)
        WHEN fx.away_competition_team_id = bs.id THEN COALESCE(fx.away_score, 0)
        ELSE 0
      END), 0)::int AS h2h_gf
    FROM base_standings bs
    JOIN base_standings bs2 ON bs2.pts = bs.pts AND bs2.id <> bs.id AND bs2.group_label = bs.group_label
    JOIN public.fixtures fx ON fx.status = 'completed'
      AND fx.home_score IS NOT NULL AND fx.away_score IS NOT NULL
      AND fx.competition_id = p_competition_id
      AND fx.group_label IS NOT NULL
      AND (
        (fx.home_competition_team_id = bs.id AND fx.away_competition_team_id = bs2.id)
        OR (fx.away_competition_team_id = bs.id AND fx.home_competition_team_id = bs2.id)
      )
    GROUP BY bs.id
  ),
  ranked AS (
    SELECT
      bs.id,
      ROW_NUMBER() OVER (
        PARTITION BY bs.group_label
        ORDER BY bs.pts DESC,
                 COALESCE(h.h2h_pts, 0) DESC,
                 COALESCE(h.h2h_gd, 0) DESC,
                 COALESCE(h.h2h_gf, 0) DESC,
                 bs.gd DESC, bs.gf DESC, bs.team_name ASC
      ) AS group_rank
    FROM base_standings bs
    LEFT JOIN h2h h ON h.team_id = bs.id
  )
  UPDATE public.competition_teams ct
  SET group_rank = r.group_rank
  FROM ranked r
  WHERE ct.id = r.id;

  -- ── collect qualifiers: rank-1 per group (sorted by group), then rank-2 ───
  SELECT ARRAY(
    SELECT id FROM public.competition_teams
    WHERE competition_id = p_competition_id
      AND status = 'active'
      AND group_label IS NOT NULL
      AND group_rank IN (1, 2)
    ORDER BY group_rank, group_label
  ) INTO v_qualifiers;

  v_n := COALESCE(array_length(v_qualifiers, 1), 0);

  IF v_n < 2 OR (v_n & (v_n - 1)) <> 0 THEN
    RAISE EXCEPTION 'bracket_size_not_supported' USING ERRCODE = 'P0001',
      DETAIL = v_n::text || ' qualifiers — must be a power of 2';
  END IF;

  v_num_rounds := CAST(round(log(2, v_n)) AS int);

  -- ── get max group-stage week number ───────────────────────────────────────
  SELECT COALESCE(MAX(week_number), 0) INTO v_max_week
  FROM public.fixtures
  WHERE competition_id = p_competition_id AND group_label IS NOT NULL;

  -- ── create round-1 fixtures (teams populated, status=scheduled) ───────────
  -- Pairing: v_qualifiers[i] (home) vs v_qualifiers[v_n-i+1] (away), i=1..v_n/2
  v_round_num := 1;
  FOR i IN 1..(v_n / 2) LOOP
    INSERT INTO public.fixtures (
      competition_id,
      home_competition_team_id,
      away_competition_team_id,
      week_number,
      round_name,
      status
    ) VALUES (
      p_competition_id,
      v_qualifiers[i],
      v_qualifiers[v_n - i + 1],
      v_max_week + v_round_num,
      v_rnames[LEAST(v_num_rounds - v_round_num + 1, array_length(v_rnames, 1))],
      'scheduled'
    ) RETURNING id INTO v_fx_id;
    v_current_batch := v_current_batch || v_fx_id;
  END LOOP;

  -- ── create subsequent rounds (TBD teams, feeder IDs, status=allocated) ────
  v_round_num := 2;
  WHILE array_length(v_current_batch, 1) > 1 LOOP
    v_batch_size := array_length(v_current_batch, 1) / 2;
    v_next_batch := '{}';
    FOR j IN 1..v_batch_size LOOP
      INSERT INTO public.fixtures (
        competition_id,
        home_competition_team_id,
        away_competition_team_id,
        knockout_home_feeder_id,
        knockout_away_feeder_id,
        week_number,
        round_name,
        status
      ) VALUES (
        p_competition_id,
        NULL,
        NULL,
        v_current_batch[2 * j - 1],
        v_current_batch[2 * j],
        v_max_week + v_round_num,
        v_rnames[LEAST(v_num_rounds - v_round_num + 1, array_length(v_rnames, 1))],
        'allocated'
      ) RETURNING id INTO v_fx_id;
      v_next_batch := v_next_batch || v_fx_id;
    END LOOP;
    v_current_batch := v_next_batch;
    v_round_num := v_round_num + 1;
  END LOOP;

  -- ── mark competition as knockout seeded ───────────────────────────────────
  UPDATE public.competitions
  SET config = config || '{"knockout_seeded": true}'::jsonb
  WHERE id = p_competition_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_knockout_seeded', 'competition', p_competition_id::text,
    jsonb_build_object(
      'tournament_event_id', p_tournament_event_id,
      'total_qualifiers',   v_n,
      'knockout_rounds',    v_num_rounds
    )
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'total_qualifiers', v_n,
    'knockout_rounds',  v_num_rounds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.club_admin_seed_knockout(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_admin_seed_knockout(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_admin_seed_knockout(uuid, uuid) TO authenticated;

-- ─── 4. ref_confirm_tournament_match (REPLACE) ───────────────────────────────
-- Added: after marking completed, call _advance_tournament_winner for knockout
-- fixtures (group_label IS NULL). Group-stage fixtures: no change.

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

  -- Advance bracket for knockout fixtures (no group_label = knockout round)
  IF v_fixture.group_label IS NULL THEN
    PERFORM public._advance_tournament_winner(v_fixture.id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'home_score', v_home, 'away_score', v_away, 'status', 'completed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_confirm_tournament_match(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_confirm_tournament_match(text)
  TO anon, authenticated;

-- ─── 5. club_admin_get_standings (REPLACE) ───────────────────────────────────
-- Changes:
--   a. Standings computation now filters AND fx.group_label IS NOT NULL
--      so knockout fixtures don't contaminate group-stage tables.
--   b. Each standings row now includes group_label.
--   c. Top-level return now includes knockout_seeded flag.

CREATE OR REPLACE FUNCTION public.club_admin_get_standings(
  p_tournament_event_id uuid,
  p_competition_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid             uuid := auth.uid();
  v_profile_id      uuid;
  v_club_id         text;
  v_knockout_seeded boolean;
  v_result          jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles
  WHERE auth_user_id = v_uid LIMIT 1;

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

  SELECT COALESCE((config->>'knockout_seeded')::boolean, false)
    INTO v_knockout_seeded
    FROM public.competitions WHERE id = p_competition_id;

  WITH base_standings AS (
    SELECT
      ct.id,
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
    FROM public.competition_teams ct
    LEFT JOIN public.fixtures fx
      ON (fx.home_competition_team_id = ct.id OR fx.away_competition_team_id = ct.id)
      AND fx.competition_id = p_competition_id
      AND fx.status = 'completed'
      AND fx.home_score IS NOT NULL
      AND fx.away_score IS NOT NULL
      AND fx.group_label IS NOT NULL    -- group-stage fixtures only
    WHERE ct.competition_id = p_competition_id
      AND ct.status = 'active'
    GROUP BY ct.id, ct.team_name, ct.group_label, ct.group_rank
  ),
  h2h AS (
    SELECT
      bs.id AS team_id,
      COALESCE(SUM(CASE
        WHEN fx.home_competition_team_id = bs.id AND fx.home_score > fx.away_score THEN 3
        WHEN fx.home_competition_team_id = bs.id AND fx.home_score = fx.away_score THEN 1
        WHEN fx.away_competition_team_id = bs.id AND fx.away_score > fx.home_score THEN 3
        WHEN fx.away_competition_team_id = bs.id AND fx.away_score = fx.home_score THEN 1
        ELSE 0
      END), 0)::int AS h2h_pts,
      (COALESCE(SUM(CASE
        WHEN fx.home_competition_team_id = bs.id THEN COALESCE(fx.home_score, 0)
        WHEN fx.away_competition_team_id = bs.id THEN COALESCE(fx.away_score, 0)
        ELSE 0
      END), 0) -
       COALESCE(SUM(CASE
        WHEN fx.home_competition_team_id = bs.id THEN COALESCE(fx.away_score, 0)
        WHEN fx.away_competition_team_id = bs.id THEN COALESCE(fx.home_score, 0)
        ELSE 0
      END), 0))::int AS h2h_gd,
      COALESCE(SUM(CASE
        WHEN fx.home_competition_team_id = bs.id THEN COALESCE(fx.home_score, 0)
        WHEN fx.away_competition_team_id = bs.id THEN COALESCE(fx.away_score, 0)
        ELSE 0
      END), 0)::int AS h2h_gf
    FROM base_standings bs
    JOIN base_standings bs2 ON bs2.pts = bs.pts AND bs2.id <> bs.id
    JOIN public.fixtures fx ON fx.status = 'completed'
      AND fx.home_score IS NOT NULL
      AND fx.away_score IS NOT NULL
      AND fx.competition_id = p_competition_id
      AND fx.group_label IS NOT NULL
      AND (
        (fx.home_competition_team_id = bs.id AND fx.away_competition_team_id = bs2.id)
        OR (fx.away_competition_team_id = bs.id AND fx.home_competition_team_id = bs2.id)
      )
    GROUP BY bs.id
  )
  SELECT jsonb_build_object(
    'ok',              true,
    'competition_id',  p_competition_id,
    'knockout_seeded', v_knockout_seeded,
    'standings', COALESCE(
      (SELECT jsonb_agg(row ORDER BY pts DESC, h2h_pts DESC, h2h_gd DESC, h2h_gf DESC, gd DESC, gf DESC, team_name ASC)
       FROM (
         SELECT
           bs.id::text  AS team_id,
           bs.team_name,
           bs.group_label,
           bs.group_rank,
           bs.played, bs.won, bs.drawn, bs.lost, bs.gf, bs.ga, bs.gd, bs.pts,
           COALESCE(h.h2h_pts, 0) AS h2h_pts,
           COALESCE(h.h2h_gd, 0)  AS h2h_gd,
           COALESCE(h.h2h_gf, 0)  AS h2h_gf
         FROM base_standings bs
         LEFT JOIN h2h h ON h.team_id = bs.id
       ) row),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.club_admin_get_standings(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_admin_get_standings(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_standings(uuid, uuid) TO authenticated;

-- ─── 6. club_admin_get_schedule (REPLACE) ────────────────────────────────────
-- Adds group_label to each fixture object (lets client separate group vs
-- knockout fixtures). Adds knockout_seeded flag per competition object.

CREATE OR REPLACE FUNCTION public.club_admin_get_schedule(
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_venue_id   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id, te.venue_id
    INTO v_club_id, v_venue_id
    FROM tournament_events te
   WHERE te.id = p_tournament_event_id
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

-- ─── 7. get_tournament_public (REPLACE) ───────────────────────────────────────
-- Changes:
--   a. standings computation adds AND fx.group_label IS NOT NULL filter
--   b. standings rows include group_label + group_rank
--   c. competition object includes knockout_seeded flag
--   d. knockout_fixtures[] added: fixtures with group_label IS NULL, with
--      TBD team names shown as null for the client to render as "TBD"

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
    -- knockout fixtures (group_label IS NULL), shown when knockout_seeded
    'knockout_fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fixture_id',       fx.id,
        'competition_id',   fx.competition_id,
        'competition_name', comp.name,
        'round',            fx.week_number,
        'round_name',       fx.round_name,
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
              AND fx.group_label IS NOT NULL    -- group-stage fixtures only
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

-- ─── 8. club_admin_get_tournament (REPLACE) ───────────────────────────────────
-- Adds group_label + group_rank to each team row.
-- Adds knockout_seeded flag per competition object.

CREATE OR REPLACE FUNCTION public.club_admin_get_tournament(
  p_slug text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_te         record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_te FROM tournament_events WHERE slug = p_slug LIMIT 1;
  IF v_te IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_te.club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'tournament_id',          v_te.id,
    'name',                   v_te.name,
    'slug',                   v_te.slug,
    'status',                 v_te.status,
    'event_date',             v_te.event_date,
    'event_end_date',         v_te.event_end_date,
    'entry_fee_pence',        v_te.entry_fee_pence,
    'entry_fee_payer',        v_te.entry_fee_payer,
    'host_team_entry_waived', v_te.host_team_entry_waived,
    'track_stats',            v_te.track_stats,
    'registration_deadline',  v_te.registration_deadline,
    'schedule_config',        v_te.schedule_config,
    'branding',               v_te.branding,
    'points_config',          v_te.points_config,
    'venue_id',               v_te.venue_id,
    'club_id',                v_te.club_id,
    'created_at',             v_te.created_at,
    'performance_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_id',             pe.id,
        'name',                 pe.name,
        'sport',                pe.sport,
        'measurement_type',     pe.measurement_type,
        'unit',                 pe.unit,
        'has_heats',            pe.has_heats,
        'heats_count',          pe.heats_count,
        'attempts_per_athlete', pe.attempts_per_athlete,
        'category',             pe.category,
        'scheduled_time',       pe.scheduled_time,
        'display_order',        pe.display_order
      ) ORDER BY pe.display_order NULLS LAST, pe.scheduled_time NULLS LAST)
      FROM performance_events pe
      WHERE pe.tournament_event_id = v_te.id
    ), '[]'::jsonb),
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
            'team_id',             ct.team_id,
            'status',              ct.status,
            'group_label',         ct.group_label,
            'group_rank',          ct.group_rank,
            'registered_at',       ct.registered_at,
            'rejection_reason',    ct.rejection_reason,
            'waitlist_position',   ct.waitlist_position
          ) ORDER BY ct.registered_at)
          FROM competition_teams ct
          LEFT JOIN teams t ON t.id = ct.team_id
          WHERE ct.competition_id = comp.id
            AND ct.status IN ('active','pending','rejected')
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_get_tournament(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_tournament(text) TO authenticated;
