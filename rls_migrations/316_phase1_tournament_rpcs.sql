-- Migration 316 — Event OS: Phase 1 tournament RPCs
-- Three RPCs for club managers to create and read tournament events.
-- Auth pattern: auth.uid() → member_profiles → club_team_managers → club_teams.club_id
--               (same uid()-based pattern as get_user_relationships / mig 314)
-- All: SECURITY DEFINER, search_path locked, authenticated only, anon revoked.
--
-- RPCs:
--   club_admin_create_tournament  — create a new tournament event
--   club_admin_list_tournaments   — list all tournaments for a club
--   club_admin_get_tournament     — get full detail by slug

-- ─── 1. club_admin_create_tournament ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_create_tournament(
  p_club_id               text,
  p_venue_id              text,
  p_name                  text,
  p_slug                  text,
  p_event_date            date,
  p_event_end_date        date        DEFAULT NULL,
  p_entry_fee_pence       int         DEFAULT 0,
  p_entry_fee_payer       text        DEFAULT 'per_team',
  p_registration_deadline timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_profile_id    uuid;
  v_tournament_id uuid;
  v_name          text := NULLIF(btrim(p_name), '');
  v_slug          text := NULLIF(btrim(lower(p_slug)), '');
BEGIN
  -- Auth
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = p_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Validate club exists
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = p_club_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Validate venue is associated with this club
  IF NOT EXISTS (SELECT 1 FROM club_venues WHERE club_id = p_club_id AND venue_id = p_venue_id) THEN
    RAISE EXCEPTION 'venue_not_associated' USING ERRCODE = 'P0001';
  END IF;

  -- Validate inputs
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

  -- Slug uniqueness enforced by DB UNIQUE constraint — let it surface naturally
  INSERT INTO tournament_events (
    venue_id, club_id, name, slug, event_date, event_end_date,
    entry_fee_pence, entry_fee_payer, registration_deadline
  ) VALUES (
    p_venue_id, p_club_id, v_name, v_slug, p_event_date, p_event_end_date,
    COALESCE(p_entry_fee_pence, 0), COALESCE(p_entry_fee_payer, 'per_team'), p_registration_deadline
  ) RETURNING id INTO v_tournament_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    p_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_created', 'tournament_event', v_tournament_id::text,
    jsonb_build_object('club_id', p_club_id, 'venue_id', p_venue_id, 'name', v_name, 'slug', v_slug, 'event_date', p_event_date)
  );

  RETURN jsonb_build_object('ok', true, 'tournament_id', v_tournament_id, 'slug', v_slug);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_create_tournament(text,text,text,text,date,date,int,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_create_tournament(text,text,text,text,date,date,int,text,timestamptz) TO authenticated;

-- ─── 2. club_admin_list_tournaments ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_list_tournaments(
  p_club_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = p_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object(
        'tournament_id',            te.id,
        'name',                     te.name,
        'slug',                     te.slug,
        'status',                   te.status,
        'event_date',               te.event_date,
        'event_end_date',           te.event_end_date,
        'entry_fee_pence',          te.entry_fee_pence,
        'entry_fee_payer',          te.entry_fee_payer,
        'registration_deadline',    te.registration_deadline,
        'venue_id',                 te.venue_id,
        'created_at',               te.created_at
      ) ORDER BY te.event_date DESC, te.created_at DESC)
      FROM tournament_events te
      WHERE te.club_id = p_club_id
    ),
    '[]'::jsonb
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_list_tournaments(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_list_tournaments(text) TO authenticated;

-- ─── 3. club_admin_get_tournament ────────────────────────────────────────────

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

  -- Verify caller manages this tournament's club
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
    'tournament_id',            v_te.id,
    'name',                     v_te.name,
    'slug',                     v_te.slug,
    'status',                   v_te.status,
    'event_date',               v_te.event_date,
    'event_end_date',           v_te.event_end_date,
    'entry_fee_pence',          v_te.entry_fee_pence,
    'entry_fee_payer',          v_te.entry_fee_payer,
    'host_team_entry_waived',   v_te.host_team_entry_waived,
    'track_stats',              v_te.track_stats,
    'registration_deadline',    v_te.registration_deadline,
    'schedule_config',          v_te.schedule_config,
    'branding',                 v_te.branding,
    'points_config',            v_te.points_config,
    'venue_id',                 v_te.venue_id,
    'club_id',                  v_te.club_id,
    'created_at',               v_te.created_at,
    'performance_events',       COALESCE((
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
    'competitions',             COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id', c.id,
        'name',           c.name,
        'type',           c.type,
        'format',         c.format,
        'status',         c.status
      ) ORDER BY c.name)
      FROM competitions c
      WHERE c.tournament_event_id = v_te.id
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_get_tournament(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_tournament(text) TO authenticated;
