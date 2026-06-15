-- Migration 323 — Event OS: Phase 7B Card Tracking + Auto-Suspension
--
-- 1. CREATE TABLE tournament_cards
-- 2. ref_record_tournament_card  — ref records a card; auto-suspend on 2 yellows or any red
-- 3. get_tournament_suspension_list — director sees suspended players per competition
-- 4. ref_start_tournament_match REPLACE — adds suspensions[] to return (informational pre-match warning)
-- 5. club_admin_get_standings REPLACE — fixes pre-existing bug: club_admins table
--    doesn't exist; replace with club_team_managers guard (matches Phase 1-3 pattern)

-- ─── 1. tournament_cards ─────────────────────────────────────────────────────

CREATE TABLE public.tournament_cards (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id            uuid        NOT NULL REFERENCES public.fixtures(id),
  competition_id        uuid        NOT NULL REFERENCES public.competitions(id),
  competition_team_id   uuid        NOT NULL REFERENCES public.competition_teams(id),
  player_name           text        NOT NULL,
  card_type             text        NOT NULL CHECK (card_type IN ('yellow', 'red')),
  minute                integer     NOT NULL,
  period                text        NOT NULL,
  auto_suspended        boolean     NOT NULL DEFAULT false,
  recorded_by_ref_token text        NOT NULL,
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE public.tournament_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_cards FROM anon, authenticated;

-- ─── 2. ref_record_tournament_card ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_record_tournament_card(
  p_ref_token           text,
  p_competition_team_id uuid,
  p_player_name         text,
  p_card_type           text,
  p_minute              integer,
  p_period              text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_fixture        public.fixtures;
  v_player_name    text    := NULLIF(btrim(p_player_name), '');
  v_yellow_count   integer;
  v_auto_suspended boolean;
  v_card_id        uuid;
BEGIN
  IF v_player_name IS NULL THEN
    RAISE EXCEPTION 'player_name_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_card_type NOT IN ('yellow', 'red') THEN
    RAISE EXCEPTION 'invalid_card_type' USING ERRCODE = 'P0001', DETAIL = p_card_type;
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  IF p_competition_team_id NOT IN (
    v_fixture.home_competition_team_id,
    v_fixture.away_competition_team_id
  ) THEN
    RAISE EXCEPTION 'team_not_in_fixture' USING ERRCODE = 'P0001';
  END IF;

  -- Auto-suspension: red = always; yellow = suspended if already has one yellow this competition
  IF p_card_type = 'red' THEN
    v_auto_suspended := true;
  ELSE
    SELECT COUNT(*)::integer INTO v_yellow_count
    FROM public.tournament_cards
    WHERE competition_id      = v_fixture.competition_id
      AND competition_team_id = p_competition_team_id
      AND player_name         = v_player_name
      AND card_type           = 'yellow';

    v_auto_suspended := (v_yellow_count >= 1);
  END IF;

  INSERT INTO public.tournament_cards (
    fixture_id, competition_id, competition_team_id,
    player_name, card_type, minute, period,
    auto_suspended, recorded_by_ref_token
  ) VALUES (
    v_fixture.id, v_fixture.competition_id, p_competition_team_id,
    v_player_name, p_card_type, p_minute, p_period,
    v_auto_suspended, p_ref_token
  ) RETURNING id INTO v_card_id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_record_tournament_card',
    'tournament_card', v_card_id::text,
    jsonb_build_object(
      'competition_id',      v_fixture.competition_id,
      'competition_team_id', p_competition_team_id,
      'player_name',         v_player_name,
      'card_type',           p_card_type,
      'minute',              p_minute,
      'period',              p_period,
      'auto_suspended',      v_auto_suspended
    )
  );

  RETURN jsonb_build_object(
    'ok',           true,
    'card_id',      v_card_id,
    'is_suspended', v_auto_suspended,
    'player_name',  v_player_name,
    'card_type',    p_card_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ref_record_tournament_card(text, uuid, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_record_tournament_card(text, uuid, text, text, integer, text)
  TO anon, authenticated;

-- ─── 3. get_tournament_suspension_list ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tournament_suspension_list(
  p_tournament_event_id uuid,
  p_competition_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
BEGIN
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
      AND ct.club_id             = v_club_id
      AND ctm.is_active          = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = p_competition_id
      AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'suspensions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_team_id', tc.competition_team_id::text,
        'team_name',           ct.team_name,
        'player_name',         tc.player_name,
        'yellow_count',        COUNT(*) FILTER (WHERE tc.card_type = 'yellow')::int,
        'red_count',           COUNT(*) FILTER (WHERE tc.card_type = 'red')::int
      ) ORDER BY ct.team_name, tc.player_name)
      FROM public.tournament_cards tc
      JOIN public.competition_teams ct ON ct.id = tc.competition_team_id
      WHERE tc.competition_id = p_competition_id
        AND tc.auto_suspended  = true
      GROUP BY tc.competition_team_id, ct.team_name, tc.player_name
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tournament_suspension_list(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_tournament_suspension_list(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_suspension_list(uuid, uuid) TO authenticated;

-- ─── 4. ref_start_tournament_match REPLACE ───────────────────────────────────
-- Adds suspensions[] to return so PreMatch can display a pre-start warning.

CREATE OR REPLACE FUNCTION public.ref_start_tournament_match(
  p_ref_token       text,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_fixture     public.fixtures;
  v_suspensions jsonb;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status NOT IN ('scheduled', 'allocated') THEN
    RAISE EXCEPTION 'fixture_status_locks_start' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  UPDATE public.fixtures
     SET status            = 'in_progress',
         actual_kickoff_at = p_local_timestamp,
         current_period    = '1H'
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_start_tournament_match',
    'fixture', v_fixture.id::text,
    jsonb_build_object(
      'competition_id',    v_fixture.competition_id,
      'actual_kickoff_at', p_local_timestamp,
      'client_event_id',   p_client_event_id
    )
  );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'competition_team_id', sub.competition_team_id::text,
        'team_name',           sub.team_name,
        'player_name',         sub.player_name
      ) ORDER BY sub.team_name, sub.player_name
    ),
    '[]'::jsonb
  )
  INTO v_suspensions
  FROM (
    SELECT DISTINCT tc.competition_team_id, ct.team_name, tc.player_name
    FROM public.tournament_cards tc
    JOIN public.competition_teams ct ON ct.id = tc.competition_team_id
    WHERE tc.competition_id = v_fixture.competition_id
      AND tc.auto_suspended = true
      AND tc.competition_team_id IN (
        v_fixture.home_competition_team_id,
        v_fixture.away_competition_team_id
      )
  ) sub;

  RETURN jsonb_build_object(
    'ok',          true,
    'fixture_id',  v_fixture.id,
    'status',      'in_progress',
    'suspensions', v_suspensions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ref_start_tournament_match(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_start_tournament_match(text, uuid, timestamptz)
  TO anon, authenticated;

-- ─── 5. club_admin_get_standings REPLACE — fix club_admins bug ───────────────
-- club_admins table doesn't exist; replace join with club_team_managers.

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
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_result     jsonb;
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
      AND ct.club_id             = v_club_id
      AND ctm.is_active          = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  WITH base_standings AS (
    SELECT
      ct.id,
      ct.team_name,
      COUNT(fx.id)::int AS played,
      COUNT(CASE
        WHEN fx.home_competition_team_id = ct.id AND fx.home_score > fx.away_score THEN 1
        WHEN fx.away_competition_team_id = ct.id AND fx.away_score > fx.home_score THEN 1
      END)::int AS won,
      COUNT(CASE
        WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1
      END)::int AS drawn,
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
       COUNT(CASE
        WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1
      END))::int AS pts
    FROM public.competition_teams ct
    LEFT JOIN public.fixtures fx
      ON (fx.home_competition_team_id = ct.id OR fx.away_competition_team_id = ct.id)
      AND fx.competition_id = p_competition_id
      AND fx.status = 'completed'
      AND fx.home_score IS NOT NULL
      AND fx.away_score IS NOT NULL
    WHERE ct.competition_id = p_competition_id
      AND ct.status = 'active'
    GROUP BY ct.id, ct.team_name
  ),
  h2h AS (
    SELECT
      bs.id AS team_id,
      COALESCE(SUM(
        CASE
          WHEN fx.home_competition_team_id = bs.id AND fx.home_score > fx.away_score THEN 3
          WHEN fx.home_competition_team_id = bs.id AND fx.home_score = fx.away_score THEN 1
          WHEN fx.away_competition_team_id = bs.id AND fx.away_score > fx.home_score THEN 3
          WHEN fx.away_competition_team_id = bs.id AND fx.away_score = fx.home_score THEN 1
          ELSE 0
        END
      ), 0)::int AS h2h_pts,
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
      AND (
        (fx.home_competition_team_id = bs.id AND fx.away_competition_team_id = bs2.id)
        OR
        (fx.away_competition_team_id = bs.id AND fx.home_competition_team_id = bs2.id)
      )
    GROUP BY bs.id
  )
  SELECT jsonb_build_object(
    'ok',             true,
    'competition_id', p_competition_id,
    'standings', COALESCE(
      (SELECT jsonb_agg(row ORDER BY pts DESC, h2h_pts DESC, h2h_gd DESC, h2h_gf DESC, gd DESC, gf DESC, team_name ASC)
       FROM (
         SELECT
           bs.id::text AS team_id,
           bs.team_name,
           bs.played,
           bs.won,
           bs.drawn,
           bs.lost,
           bs.gf,
           bs.ga,
           bs.gd,
           bs.pts,
           COALESCE(h.h2h_pts, 0) AS h2h_pts,
           COALESCE(h.h2h_gd,  0) AS h2h_gd,
           COALESCE(h.h2h_gf,  0) AS h2h_gf
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
