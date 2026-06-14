-- Down: 322_phase7a_h2h_tiebreaker
-- Restores club_admin_get_standings to mig 320 body (no H2H)
-- and get_tournament_public to mig 321 body (no H2H).

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
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_events te
    JOIN public.club_admins ca ON ca.club_id = te.club_id
    WHERE te.id = p_tournament_event_id AND ca.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
    'ok',             true,
    'competition_id', p_competition_id,
    'standings',      COALESCE((
      SELECT jsonb_agg(row ORDER BY pts DESC, gd DESC, gf DESC, team_name ASC)
      FROM (
        SELECT
          ct.id::text                                                               AS team_id,
          ct.team_name,
          COUNT(fx.id)::int                                                         AS played,
          COUNT(CASE
            WHEN fx.home_competition_team_id = ct.id AND fx.home_score > fx.away_score THEN 1
            WHEN fx.away_competition_team_id = ct.id AND fx.away_score > fx.home_score THEN 1
          END)::int                                                                 AS won,
          COUNT(CASE
            WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1
          END)::int                                                                 AS drawn,
          COUNT(CASE
            WHEN fx.home_competition_team_id = ct.id AND fx.home_score < fx.away_score THEN 1
            WHEN fx.away_competition_team_id = ct.id AND fx.away_score < fx.home_score THEN 1
          END)::int                                                                 AS lost,
          COALESCE(SUM(CASE
            WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
            WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
          END), 0)::int                                                             AS gf,
          COALESCE(SUM(CASE
            WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
            WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
          END), 0)::int                                                             AS ga,
          (COALESCE(SUM(CASE
            WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
            WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
          END), 0) -
           COALESCE(SUM(CASE
            WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.away_score, 0)
            WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.home_score, 0)
          END), 0))::int                                                            AS gd,
          (COUNT(CASE
            WHEN fx.home_competition_team_id = ct.id AND fx.home_score > fx.away_score THEN 1
            WHEN fx.away_competition_team_id = ct.id AND fx.away_score > fx.home_score THEN 1
          END) * 3 +
           COUNT(CASE
            WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1
          END))::int                                                                AS pts
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
      ) row
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.club_admin_get_standings(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_admin_get_standings(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_standings(uuid, uuid)
  TO authenticated;

-- Restore get_tournament_public to mig 321 body (no H2H in standings)
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
