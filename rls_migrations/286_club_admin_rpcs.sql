-- Migration 286 — Club admin RPCs
-- Membership V2 Phase 1: venue-admin operations on clubs.
-- Both RPCs: SECURITY DEFINER, search_path locked, authenticated-only.
-- Auth via venue_admins table — never the shared p_venue_token.

-- ─── club_create ─────────────────────────────────────────────────────────────
-- Creates a new club and links it to the given venue.
-- Caller must have a venue_admins row for p_venue_id.
-- id is derived from name: 'club_' + slugified name, truncated to 60 chars.

CREATE OR REPLACE FUNCTION public.club_create(
  p_venue_id     text,
  p_name         text,
  p_short_name   text    DEFAULT NULL,
  p_contact_name  text   DEFAULT NULL,
  p_contact_email text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_club_id       text;
  v_club_venue_id uuid;
BEGIN
  -- Verify caller is a venue admin for this venue
  IF NOT EXISTS (
    SELECT 1 FROM venue_admins
    WHERE venue_id = p_venue_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Derive a stable text id from the club name
  v_club_id := 'club_' || lower(regexp_replace(
    regexp_replace(trim(p_name), '[^a-zA-Z0-9\s]', '', 'g'),
    '\s+', '_', 'g'
  ));
  -- Truncate to 60 chars to stay within text PK sanity
  v_club_id := left(v_club_id, 60);

  -- Guard: reject if id already taken
  IF EXISTS (SELECT 1 FROM clubs WHERE id = v_club_id) THEN
    RAISE EXCEPTION 'club_id_taken: %', v_club_id;
  END IF;

  INSERT INTO clubs (id, name, short_name, contact_name, contact_email)
  VALUES (v_club_id, p_name, p_short_name, p_contact_name, p_contact_email);

  INSERT INTO club_venues (club_id, venue_id)
  VALUES (v_club_id, p_venue_id)
  RETURNING id INTO v_club_venue_id;

  INSERT INTO audit_events (team_id, actor_id, event_type, payload)
  VALUES (
    p_venue_id,
    v_user_id,
    'club_created',
    jsonb_build_object('club_id', v_club_id, 'name', p_name)
  );

  RETURN jsonb_build_object(
    'club_id',       v_club_id,
    'club_venue_id', v_club_venue_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.club_create(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_create(text, text, text, text, text) TO authenticated;

-- ─── venue_list_clubs ────────────────────────────────────────────────────────
-- Lists all clubs linked to a venue, with cohort counts.
-- Caller must have a venue_admins row for p_venue_id.

CREATE OR REPLACE FUNCTION public.venue_list_clubs(
  p_venue_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM venue_admins
    WHERE venue_id = p_venue_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',            c.id,
        'name',          c.name,
        'short_name',    c.short_name,
        'contact_email', c.contact_email,
        'id_mandate',    c.id_mandate,
        'cohorts_count', (
          SELECT count(*) FROM club_cohorts cc
          WHERE cc.club_id = c.id AND cc.active = true
        )
      )
      ORDER BY c.name
    )
    FROM clubs c
    JOIN club_venues cv ON cv.club_id = c.id
    WHERE cv.venue_id = p_venue_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.venue_list_clubs(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_list_clubs(text) TO authenticated;
