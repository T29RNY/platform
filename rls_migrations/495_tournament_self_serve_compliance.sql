-- 495_tournament_self_serve_compliance.sql
--
-- Standalone Tournament Self-Serve epic — PR #5, the compliance stack that gates
-- flipping the create-card flag to live. Two Apple requirements + schema:
--
--   (a) REVERSE PATH (Apple 5.1.1(v)): an owner can CANCEL their own tournament.
--       New status 'cancelled' (soft — preserves the audit trail, recoverable by
--       a later un-cancel if ever needed) via self_serve_cancel_tournament,
--       owner-only (created_by_user = auth.uid()). get_tournament_public then hides
--       it (returns not_found), same as 'draft'.
--   (b) MODERATION (Apple 1.2): a public report affordance (tournament_report,
--       anon) writing to a tournament_reports table, and a platform takedown
--       (admin_hide_tournament, is_platform_admin) that soft-hides the tournament
--       from the public page (hidden_at). Offensive TEAM names are already handled
--       by the reused venue_reject_team (owner-side).
--
-- Participant-side withdraw (tournament_withdraw_team) is DEFERRED, named: the
-- register RPC (mig 384) captures no registrant identity on the competition_teams
-- row (registration is frequently anonymous — auth.uid() may be NULL), so a
-- captain self-withdraw keyed on identity needs a registered_by_user column + a
-- register-RPC change first. The organiser-side removal (venue_reject_team) already
-- covers taking a team out, so this is a follow-up, not a go-live blocker.

-- ── (a)+(b) schema ──────────────────────────────────────────────────────────
-- New 'cancelled' status.
ALTER TABLE public.tournament_events DROP CONSTRAINT IF EXISTS tournament_events_status_check;
ALTER TABLE public.tournament_events
  ADD CONSTRAINT tournament_events_status_check
    CHECK (status = ANY (ARRAY['draft','open','closed','live','completed','cancelled']));

-- Moderation soft-hide (NULL = visible). Separate from status so a live tournament
-- can be taken down without losing its lifecycle state.
ALTER TABLE public.tournament_events
  ADD COLUMN IF NOT EXISTS hidden_at     timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by     uuid,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

-- Public reports inbox (the moderation queue the takedown acts on).
CREATE TABLE IF NOT EXISTS public.tournament_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_event_id uuid NOT NULL REFERENCES public.tournament_events(id) ON DELETE CASCADE,
  reason              text NOT NULL CHECK (reason IN ('offensive','inappropriate','spam','impersonation','other')),
  reporter_note       text,
  reporter_uid        uuid,          -- nullable: signed-out spectators can report
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournament_reports_event_idx ON public.tournament_reports (tournament_event_id, created_at DESC);
-- RLS on; no direct client access — everything flows through SECURITY DEFINER RPCs.
ALTER TABLE public.tournament_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_reports FROM PUBLIC, anon, authenticated;

-- ── (a) self_serve_cancel_tournament — owner reverse path ────────────────────
CREATE OR REPLACE FUNCTION public.self_serve_cancel_tournament(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_te    record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, created_by_user, status, venue_id, club_id, name
    INTO v_te
    FROM public.tournament_events
   WHERE id = p_tournament_id
   FOR UPDATE;
  IF v_te.id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_te.created_by_user IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;
  IF v_te.status = 'completed' THEN
    RAISE EXCEPTION 'cannot_cancel_completed' USING ERRCODE = 'P0001';
  END IF;
  IF v_te.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'cancelled', 'already', true);
  END IF;

  UPDATE public.tournament_events SET status = 'cancelled' WHERE id = p_tournament_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    COALESCE(v_te.club_id, v_te.venue_id), v_uid, 'venue_admin', v_uid::text,
    'tournament_self_serve_cancelled', 'tournament_event', p_tournament_id::text,
    jsonb_build_object('name', v_te.name, 'prev_status', v_te.status)
  );

  RETURN jsonb_build_object('ok', true, 'status', 'cancelled');
END;
$function$;

REVOKE ALL ON FUNCTION public.self_serve_cancel_tournament(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_cancel_tournament(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_cancel_tournament(uuid) TO authenticated;

-- ── (b) tournament_report — public report affordance ─────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_report(p_slug text, p_reason text, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_te_id uuid;
  v_venue text;
  v_note  text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('offensive','inappropriate','spam','impersonation','other') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    v_note := left(v_note, 500);
  END IF;

  SELECT id, venue_id INTO v_te_id, v_venue FROM public.tournament_events WHERE slug = p_slug LIMIT 1;
  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tournament_reports (tournament_event_id, reason, reporter_note, reporter_uid)
  VALUES (v_te_id, p_reason, v_note, auth.uid());

  -- Fire-and-forget from the public page → leave a server-side trace (HR#9).
  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue, auth.uid(), 'system', COALESCE(auth.uid()::text, 'public'),
    'tournament_reported', 'tournament_event', v_te_id::text,
    jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.tournament_report(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tournament_report(text, text, text) TO anon, authenticated;

-- ── (b) admin_hide_tournament — platform takedown ────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_hide_tournament(p_tournament_id uuid, p_hidden boolean, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_te record;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, venue_id, club_id, status INTO v_te
    FROM public.tournament_events WHERE id = p_tournament_id FOR UPDATE;
  IF v_te.id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_hidden THEN
    UPDATE public.tournament_events
       SET hidden_at = now(), hidden_by = auth.uid(), hidden_reason = NULLIF(btrim(COALESCE(p_reason,'')), '')
     WHERE id = p_tournament_id;
  ELSE
    UPDATE public.tournament_events
       SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL
     WHERE id = p_tournament_id;
  END IF;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    COALESCE(v_te.club_id, v_te.venue_id), auth.uid(), 'superadmin', auth.uid()::text,
    CASE WHEN p_hidden THEN 'tournament_moderation_hidden' ELSE 'tournament_moderation_unhidden' END,
    'tournament_event', p_tournament_id::text,
    jsonb_build_object('reason', NULLIF(btrim(COALESCE(p_reason,'')), ''))
  );

  RETURN jsonb_build_object('ok', true, 'hidden', p_hidden);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_hide_tournament(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_hide_tournament(uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_hide_tournament(uuid, boolean, text) TO authenticated;

-- ── get_tournament_public — hide cancelled + moderation-hidden ───────────────
-- Full CREATE OR REPLACE transcribed verbatim from the live definition; the ONLY
-- change is the visibility gate (marked below): draft → (draft|cancelled) OR
-- hidden_at IS NOT NULL.
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
  -- mig 495: hide draft, cancelled, and moderation-hidden tournaments from the public page.
  IF v_te.status IN ('draft', 'cancelled') OR v_te.hidden_at IS NOT NULL THEN
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
