-- 452_modular_epic_d1_venue_tournament_create.sql
-- Modular Platform — Epic D, build D1 (venue-operator tournament create).
-- Surfaces the already-built Event OS engine (migs 314–328) on venue-token auth.
--
-- Decisions locked s227 (DECISIONS.md SESSION 227):
--   A. A tournament can be owned by a CLUB or a VENUE — both. club_id goes NULLABLE
--      (venue_id stays NOT NULL). Venue-owned ⇒ club_id NULL. get_tournament_public
--      JOIN clubs → LEFT JOIN; audit rows tag the venue when club-less. Club path
--      byte-unchanged.
--   B. Ownership decides management. Club-owned → club managers (existing, untouched).
--      Venue-owned → venue operators (this file). No cross-edit.
--   C. Permission = BOTH gates. Reuse manage_facility AND add a new manage_tournaments
--      cap; either (or owner role) admits. Widen the venue_admins caps CHECK.
--
-- D1 = backend only (UI is D2). One shared SECDEF auth helper
-- _authorise_venue_tournament avoids ~15 drifting clones; each write keeps its own
-- audit_events row (HR#9). The "list" read reuses the existing list_venue_tournaments.
--
-- Next free migration after this = 453.

BEGIN;

-- ============================================================================
-- 1. club_id → NULLABLE (FK to clubs stays — a nullable FK is fine)
-- ============================================================================
ALTER TABLE public.tournament_events ALTER COLUMN club_id DROP NOT NULL;

-- ============================================================================
-- 2. Widen the venue_admins caps CHECK to admit 'manage_tournaments'
--    (live constraint already carried 6 caps incl. manage_memberships)
-- ============================================================================
ALTER TABLE public.venue_admins DROP CONSTRAINT venue_admins_caps_known;
ALTER TABLE public.venue_admins ADD CONSTRAINT venue_admins_caps_known CHECK (
  caps_grant <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships','manage_tournaments']::text[]
  AND caps_deny <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships','manage_tournaments']::text[]
);

-- ============================================================================
-- 3. Public page: JOIN clubs → LEFT JOIN so a venue-owned tournament (club NULL)
--    still resolves; club_name falls to NULL and the page shows the venue as host
--    (venue_name is already returned). Club-owned path byte-identical.
-- ============================================================================
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
    LEFT JOIN clubs  c ON c.id = te.club_id
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

-- ============================================================================
-- 4. NULL-safe audit fallback for the three public/run-phase writers reachable
--    by a venue-owned tournament. team_id := COALESCE(club_id, venue_id) per
--    decision-A. Bodies otherwise byte-identical to the live versions.
-- ============================================================================

-- 4a. tournament_register_team — public self-serve registration (mig 384)
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

  SELECT te.id, te.club_id, te.venue_id, te.name, te.status, te.registration_deadline
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
    COALESCE(v_te.club_id, v_te.venue_id), auth.uid(), 'system', COALESCE(v_email, 'public'),
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

-- 4b. tournament_join_via_invite — invite-code join (mig 318)
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

  SELECT te.name AS tournament_name, te.club_id, te.venue_id
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
    COALESCE(v_tournament.club_id, v_tournament.venue_id), v_uid, 'player', v_uid::text,
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

-- 4c. tournament_set_team_follow — public follow toggle (mig 439).
--     The old IS NULL guard doubled as a "team not found" sentinel; replace it
--     with a real existence flag so a venue-owned (club NULL) team is found.
CREATE OR REPLACE FUNCTION public.tournament_set_team_follow(p_competition_team_id uuid, p_follow boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_found    uuid;
  v_club_id  text;
  v_venue_id text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.id, te.club_id, te.venue_id
    INTO v_found, v_club_id, v_venue_id
  FROM competition_teams ct
  JOIN competitions c ON c.id = ct.competition_id
  JOIN tournament_events te ON te.id = c.tournament_event_id
  WHERE ct.id = p_competition_team_id;

  IF v_found IS NULL THEN
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
    COALESCE(v_club_id, v_venue_id), v_uid, 'system', NULL,
    'tournament_team_follow_set', 'competition_team', p_competition_team_id::text,
    jsonb_build_object('follow', p_follow)
  );

  RETURN jsonb_build_object('ok', true, 'following', p_follow);
END;
$function$;

-- ============================================================================
-- 5. Shared venue-token authorisation helper.
--    Resolves caller → venue; validates the tournament belongs to that venue;
--    admits on owner role OR manage_facility OR manage_tournaments cap; applies
--    the club's `tournaments` feature gate ONLY when a club owns the tournament.
--    Returns (venue_id, club_id, actor_type, actor_ident) for the audit row.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._authorise_venue_tournament(p_venue_token text, p_tournament_event_id uuid)
 RETURNS TABLE(venue_id text, club_id text, actor_type text, actor_ident text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club_id  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.venue_id, te.club_id INTO v_venue_id, v_club_id
  FROM public.tournament_events te
  WHERE te.id = p_tournament_event_id
  LIMIT 1;

  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Tournament must belong to the caller's venue (no cross-venue edit)
  IF v_venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Permission: owner role always; manager unless denied; staff only if granted
  -- either manage_facility or manage_tournaments.
  IF NOT (
       public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility')
    OR public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_tournaments')
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Club-owned-at-venue: respect the club's tournaments flag. Venue-owned: no gate.
  IF v_club_id IS NOT NULL AND NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  venue_id    := v_venue_id;
  club_id     := v_club_id;
  actor_type  := v_caller.actor_type;
  actor_ident := v_caller.actor_ident;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public._authorise_venue_tournament(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public._authorise_venue_tournament(text, uuid) TO anon, authenticated;

-- ============================================================================
-- 6. CORE WRITE SIBLINGS (venue-token). Bodies clone the club_admin_* logic;
--    only the auth block differs (helper or inline resolve + cap). Each keeps its
--    own audit_events row (HR#9), tagged COALESCE(club_id, venue_id).
-- ============================================================================

-- 6.1 venue_create_tournament — club optional (no tournament id yet ⇒ inline auth)
CREATE OR REPLACE FUNCTION public.venue_create_tournament(
  p_venue_token text, p_name text, p_slug text, p_event_date date,
  p_event_end_date date DEFAULT NULL::date, p_entry_fee_pence integer DEFAULT 0,
  p_entry_fee_payer text DEFAULT 'per_team'::text,
  p_registration_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_club_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller        record;
  v_venue_id      text;
  v_club_id       text := NULLIF(btrim(p_club_id), '');
  v_tournament_id uuid;
  v_name          text := NULLIF(btrim(p_name), '');
  v_slug          text := NULLIF(btrim(lower(p_slug)), '');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT (
       public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility')
    OR public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_tournaments')
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Optional owning club: must exist, operate at this venue, and have the flag on
  IF v_club_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = v_club_id) THEN
      RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM club_venues WHERE club_id = v_club_id AND venue_id = v_venue_id) THEN
      RAISE EXCEPTION 'venue_not_associated' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'slug_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_slug !~ '^[a-z0-9][a-z0-9\-]{1,79}$' THEN
    RAISE EXCEPTION 'slug_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_date IS NULL THEN
    RAISE EXCEPTION 'event_date_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_end_date IS NOT NULL AND p_event_end_date < p_event_date THEN
    RAISE EXCEPTION 'end_date_before_start' USING ERRCODE = 'P0001';
  END IF;
  IF p_entry_fee_payer NOT IN ('per_team', 'per_athlete') THEN
    RAISE EXCEPTION 'invalid_entry_fee_payer' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO tournament_events (
    venue_id, club_id, name, slug, event_date, event_end_date,
    entry_fee_pence, entry_fee_payer, registration_deadline
  ) VALUES (
    v_venue_id, v_club_id, v_name, v_slug, p_event_date, p_event_end_date,
    COALESCE(p_entry_fee_pence, 0), COALESCE(p_entry_fee_payer, 'per_team'), p_registration_deadline
  ) RETURNING id INTO v_tournament_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_club_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'tournament_created', 'tournament_event', v_tournament_id::text,
    jsonb_build_object('club_id', v_club_id, 'venue_id', v_venue_id, 'name', v_name, 'slug', v_slug, 'event_date', p_event_date)
  );

  RETURN jsonb_build_object('ok', true, 'tournament_id', v_tournament_id, 'slug', v_slug);
END;
$function$;

-- 6.2 venue_add_competition
CREATE OR REPLACE FUNCTION public.venue_add_competition(p_venue_token text, p_tournament_event_id uuid, p_name text, p_type text, p_format text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth           record;
  v_competition_id uuid;
  v_name           text := NULLIF(btrim(p_name), '');
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competitions (season_id, tournament_event_id, name, type, format, status)
  VALUES (NULL, p_tournament_event_id, v_name, p_type, p_format, 'setup')
  RETURNING id INTO v_competition_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_competition_added', 'competition', v_competition_id::text,
    jsonb_build_object('tournament_event_id', p_tournament_event_id, 'name', v_name, 'type', p_type)
  );

  RETURN jsonb_build_object('ok', true, 'competition_id', v_competition_id);
END;
$function$;

-- 6.3 venue_register_team
CREATE OR REPLACE FUNCTION public.venue_register_team(p_venue_token text, p_tournament_event_id uuid, p_competition_id uuid, p_team_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth                record;
  v_team_name           text := NULLIF(btrim(p_team_name), '');
  v_competition_team_id uuid;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF v_team_name IS NULL THEN
    RAISE EXCEPTION 'team_name_required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competition_teams (competition_id, team_name, status)
  VALUES (p_competition_id, v_team_name, 'active')
  RETURNING id INTO v_competition_team_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_team_registered', 'competition_team', v_competition_team_id::text,
    jsonb_build_object('tournament_event_id', p_tournament_event_id, 'competition_id', p_competition_id, 'team_name', v_team_name)
  );

  RETURN jsonb_build_object('ok', true, 'competition_team_id', v_competition_team_id);
END;
$function$;

-- 6.4 venue_send_team_invite
CREATE OR REPLACE FUNCTION public.venue_send_team_invite(p_venue_token text, p_tournament_event_id uuid, p_competition_id uuid, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth       record;
  v_code       text;
  v_invite_id  uuid;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF NOT EXISTS (
    SELECT 1 FROM competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  LOOP
    v_code := encode(extensions.gen_random_bytes(6), 'hex');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tournament_invitations WHERE code = v_code);
  END LOOP;

  INSERT INTO tournament_invitations
    (tournament_event_id, competition_id, email, code, expires_at, created_by)
  VALUES (
    p_tournament_event_id, p_competition_id,
    NULLIF(btrim(COALESCE(p_email, '')), ''),
    v_code, now() + interval '14 days', auth.uid()
  )
  RETURNING id INTO v_invite_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_invite_sent', 'tournament_invitation', v_invite_id::text,
    jsonb_build_object('tournament_event_id', p_tournament_event_id, 'competition_id', p_competition_id, 'code', v_code, 'email', p_email)
  );

  RETURN jsonb_build_object('ok', true, 'code', v_code, 'invite_id', v_invite_id);
END;
$function$;

-- 6.5 venue_approve_team — keyed by competition_team_id, resolve te first
CREATE OR REPLACE FUNCTION public.venue_approve_team(p_venue_token text, p_competition_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth      record;
  v_te_id     uuid;
  v_team_name text;
  v_status    text;
BEGIN
  SELECT te.id, ct.team_name, ct.status
    INTO v_te_id, v_team_name, v_status
    FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE ct.id = p_competition_team_id
   LIMIT 1;

  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_te_id);

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'team_not_pending' USING ERRCODE = 'P0001';
  END IF;

  UPDATE competition_teams SET status = 'active' WHERE id = p_competition_team_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_team_approved', 'competition_team', p_competition_team_id::text,
    jsonb_build_object('team_name', v_team_name)
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- 6.6 venue_reject_team
CREATE OR REPLACE FUNCTION public.venue_reject_team(p_venue_token text, p_competition_team_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth      record;
  v_te_id     uuid;
  v_team_name text;
  v_status    text;
BEGIN
  SELECT te.id, ct.team_name, ct.status
    INTO v_te_id, v_team_name, v_status
    FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE ct.id = p_competition_team_id
   LIMIT 1;

  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_te_id);

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'team_not_pending' USING ERRCODE = 'P0001';
  END IF;

  UPDATE competition_teams
     SET status = 'rejected',
         rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
   WHERE id = p_competition_team_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_team_rejected', 'competition_team', p_competition_team_id::text,
    jsonb_build_object('team_name', v_team_name, 'reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- 6.7 venue_generate_schedule
CREATE OR REPLACE FUNCTION public.venue_generate_schedule(p_venue_token text, p_tournament_event_id uuid, p_competition_id uuid, p_slot_minutes integer, p_start_time time without time zone, p_start_date date, p_playing_area_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth        record;
  v_venue_id    text;
  v_teams       uuid[];
  v_n           int;
  v_m           int;
  v_pitch_n     int;
  v_round       int;
  v_slot        int;
  v_home        uuid;
  v_away        uuid;
  v_match_count int := 0;
  v_kickoff     time;
  v_pitch       uuid;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);
  v_venue_id := v_auth.venue_id;

  IF NOT EXISTS (
    SELECT 1 FROM competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM fixtures WHERE competition_id = p_competition_id LIMIT 1) THEN
    RAISE EXCEPTION 'fixtures_already_exist' USING ERRCODE = 'P0001';
  END IF;

  v_pitch_n := COALESCE(array_length(p_playing_area_ids, 1), 0);
  IF v_pitch_n > 0 AND EXISTS (
    SELECT 1 FROM unnest(p_playing_area_ids) AS t(pa_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM playing_areas pa
      WHERE pa.id = t.pa_id AND pa.venue_id = v_venue_id AND pa.active = true
    )
  ) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  SELECT ARRAY(
    SELECT id FROM competition_teams
    WHERE competition_id = p_competition_id AND status = 'active'
    ORDER BY registered_at, id
  ) INTO v_teams;

  v_n := COALESCE(array_length(v_teams, 1), 0);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'not_enough_teams' USING ERRCODE = 'P0001';
  END IF;

  IF v_n % 2 = 1 THEN
    v_teams := v_teams || ARRAY[NULL::uuid];
    v_n     := v_n + 1;
  END IF;

  v_m := v_n - 1;

  FOR v_round IN 1..v_m LOOP
    FOR v_slot IN 1..(v_n / 2) LOOP
      v_home := v_teams[v_slot];
      v_away := v_teams[v_n - v_slot + 1];

      IF v_home IS NULL OR v_away IS NULL THEN
        CONTINUE;
      END IF;

      v_kickoff := p_start_time
                 + ((v_match_count / GREATEST(v_pitch_n, 1)) * p_slot_minutes
                    * INTERVAL '1 minute');

      v_pitch := CASE WHEN v_pitch_n > 0
                      THEN p_playing_area_ids[(v_match_count % v_pitch_n) + 1]
                      ELSE NULL END;

      INSERT INTO fixtures (
        competition_id,
        home_competition_team_id, away_competition_team_id,
        week_number, round_name,
        scheduled_date, kickoff_time,
        playing_area_id, slot_minutes,
        status
      ) VALUES (
        p_competition_id,
        v_home, v_away,
        v_round, 'Round ' || v_round,
        p_start_date, v_kickoff,
        v_pitch, p_slot_minutes,
        'scheduled'
      );

      v_match_count := v_match_count + 1;
    END LOOP;

    v_teams := ARRAY[v_teams[1]] || ARRAY[v_teams[v_n]] || v_teams[2:v_n - 1];
  END LOOP;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_schedule_generated', 'competition', p_competition_id::text,
    jsonb_build_object(
      'tournament_event_id', p_tournament_event_id,
      'fixtures_created',    v_match_count,
      'rounds',              v_m,
      'slot_minutes',        p_slot_minutes
    )
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'fixtures_created', v_match_count,
    'rounds',           v_m
  );
END;
$function$;

-- 6.8 venue_assign_fixture_slot — keyed by fixture_id, resolve te first
CREATE OR REPLACE FUNCTION public.venue_assign_fixture_slot(p_venue_token text, p_fixture_id uuid, p_scheduled_date date DEFAULT NULL::date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone, p_playing_area_id uuid DEFAULT NULL::uuid, p_slot_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth   record;
  v_te_id  uuid;
BEGIN
  SELECT te.id INTO v_te_id
    FROM fixtures fx
    JOIN competitions c ON c.id = fx.competition_id
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE fx.id = p_fixture_id
   LIMIT 1;

  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_te_id);

  UPDATE fixtures
     SET scheduled_date  = COALESCE(p_scheduled_date,  scheduled_date),
         kickoff_time    = COALESCE(p_kickoff_time,    kickoff_time),
         playing_area_id = COALESCE(p_playing_area_id, playing_area_id),
         slot_minutes    = COALESCE(p_slot_minutes,    slot_minutes)
   WHERE id = p_fixture_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_fixture_slot_updated', 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'scheduled_date',  p_scheduled_date,
      'kickoff_time',    p_kickoff_time,
      'playing_area_id', p_playing_area_id,
      'slot_minutes',    p_slot_minutes
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- 6.9 venue_seed_knockout
CREATE OR REPLACE FUNCTION public.venue_seed_knockout(p_venue_token text, p_tournament_event_id uuid, p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth            record;
  v_config          jsonb;
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
$function$;

-- 6.10 venue_seed_double_elimination
CREATE OR REPLACE FUNCTION public.venue_seed_double_elimination(p_venue_token text, p_tournament_event_id uuid, p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth         record;
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
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

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

  v_wb_prev_ids := v_wb_cur_ids;

  FOR v_wb_round IN 2..v_k LOOP

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

      UPDATE public.fixtures
         SET de_loser_to_fixture_id = v_lb_id, de_loser_to_slot = 'away'
       WHERE id = v_wb_cur_ids[i];

      v_total_lb := v_total_lb + 1;
    END LOOP;
    v_lb_round_num := v_lb_round_num + 1;
    v_wk           := v_wk + 1;

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

  v_wbf_id := v_wb_cur_ids[1];

  INSERT INTO public.fixtures (
    competition_id, home_competition_team_id, away_competition_team_id,
    knockout_home_feeder_id, knockout_away_feeder_id,
    week_number, round_name, de_bracket, status
  ) VALUES (
    p_competition_id, NULL, NULL,
    v_wbf_id, v_lb_drop_ids[1],
    v_wk, 'Grand Final', 'grand_final', 'allocated'
  );

  UPDATE public.competitions
     SET config = COALESCE(config, '{}') || '{"knockout_seeded": true}'::jsonb
   WHERE id = p_competition_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
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
$function$;

-- 6.11 venue_update_tournament_status — keyed by slug, resolve te first
CREATE OR REPLACE FUNCTION public.venue_update_tournament_status(p_venue_token text, p_slug text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth          record;
  v_tournament_id uuid;
  v_old_status    text;
BEGIN
  IF p_status NOT IN ('draft', 'open', 'closed', 'live', 'completed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, status INTO v_tournament_id, v_old_status
    FROM tournament_events
   WHERE slug = p_slug
   LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_tournament_id);

  UPDATE tournament_events
     SET status = p_status
   WHERE id = v_tournament_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_status_changed', 'tournament_event', v_tournament_id::text,
    jsonb_build_object('slug', p_slug, 'old_status', v_old_status, 'new_status', p_status)
  );

  RETURN jsonb_build_object('ok', true, 'slug', p_slug, 'status', p_status);
END;
$function$;

-- ============================================================================
-- 7. READ SIBLINGS (venue-token). Per-tournament reads authorise via the helper.
--    The "list" read reuses the pre-existing list_venue_tournaments (no new fn).
-- ============================================================================

-- 7.1 venue_get_tournament — by slug (resolve te → helper)
CREATE OR REPLACE FUNCTION public.venue_get_tournament(p_venue_token text, p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth record;
  v_te   record;
BEGIN
  SELECT * INTO v_te FROM tournament_events WHERE slug = p_slug LIMIT 1;
  IF v_te IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_te.id);

  RETURN jsonb_build_object(
    'tournament_id',             v_te.id,
    'name',                      v_te.name,
    'slug',                      v_te.slug,
    'status',                    v_te.status,
    'event_date',                v_te.event_date,
    'event_end_date',            v_te.event_end_date,
    'entry_fee_pence',           v_te.entry_fee_pence,
    'entry_fee_payer',           v_te.entry_fee_payer,
    'host_team_entry_waived',    v_te.host_team_entry_waived,
    'track_stats',               v_te.track_stats,
    'registration_deadline',     v_te.registration_deadline,
    'schedule_config',           v_te.schedule_config,
    'branding',                  v_te.branding,
    'points_config',             v_te.points_config,
    'venue_id',                  v_te.venue_id,
    'club_id',                   v_te.club_id,
    'created_at',                v_te.created_at,
    'player_of_tournament_name', v_te.player_of_tournament_name,
    'player_of_tournament_team', v_te.player_of_tournament_team,
    'sponsors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sponsor_id',    ts.id,
        'name',          ts.name,
        'logo_url',      ts.logo_url,
        'website_url',   ts.website_url,
        'display_order', ts.display_order,
        'active',        ts.active
      ) ORDER BY ts.display_order, ts.name)
      FROM tournament_sponsors ts
      WHERE ts.tournament_event_id = v_te.id
    ), '[]'::jsonb),
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
$function$;

-- 7.2 venue_get_schedule — by tournament id
CREATE OR REPLACE FUNCTION public.venue_get_schedule(p_venue_token text, p_tournament_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth     record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);
  v_venue_id := v_auth.venue_id;

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
    'venue_officials', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',                mo.id,
        'name',              mo.name,
        'preferred_channel', mo.preferred_channel,
        'overall_rating',    mo.overall_rating
      ) ORDER BY mo.name)
      FROM match_officials mo
      WHERE mo.venue_id = v_venue_id AND mo.active = true
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
            'official_id',     fx.official_id,
            'official_name',   mo.name,
            'home_score',      fx.home_score,
            'away_score',      fx.away_score
          ) ORDER BY fx.week_number, fx.kickoff_time NULLS LAST, fx.id)
          FROM fixtures fx
          LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
          LEFT JOIN competition_teams att ON att.id = fx.away_competition_team_id
          LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
          LEFT JOIN match_officials mo    ON mo.id  = fx.official_id
          WHERE fx.competition_id = comp.id
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = p_tournament_event_id
    ), '[]'::jsonb)
  );
END;
$function$;

-- 7.3 venue_get_tournament_standings — by tournament id + competition
--     (named to NOT overload the pre-existing league venue_get_standings(token, competition_id))
CREATE OR REPLACE FUNCTION public.venue_get_tournament_standings(p_venue_token text, p_tournament_event_id uuid, p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth            record;
  v_knockout_seeded boolean;
  v_result          jsonb;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

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
      AND fx.group_label IS NOT NULL
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

-- ============================================================================
-- 8. GRANTS — venue RPCs callable by anon (venue_admin_token) + authenticated
--    (venue staff). CREATE OR REPLACE on the existing public funcs preserves
--    their ACL, so they are not re-granted here.
-- ============================================================================
REVOKE ALL ON FUNCTION public.venue_create_tournament(text, text, text, date, date, integer, text, timestamptz, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_create_tournament(text, text, text, date, date, integer, text, timestamptz, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_add_competition(text, uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_add_competition(text, uuid, text, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_register_team(text, uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_register_team(text, uuid, uuid, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_send_team_invite(text, uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_send_team_invite(text, uuid, uuid, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_approve_team(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_approve_team(text, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_reject_team(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_reject_team(text, uuid, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_generate_schedule(text, uuid, uuid, integer, time, date, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_generate_schedule(text, uuid, uuid, integer, time, date, uuid[]) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_assign_fixture_slot(text, uuid, date, time, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_assign_fixture_slot(text, uuid, date, time, uuid, integer) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_seed_knockout(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_seed_knockout(text, uuid, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_seed_double_elimination(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_seed_double_elimination(text, uuid, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_update_tournament_status(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_update_tournament_status(text, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_get_tournament(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_get_tournament(text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_get_schedule(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_get_schedule(text, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_get_tournament_standings(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_get_tournament_standings(text, uuid, uuid) TO anon, authenticated;

COMMIT;
