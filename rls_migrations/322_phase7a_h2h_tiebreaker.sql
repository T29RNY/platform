-- Migration 322 — Event OS: Phase 7A H2H Tiebreaker
--
-- Adds head-to-head tiebreaking to both standings RPCs.
-- When two or more teams are level on points, the sort order becomes:
--   pts DESC → h2h_pts DESC → h2h_gd DESC → h2h_gf DESC → gd DESC → gf DESC → team_name ASC
--
-- h2h_* stats are computed only from fixtures between the tied teams themselves.
-- A team not tied with anyone gets h2h_pts=0, h2h_gd=0, h2h_gf=0 (no effect on its position).
--
-- Two CREATE OR REPLACE (no signature change):
--   1. club_admin_get_standings(uuid, uuid) — restructured to use CTEs
--   2. get_tournament_public(text)          — standings block uses CROSS JOIN LATERAL with CTEs

-- ─── 1. club_admin_get_standings ─────────────────────────────────────────────

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
  v_result jsonb;
BEGIN
  -- Ownership guard: caller must be a club_admin for this tournament's club.
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_events te
    JOIN public.club_admins ca ON ca.club_id = te.club_id
    WHERE te.id = p_tournament_event_id AND ca.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Competition must belong to this tournament.
  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- base_standings: standard P/W/D/L/GF/GA/GD/Pts from completed fixtures.
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
  -- h2h: for each team, aggregate H2H stats only from fixtures against teams
  -- that share the same pts total (the "tied group").
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
    -- only consider opponents that share the same pts total
    JOIN base_standings bs2 ON bs2.pts = bs.pts AND bs2.id <> bs.id
    -- only fixtures directly between bs and its tied opponent bs2
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
GRANT EXECUTE ON FUNCTION public.club_admin_get_standings(uuid, uuid)
  TO authenticated;

-- ─── 2. get_tournament_public ─────────────────────────────────────────────────
-- Identical to mig 321 except the 'standings' subquery is restructured:
-- each competition's standings now come from a CROSS JOIN LATERAL block that
-- uses the same base_standings + h2h CTE pattern as above.

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
    -- ── competitions with registered teams (unchanged from mig 318) ──────────
    'competitions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id', comp.id,
        'name',           comp.name,
        'type',           comp.type,
        'format',         comp.format,
        'status',         comp.status,
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
    -- ── fixtures: all fixtures across all competitions (unchanged from mig 321) ─
    'fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fixture_id',       fx.id,
        'competition_id',   fx.competition_id,
        'competition_name', comp.name,
        'round',            fx.week_number,
        'round_name',       fx.round_name,
        'scheduled_date',   fx.scheduled_date,
        'kickoff_time',     CASE
          WHEN fx.kickoff_time IS NOT NULL
          THEN to_char(fx.kickoff_time, 'HH24:MI')
          ELSE NULL
        END,
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
    ), '[]'::jsonb),
    -- ── standings: per competition with H2H tiebreaker ───────────────────────
    -- Uses CROSS JOIN LATERAL so the CTEs can reference comp.id as a lateral param.
    -- Sort order: pts → h2h_pts → h2h_gd → h2h_gf → gd → gf → team_name.
    'standings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id',   comp.id,
        'competition_name', comp.name,
        'rows', s.rows
      ) ORDER BY comp.name)
      FROM competitions comp
      CROSS JOIN LATERAL (
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
          FROM competition_teams ct
          LEFT JOIN fixtures fx
            ON (fx.home_competition_team_id = ct.id OR fx.away_competition_team_id = ct.id)
            AND fx.competition_id = comp.id
            AND fx.status = 'completed'
            AND fx.home_score IS NOT NULL
            AND fx.away_score IS NOT NULL
          WHERE ct.competition_id = comp.id
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
          JOIN fixtures fx ON fx.status = 'completed'
            AND fx.home_score IS NOT NULL
            AND fx.away_score IS NOT NULL
            AND fx.competition_id = comp.id
            AND (
              (fx.home_competition_team_id = bs.id AND fx.away_competition_team_id = bs2.id)
              OR
              (fx.away_competition_team_id = bs.id AND fx.home_competition_team_id = bs2.id)
            )
          GROUP BY bs.id
        )
        SELECT COALESCE(
          jsonb_agg(row ORDER BY pts DESC, h2h_pts DESC, h2h_gd DESC, h2h_gf DESC, gd DESC, gf DESC, team_name ASC),
          '[]'::jsonb
        ) AS rows
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
        ) row
      ) s
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_tournament_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_public(text) TO anon, authenticated;
