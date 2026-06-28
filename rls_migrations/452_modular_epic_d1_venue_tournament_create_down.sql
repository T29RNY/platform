-- 452_modular_epic_d1_venue_tournament_create_down.sql
-- Inverse of 452. Drops the venue-token tournament siblings + helper, reverts the
-- caps CHECK + club_id nullability, and restores the four CREATE-OR-REPLACE'd
-- functions to their pre-452 bodies.
--
-- NOTE: re-adding club_id NOT NULL fails if any venue-owned tournament (club NULL)
-- exists. Remove/re-home those rows before running this down.

BEGIN;

-- 1. Drop venue read + write siblings + helper
DROP FUNCTION IF EXISTS public.venue_get_tournament_standings(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.venue_get_schedule(text, uuid);
DROP FUNCTION IF EXISTS public.venue_get_tournament(text, text);
DROP FUNCTION IF EXISTS public.venue_update_tournament_status(text, text, text);
DROP FUNCTION IF EXISTS public.venue_seed_double_elimination(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.venue_seed_knockout(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.venue_assign_fixture_slot(text, uuid, date, time, uuid, integer);
DROP FUNCTION IF EXISTS public.venue_generate_schedule(text, uuid, uuid, integer, time, date, uuid[]);
DROP FUNCTION IF EXISTS public.venue_reject_team(text, uuid, text);
DROP FUNCTION IF EXISTS public.venue_approve_team(text, uuid);
DROP FUNCTION IF EXISTS public.venue_send_team_invite(text, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.venue_register_team(text, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.venue_add_competition(text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.venue_create_tournament(text, text, text, date, date, integer, text, timestamptz, text);
DROP FUNCTION IF EXISTS public._authorise_venue_tournament(text, uuid);

-- 2. Revert caps CHECK to the 6-cap list (pre-452)
ALTER TABLE public.venue_admins DROP CONSTRAINT venue_admins_caps_known;
ALTER TABLE public.venue_admins ADD CONSTRAINT venue_admins_caps_known CHECK (
  caps_grant <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships']::text[]
  AND caps_deny <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships']::text[]
);

-- 3. Restore club_id NOT NULL
ALTER TABLE public.tournament_events ALTER COLUMN club_id SET NOT NULL;

-- 4. Restore get_tournament_public to its INNER JOIN clubs form
CREATE OR REPLACE FUNCTION public.get_tournament_public(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_te            record;
  v_points_config jsonb;
BEGIN
  SELECT te.*, v.name AS venue_name,
         v.address AS venue_address, v.city AS venue_city, v.postcode AS venue_postcode,
         v.lat AS venue_lat, v.lng AS venue_lng,
         v.contact_email AS venue_contact_email, v.contact_phone AS venue_contact_phone,
         c.name AS club_name
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

  v_points_config := v_te.points_config;

  RETURN jsonb_build_object(
    'ok',                        true,
    'name',                      v_te.name,
    'slug',                      v_te.slug,
    'status',                    v_te.status,
    'event_date',                v_te.event_date,
    'event_end_date',            v_te.event_end_date,
    'venue_name',                v_te.venue_name,
    'venue_address',             v_te.venue_address,
    'venue_city',                v_te.venue_city,
    'venue_postcode',            v_te.venue_postcode,
    'venue_lat',                 v_te.venue_lat,
    'venue_lng',                 v_te.venue_lng,
    'venue_contact_email',       v_te.venue_contact_email,
    'venue_contact_phone',       v_te.venue_contact_phone,
    'club_name',                 v_te.club_name,
    'entry_fee_pence',           v_te.entry_fee_pence,
    'entry_fee_payer',           v_te.entry_fee_payer,
    'registration_deadline',     v_te.registration_deadline,
    'registration_open',         (v_te.status = 'open'
                                   AND (v_te.registration_deadline IS NULL
                                        OR now() < v_te.registration_deadline)),
    'info',                      v_te.info,
    'branding',                  v_te.branding,
    'player_of_tournament_name', v_te.player_of_tournament_name,
    'player_of_tournament_team', v_te.player_of_tournament_team,
    'sponsors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sponsor_id',  ts.id, 'name', ts.name, 'logo_url', ts.logo_url, 'website_url', ts.website_url
      ) ORDER BY ts.display_order, ts.name)
      FROM tournament_sponsors ts
      WHERE ts.tournament_event_id = v_te.id AND ts.active = true
    ), '[]'::jsonb),
    'competitions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id', comp.id, 'name', comp.name, 'type', comp.type, 'format', comp.format, 'status', comp.status,
        'teams', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'competition_team_id', ct.id, 'team_name', COALESCE(ct.team_name, t.name), 'registered_at', ct.registered_at
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
        'fixture_id', fx.id, 'competition_id', fx.competition_id, 'competition_name', comp.name,
        'round', fx.week_number, 'round_name', fx.round_name, 'scheduled_date', fx.scheduled_date,
        'kickoff_time', CASE WHEN fx.kickoff_time IS NOT NULL THEN to_char(fx.kickoff_time, 'HH24:MI') ELSE NULL END,
        'pitch_name', pa.name, 'referee_name', mo.name,
        'home_team_name', ht.team_name, 'away_team_name', at2.team_name,
        'home_score', fx.home_score, 'away_score', fx.away_score,
        'status', fx.status, 'current_period', fx.current_period, 'de_bracket', fx.de_bracket
      ) ORDER BY fx.scheduled_date NULLS LAST, fx.kickoff_time NULLS LAST, fx.week_number, fx.id)
      FROM fixtures fx
      JOIN competitions comp    ON comp.id = fx.competition_id
      LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
      LEFT JOIN competition_teams at2 ON at2.id = fx.away_competition_team_id
      LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
      LEFT JOIN match_officials mo    ON mo.id  = fx.official_id
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    'knockout_fixtures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fixture_id', fx.id, 'competition_id', fx.competition_id, 'competition_name', comp.name,
        'round', fx.week_number, 'round_name', fx.round_name, 'scheduled_date', fx.scheduled_date,
        'kickoff_time', CASE WHEN fx.kickoff_time IS NOT NULL THEN to_char(fx.kickoff_time, 'HH24:MI') ELSE NULL END,
        'pitch_name', pa.name, 'referee_name', mo.name,
        'home_team_name', COALESCE(ht.team_name, hf_home.team_name, hf_away.team_name),
        'away_team_name', COALESCE(at2.team_name, af_home.team_name, af_away.team_name),
        'home_score', fx.home_score, 'away_score', fx.away_score,
        'status', fx.status, 'current_period', fx.current_period, 'de_bracket', fx.de_bracket
      ) ORDER BY fx.week_number NULLS LAST, fx.id)
      FROM fixtures fx
      JOIN competitions comp         ON comp.id = fx.competition_id
      LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
      LEFT JOIN competition_teams at2 ON at2.id = fx.away_competition_team_id
      LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
      LEFT JOIN match_officials mo    ON mo.id  = fx.official_id
      LEFT JOIN fixtures hf           ON hf.id  = fx.knockout_home_feeder_id
      LEFT JOIN competition_teams hf_home ON hf_home.id = hf.home_competition_team_id
      LEFT JOIN competition_teams hf_away ON hf_away.id = hf.away_competition_team_id
      LEFT JOIN fixtures af           ON af.id  = fx.knockout_away_feeder_id
      LEFT JOIN competition_teams af_home ON af_home.id = af.home_competition_team_id
      LEFT JOIN competition_teams af_away ON af_away.id = af.away_competition_team_id
      WHERE comp.tournament_event_id = v_te.id
        AND (fx.knockout_home_feeder_id IS NOT NULL OR fx.knockout_away_feeder_id IS NOT NULL
             OR fx.de_bracket IS NOT NULL)
    ), '[]'::jsonb),
    'standings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id', comp.id, 'competition_name', comp.name,
        'knockout_seeded', (comp.config->>'knockout_seeded')::boolean,
        'rows', COALESCE((
          SELECT jsonb_agg(row ORDER BY pts DESC, gd DESC, gf DESC, team_name ASC)
          FROM (
            SELECT ct.id::text AS team_id, ct.team_name, ct.group_label, ct.group_rank,
              COUNT(fx.id)::int AS played,
              COUNT(CASE WHEN fx.home_competition_team_id = ct.id AND fx.home_score > fx.away_score THEN 1
                         WHEN fx.away_competition_team_id = ct.id AND fx.away_score > fx.home_score THEN 1 END)::int AS won,
              COUNT(CASE WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1 END)::int AS drawn,
              COUNT(CASE WHEN fx.home_competition_team_id = ct.id AND fx.home_score < fx.away_score THEN 1
                         WHEN fx.away_competition_team_id = ct.id AND fx.away_score < fx.home_score THEN 1 END)::int AS lost,
              COALESCE(SUM(CASE WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.home_score,0)
                                WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.away_score,0) END),0)::int AS gf,
              COALESCE(SUM(CASE WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.away_score,0)
                                WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.home_score,0) END),0)::int AS ga,
              (COALESCE(SUM(CASE WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.home_score,0)
                                 WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.away_score,0) END),0) -
               COALESCE(SUM(CASE WHEN fx.home_competition_team_id = ct.id THEN COALESCE(fx.away_score,0)
                                 WHEN fx.away_competition_team_id = ct.id THEN COALESCE(fx.home_score,0) END),0))::int AS gd,
              (COUNT(CASE WHEN fx.home_competition_team_id = ct.id AND fx.home_score > fx.away_score THEN 1
                          WHEN fx.away_competition_team_id = ct.id AND fx.away_score > fx.home_score THEN 1 END) * 3 +
               COUNT(CASE WHEN fx.id IS NOT NULL AND fx.home_score = fx.away_score THEN 1 END))::int AS pts
            FROM competition_teams ct
            LEFT JOIN fixtures fx
              ON (fx.home_competition_team_id = ct.id OR fx.away_competition_team_id = ct.id)
              AND fx.competition_id = comp.id AND fx.status = 'completed'
              AND fx.home_score IS NOT NULL AND fx.away_score IS NOT NULL
              AND fx.knockout_home_feeder_id IS NULL AND fx.knockout_away_feeder_id IS NULL AND fx.de_bracket IS NULL
            WHERE ct.competition_id = comp.id AND ct.status = 'active'
            GROUP BY ct.id, ct.team_name, ct.group_label, ct.group_rank
          ) row
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    'performance_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_id', pe.id, 'name', pe.name, 'measurement_type', pe.measurement_type, 'unit', pe.unit,
        'category', pe.category, 'scheduled_time', pe.scheduled_time, 'display_order', pe.display_order,
        'results', COALESCE((
          WITH best AS (
            SELECT pr.athlete_name, pr.competition_team_id, ct.team_name,
              CASE WHEN pe.measurement_type = 'time_asc' THEN MIN(CASE WHEN pr.status='recorded' THEN pr.value END)
                   ELSE MAX(CASE WHEN pr.status='recorded' THEN pr.value END) END AS best_value
            FROM performance_results pr JOIN competition_teams ct ON ct.id = pr.competition_team_id
            WHERE pr.performance_event_id = pe.id AND pr.status='recorded'
            GROUP BY pr.athlete_name, pr.competition_team_id, ct.team_name
          ),
          ranked AS (
            SELECT *, CASE WHEN pe.measurement_type='time_asc' THEN RANK() OVER (ORDER BY best_value ASC)
                   ELSE RANK() OVER (ORDER BY best_value DESC) END AS finish_rank
            FROM best WHERE best_value IS NOT NULL
          )
          SELECT jsonb_agg(jsonb_build_object('athlete_name', r.athlete_name, 'team_name', r.team_name,
            'value', r.best_value, 'rank', r.finish_rank) ORDER BY r.finish_rank, r.athlete_name)
          FROM ranked r
        ), '[]'::jsonb)
      ) ORDER BY COALESCE(pe.display_order, 9999), pe.scheduled_time NULLS LAST, pe.name)
      FROM performance_events pe
      WHERE pe.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    'performance_standings', COALESCE((
      WITH event_results AS (
        SELECT pe.id AS event_id, pe.measurement_type, pr.competition_team_id, pr.athlete_name,
          CASE WHEN pe.measurement_type='time_asc' THEN MIN(CASE WHEN pr.status='recorded' THEN pr.value END)
               ELSE MAX(CASE WHEN pr.status='recorded' THEN pr.value END) END AS best_value
        FROM performance_events pe JOIN performance_results pr ON pr.performance_event_id = pe.id
        WHERE pe.tournament_event_id = v_te.id AND pr.status='recorded'
        GROUP BY pe.id, pe.measurement_type, pr.competition_team_id, pr.athlete_name
      ),
      ranked_results AS (
        SELECT er.*, CASE WHEN er.measurement_type='time_asc' THEN RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value ASC)
               ELSE RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value DESC) END AS finish_rank
        FROM event_results er WHERE er.best_value IS NOT NULL
      ),
      team_points AS (
        SELECT rr.competition_team_id, ct.team_name,
          SUM(COALESCE((v_points_config->>(rr.finish_rank::text))::int, 0)) AS total_points,
          COUNT(CASE WHEN rr.finish_rank=1 THEN 1 END)::int AS gold,
          COUNT(CASE WHEN rr.finish_rank=2 THEN 1 END)::int AS silver,
          COUNT(CASE WHEN rr.finish_rank=3 THEN 1 END)::int AS bronze,
          COUNT(DISTINCT rr.event_id)::int AS events_entered
        FROM ranked_results rr JOIN competition_teams ct ON ct.id = rr.competition_team_id
        GROUP BY rr.competition_team_id, ct.team_name
      )
      SELECT jsonb_agg(jsonb_build_object('competition_team_id', tp.competition_team_id, 'team_name', tp.team_name,
        'points', tp.total_points, 'gold', tp.gold, 'silver', tp.silver, 'bronze', tp.bronze, 'events_entered', tp.events_entered
      ) ORDER BY tp.total_points DESC, tp.gold DESC, tp.silver DESC, tp.bronze DESC, tp.team_name ASC)
      FROM team_points tp
    ), '[]'::jsonb)
  );
END;
$function$;

-- 5. Restore the three public writers to their club_id-only audit form
CREATE OR REPLACE FUNCTION public.tournament_register_team(p_slug text, p_competition_id uuid, p_team_name text, p_contact_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_te        record;
  v_comp      record;
  v_team_name text := NULLIF(btrim(p_team_name), '');
  v_email     text := NULLIF(btrim(p_contact_email), '');
  v_ct_id     uuid;
BEGIN
  IF v_team_name IS NULL THEN
    RAISE EXCEPTION 'team_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_team_name) > 60 THEN
    RAISE EXCEPTION 'team_name_too_long' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.id, te.club_id, te.name, te.status, te.registration_deadline
    INTO v_te
    FROM tournament_events te
   WHERE te.slug = p_slug
   LIMIT 1;
  IF v_te IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_te.club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_te.status <> 'open'
     OR (v_te.registration_deadline IS NOT NULL AND now() >= v_te.registration_deadline) THEN
    RAISE EXCEPTION 'registration_closed' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.id, c.name
    INTO v_comp
    FROM competitions c
   WHERE c.id = p_competition_id AND c.tournament_event_id = v_te.id
   LIMIT 1;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM competition_teams ct
     WHERE ct.competition_id = p_competition_id
       AND lower(btrim(ct.team_name)) = lower(v_team_name)
       AND ct.status IN ('active', 'pending')
  ) THEN
    RAISE EXCEPTION 'team_name_taken' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competition_teams (competition_id, team_name, status)
  VALUES (p_competition_id, v_team_name, 'pending')
  RETURNING id INTO v_ct_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_te.club_id, auth.uid(), 'system', COALESCE(v_email, 'public'),
    'tournament_team_registered', 'competition_team', v_ct_id::text,
    jsonb_build_object('slug', p_slug, 'team_name', v_team_name,
      'competition_id', p_competition_id, 'contact_email', v_email)
  );

  RETURN jsonb_build_object(
    'ok',                  true,
    'competition_team_id', v_ct_id,
    'status',              'pending',
    'tournament_name',     v_te.name,
    'competition_name',    v_comp.name
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tournament_join_via_invite(p_code text, p_team_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid                 uuid := auth.uid();
  v_invite              record;
  v_tournament          record;
  v_team_name           text := NULLIF(btrim(p_team_name), '');
  v_competition_team_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF v_team_name IS NULL THEN
    RAISE EXCEPTION 'team_name_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT ti.id, ti.tournament_event_id, ti.competition_id, ti.status, ti.expires_at,
         c.name AS competition_name
    INTO v_invite
    FROM tournament_invitations ti
    JOIN competitions c ON c.id = ti.competition_id
   WHERE ti.code = p_code
   LIMIT 1;

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_invite.status <> 'sent' THEN
    RAISE EXCEPTION 'invite_already_used' USING ERRCODE = 'P0001';
  END IF;

  IF v_invite.expires_at < now() THEN
    UPDATE tournament_invitations SET status = 'expired' WHERE code = p_code;
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.name AS tournament_name, te.club_id
    INTO v_tournament
    FROM tournament_events te
   WHERE te.id = v_invite.tournament_event_id
   LIMIT 1;

  INSERT INTO competition_teams (competition_id, team_name, status)
  VALUES (v_invite.competition_id, v_team_name, 'pending')
  RETURNING id INTO v_competition_team_id;

  UPDATE tournament_invitations SET status = 'accepted' WHERE code = p_code;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_tournament.club_id, v_uid, 'player', v_uid::text,
    'tournament_team_joined', 'competition_team', v_competition_team_id::text,
    jsonb_build_object(
      'code', p_code, 'team_name', v_team_name,
      'tournament_event_id', v_invite.tournament_event_id,
      'competition_id', v_invite.competition_id
    )
  );

  RETURN jsonb_build_object(
    'ok',                 true,
    'competition_team_id', v_competition_team_id,
    'tournament_name',    v_tournament.tournament_name,
    'competition_name',   v_invite.competition_name
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tournament_set_team_follow(p_competition_team_id uuid, p_follow boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_club_id text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id INTO v_club_id
  FROM competition_teams ct
  JOIN competitions c ON c.id = ct.competition_id
  JOIN tournament_events te ON te.id = c.tournament_event_id
  WHERE ct.id = p_competition_team_id;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_follow THEN
    INSERT INTO tournament_follows (user_id, competition_team_id)
    VALUES (v_uid, p_competition_team_id)
    ON CONFLICT (user_id, competition_team_id) DO NOTHING;
  ELSE
    DELETE FROM tournament_follows
    WHERE user_id = v_uid AND competition_team_id = p_competition_team_id;
  END IF;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'system', NULL,
    'tournament_team_follow_set', 'competition_team', p_competition_team_id::text,
    jsonb_build_object('follow', p_follow)
  );

  RETURN jsonb_build_object('ok', true, 'following', p_follow);
END;
$function$;

COMMIT;
