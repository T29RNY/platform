-- 500_venue_seed_knockout_config_qualifiers.sql
--
-- Standalone Tournament Self-Serve epic — "Groups, then knockout" format, PR #1.
--
-- Make venue_seed_knockout (mig 452:1020) qualifier-count CONFIGURABLE instead of the
-- hardcoded top-2. It now reads competitions.config.qualifiers_per_group and takes the top
-- `qpg` of each group (group_rank <= qpg) rather than the fixed `group_rank IN (1,2)`.
--
-- WHY: the self-serve "Groups, then knockout" flow lets the organiser choose how many teams
-- advance from each group (top-1 → a smaller, no-show-robust bracket such as "2 groups of 3,
-- winner of each into a final"; top-2 → the classic). self_serve_seed_group_stage (mig 498)
-- records that choice in config.qualifiers_per_group; this reads it back at KO-seed time.
--
-- BACKWARD COMPATIBLE — the paid venue-operator tournament flow (Epic D) does NOT set
-- config.qualifiers_per_group, so COALESCE(..., 2) makes it default to top-2: byte-for-byte
-- the same qualifier set and bracket the mig-452 version produced. No behaviour change for
-- any existing tournament; this only adds the top-1 option for group_stage competitions that
-- explicitly record qualifiers_per_group.
--
-- Signature UNCHANGED (text, uuid, uuid) → CREATE OR REPLACE, no overload. The only body
-- edits vs mig 452 are: (1) a v_qpg read from v_config, (2) `group_rank <= v_qpg` in place of
-- `group_rank IN (1, 2)`, (3) qualifiers_per_group added to the audit metadata. The
-- power-of-2 qualifier check, cross-seed pairing, feeder wiring and gate are all untouched.

CREATE OR REPLACE FUNCTION public.venue_seed_knockout(p_venue_token text, p_tournament_event_id uuid, p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth            record;
  v_config          jsonb;
  v_qpg             int;
  v_num_groups      int;
  v_n               int;
  v_num_rounds      int;
  v_max_week        int;
  v_qualifiers      uuid[];
  v_current_batch   uuid[] := '{}';
  v_next_batch      uuid[] := '{}';
  v_fx_id           uuid;
  i                 int;
  j                 int;
  v_round_num       int;
  v_batch_size      int;
  v_rnames          text[] := ARRAY['Final','Semi-Finals','Quarter-Finals','Round of 16'];
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT config INTO v_config FROM public.competitions WHERE id = p_competition_id;
  IF COALESCE((v_config->>'knockout_seeded')::boolean, false) THEN
    RAISE EXCEPTION 'knockout_already_seeded' USING ERRCODE = 'P0001';
  END IF;

  -- How many teams advance from each group. Self-serve group_stage records this; the paid
  -- flow does not → default 2 (identical to the pre-mig-500 hardcoded top-2).
  v_qpg := COALESCE((v_config->>'qualifiers_per_group')::int, 2);

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

  -- Qualifiers = top `v_qpg` of each group (was hardcoded IN (1,2) pre-mig-500).
  SELECT ARRAY(
    SELECT id FROM public.competition_teams
    WHERE competition_id = p_competition_id
      AND status = 'active'
      AND group_label IS NOT NULL
      AND group_rank <= v_qpg
    ORDER BY group_rank, group_label
  ) INTO v_qualifiers;

  v_n := COALESCE(array_length(v_qualifiers, 1), 0);

  IF v_n < 2 OR (v_n & (v_n - 1)) <> 0 THEN
    RAISE EXCEPTION 'bracket_size_not_supported' USING ERRCODE = 'P0001',
      DETAIL = v_n::text || ' qualifiers — must be a power of 2';
  END IF;

  v_num_rounds := CAST(round(log(2, v_n)) AS int);

  SELECT COALESCE(MAX(week_number), 0) INTO v_max_week
  FROM public.fixtures
  WHERE competition_id = p_competition_id AND group_label IS NOT NULL;

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

  UPDATE public.competitions
  SET config = config || '{"knockout_seeded": true}'::jsonb
  WHERE id = p_competition_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_knockout_seeded', 'competition', p_competition_id::text,
    jsonb_build_object(
      'tournament_event_id',  p_tournament_event_id,
      'total_qualifiers',     v_n,
      'qualifiers_per_group', v_qpg,
      'knockout_rounds',      v_num_rounds
    )
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'total_qualifiers', v_n,
    'knockout_rounds',  v_num_rounds
  );
END;
$function$;

-- Grants unchanged from mig 452 (anon + authenticated — this is the shared venue-operator
-- surface; self-serve calls it authenticated). Re-assert for completeness.
REVOKE ALL ON FUNCTION public.venue_seed_knockout(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_seed_knockout(text, uuid, uuid) TO anon, authenticated;
