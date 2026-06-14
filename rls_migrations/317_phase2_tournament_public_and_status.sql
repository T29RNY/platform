-- Migration 317 — Event OS: Phase 2 public read + status lifecycle
-- Two RPCs:
--   get_tournament_public              — anon-accessible public page read
--   club_admin_update_tournament_status — club manager lifecycle transitions
--
-- get_tournament_public:
--   GRANT to anon + authenticated. Returns ok:false for drafts or unknown slugs.
--   No auth required — this is the public tournament registration page.
--
-- club_admin_update_tournament_status:
--   authenticated only. Same auth.uid()→member_profiles→club_team_managers
--   pattern as mig 316. Free transitions — UI restricts choices shown.
--   Audits tournament_status_changed.

-- ─── 1. get_tournament_public ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tournament_public(
  p_slug text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_te     record;
  v_club   record;
  v_venue  record;
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
    'ok',             true,
    'name',           v_te.name,
    'slug',           v_te.slug,
    'status',         v_te.status,
    'event_date',     v_te.event_date,
    'event_end_date', v_te.event_end_date,
    'venue_name',     v_te.venue_name,
    'club_name',      v_te.club_name
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_tournament_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_public(text) TO anon, authenticated;

-- ─── 2. club_admin_update_tournament_status ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_update_tournament_status(
  p_slug   text,
  p_status text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_profile_id    uuid;
  v_tournament_id uuid;
  v_club_id       text;
  v_old_status    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Validate status value against the DB CHECK constraint enum
  IF p_status NOT IN ('draft', 'open', 'closed', 'live', 'completed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, club_id, status
    INTO v_tournament_id, v_club_id, v_old_status
    FROM tournament_events
   WHERE slug = p_slug
   LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Verify caller is an active manager of this tournament's club
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events
     SET status = p_status
   WHERE id = v_tournament_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_status_changed', 'tournament_event', v_tournament_id::text,
    jsonb_build_object('slug', p_slug, 'old_status', v_old_status, 'new_status', p_status)
  );

  RETURN jsonb_build_object('ok', true, 'slug', p_slug, 'status', p_status);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_update_tournament_status(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_update_tournament_status(text, text) TO authenticated;
