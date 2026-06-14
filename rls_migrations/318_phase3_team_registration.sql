-- Migration 318 — Event OS: Phase 3 team registration & competition roster
-- Schema:
--   1. competitions.season_id → nullable (tournament competitions don't need a league season)
--   2. competition_teams.team_id → nullable + team_name column (tournament teams aren't casual squads)
--   3. CREATE TABLE tournament_invitations
-- RPCs (all authenticated-only except get_tournament_public which stays anon+authenticated):
--   club_admin_add_competition       — add a competition to an existing tournament
--   club_admin_register_team         — host registers their own team (straight to active)
--   club_admin_send_team_invite      — generate an invite code for external teams
--   club_admin_approve_team          — pending → active
--   club_admin_reject_team           — pending → rejected
--   tournament_join_via_invite       — external team joins via invite code (authenticated)
--   get_tournament_public            — extended: now returns competitions + active teams
--   club_admin_get_tournament        — extended: now returns teams per competition

-- ─── 1. Schema changes ───────────────────────────────────────────────────────

ALTER TABLE public.competitions ALTER COLUMN season_id DROP NOT NULL;
ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_identity_check
    CHECK (season_id IS NOT NULL OR tournament_event_id IS NOT NULL);

ALTER TABLE public.competition_teams ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE public.competition_teams ADD COLUMN team_name text;
ALTER TABLE public.competition_teams
  ADD CONSTRAINT ct_team_identity_check
    CHECK (team_id IS NOT NULL OR team_name IS NOT NULL);

-- ─── 2. tournament_invitations ───────────────────────────────────────────────

CREATE TABLE public.tournament_invitations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_event_id uuid        NOT NULL REFERENCES public.tournament_events(id),
  competition_id      uuid        NOT NULL REFERENCES public.competitions(id),
  email               text,
  code                text        UNIQUE NOT NULL,
  status              text        NOT NULL DEFAULT 'sent'
                                  CHECK (status IN ('sent','accepted','expired')),
  expires_at          timestamptz NOT NULL,
  created_by          uuid        REFERENCES auth.users(id),
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.tournament_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_invitations FROM anon, authenticated;

-- ─── 3. club_admin_add_competition ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_add_competition(
  p_tournament_event_id uuid,
  p_name                text,
  p_type                text,
  p_format              text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid            uuid := auth.uid();
  v_profile_id     uuid;
  v_club_id        text;
  v_competition_id uuid;
  v_name           text := NULLIF(btrim(p_name), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
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

  INSERT INTO competitions (season_id, tournament_event_id, name, type, format, status)
  VALUES (NULL, p_tournament_event_id, v_name, p_type, p_format, 'setup')
  RETURNING id INTO v_competition_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_competition_added', 'competition', v_competition_id::text,
    jsonb_build_object('tournament_event_id', p_tournament_event_id, 'name', v_name, 'type', p_type)
  );

  RETURN jsonb_build_object('ok', true, 'competition_id', v_competition_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_add_competition(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_add_competition(uuid, text, text, text) TO authenticated;

-- ─── 4. club_admin_register_team ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_register_team(
  p_tournament_event_id uuid,
  p_competition_id      uuid,
  p_team_name           text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid                 uuid := auth.uid();
  v_profile_id          uuid;
  v_club_id             text;
  v_team_name           text := NULLIF(btrim(p_team_name), '');
  v_competition_team_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF v_team_name IS NULL THEN
    RAISE EXCEPTION 'team_name_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
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
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_team_registered', 'competition_team', v_competition_team_id::text,
    jsonb_build_object('tournament_event_id', p_tournament_event_id, 'competition_id', p_competition_id, 'team_name', v_team_name)
  );

  RETURN jsonb_build_object('ok', true, 'competition_team_id', v_competition_team_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_register_team(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_register_team(uuid, uuid, text) TO authenticated;

-- ─── 5. club_admin_send_team_invite ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_send_team_invite(
  p_tournament_event_id uuid,
  p_competition_id      uuid,
  p_email               text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_code       text;
  v_invite_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
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
    v_code, now() + interval '14 days', v_uid
  )
  RETURNING id INTO v_invite_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_invite_sent', 'tournament_invitation', v_invite_id::text,
    jsonb_build_object('tournament_event_id', p_tournament_event_id, 'competition_id', p_competition_id, 'code', v_code, 'email', p_email)
  );

  RETURN jsonb_build_object('ok', true, 'code', v_code, 'invite_id', v_invite_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_send_team_invite(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_send_team_invite(uuid, uuid, text) TO authenticated;

-- ─── 6. club_admin_approve_team ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_approve_team(
  p_competition_team_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_team_name  text;
  v_status     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id, ct.team_name, ct.status
    INTO v_club_id, v_team_name, v_status
    FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE ct.id = p_competition_team_id
   LIMIT 1;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
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

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'team_not_pending' USING ERRCODE = 'P0001';
  END IF;

  UPDATE competition_teams SET status = 'active' WHERE id = p_competition_team_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_team_approved', 'competition_team', p_competition_team_id::text,
    jsonb_build_object('team_name', v_team_name)
  );

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_approve_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_approve_team(uuid) TO authenticated;

-- ─── 7. club_admin_reject_team ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_reject_team(
  p_competition_team_id uuid,
  p_reason              text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_team_name  text;
  v_status     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id, ct.team_name, ct.status
    INTO v_club_id, v_team_name, v_status
    FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE ct.id = p_competition_team_id
   LIMIT 1;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
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
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_team_rejected', 'competition_team', p_competition_team_id::text,
    jsonb_build_object('team_name', v_team_name, 'reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_reject_team(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_reject_team(uuid, text) TO authenticated;

-- ─── 8. tournament_join_via_invite ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tournament_join_via_invite(
  p_code      text,
  p_team_name text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
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
    'ok',                  true,
    'competition_team_id', v_competition_team_id,
    'tournament_name',     v_tournament.tournament_name,
    'competition_name',    v_invite.competition_name
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.tournament_join_via_invite(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_join_via_invite(text, text) TO authenticated;

-- ─── 9. get_tournament_public (extended) ─────────────────────────────────────

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
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_tournament_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_public(text) TO anon, authenticated;

-- ─── 10. club_admin_get_tournament (extended with teams per competition) ──────

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
        'competition_id', comp.id,
        'name',           comp.name,
        'type',           comp.type,
        'format',         comp.format,
        'status',         comp.status,
        'teams', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'competition_team_id', ct.id,
            'team_name',           COALESCE(ct.team_name, t.name),
            'team_id',             ct.team_id,
            'status',              ct.status,
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
