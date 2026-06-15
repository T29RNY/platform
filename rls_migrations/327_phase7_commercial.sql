-- Migration 327 — Event OS: Phase 7 Commercial
--
-- Schema additions:
--   tournament_events      + player_of_tournament_name text, player_of_tournament_team text
--   equipment_bookings     + tournament_event_id uuid FK → tournament_events (session linkage)
--   tournament_sponsors    (new table — one sponsor per row per tournament)
--
-- New RPCs (all SECURITY DEFINER, SET search_path, authenticated-only):
--   1. club_admin_add_sponsor               — attach a sponsor to a tournament
--   2. club_admin_list_sponsors             — list all sponsors (incl. inactive)
--   3. club_admin_remove_sponsor            — hard-delete a sponsor (ownership guard)
--   4. club_admin_set_branding              — write primary_colour/secondary_colour/custom_logo_url
--                                            into the existing tournament_events.branding jsonb
--   5. club_admin_set_player_of_tournament  — set POT name + team on tournament_events
--   6. club_admin_get_equipment_for_tournament — read catalogue for the tournament's venue
--   7. club_admin_book_equipment_for_tournament — director-side confirmed booking
--   8. club_admin_list_tournament_equipment_bookings — active bookings for a tournament
--   9. club_admin_cancel_equipment_booking  — cancel a director-created booking
--
-- Updated RPCs (same signatures):
--  10. get_tournament_public             — 5th CREATE OR REPLACE; adds branding, sponsors[],
--                                          player_of_tournament_name/team
--  11. club_admin_get_tournament         — adds sponsors[], player_of_tournament_name/team
--
-- Auth pattern for all club_admin_* RPCs:
--   auth.uid() → member_profiles → club_team_managers(is_active=true) → club_teams.club_id
--   == tournament_events.club_id
--
-- Note on branding: column was created as `branding` (not branding_config) in mig 315.
-- Note on equipment auth: venue_create_equipment_hire requires p_venue_token which directors
--   don't hold. club_admin_book_equipment_for_tournament uses the standard authenticated
--   club_team_managers pattern instead and creates bookings at status='confirmed'.

-- ─── Schema: player of tournament columns ──────────────────────────────────────

ALTER TABLE public.tournament_events
  ADD COLUMN IF NOT EXISTS player_of_tournament_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS player_of_tournament_team text DEFAULT NULL;

-- ─── Schema: tournament linkage on equipment_bookings ─────────────────────────

ALTER TABLE public.equipment_bookings
  ADD COLUMN IF NOT EXISTS tournament_event_id uuid
    REFERENCES public.tournament_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS equipment_bookings_tournament_idx
  ON public.equipment_bookings (tournament_event_id)
  WHERE tournament_event_id IS NOT NULL;

-- ─── Schema: tournament_sponsors table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tournament_sponsors (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_event_id uuid        NOT NULL REFERENCES public.tournament_events(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  logo_url            text        DEFAULT NULL,
  website_url         text        DEFAULT NULL,
  display_order       int         NOT NULL DEFAULT 0,
  active              boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tournament_sponsors_event_idx
  ON public.tournament_sponsors (tournament_event_id, active);

ALTER TABLE public.tournament_sponsors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_sponsors FROM anon, authenticated;

-- ─── 1. club_admin_add_sponsor ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_add_sponsor(
  p_tournament_event_id uuid,
  p_name                text,
  p_logo_url            text DEFAULT NULL,
  p_website_url         text DEFAULT NULL,
  p_display_order       int  DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_name       text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_sponsor_id uuid;
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

  INSERT INTO tournament_sponsors (
    tournament_event_id, name, logo_url, website_url, display_order
  )
  VALUES (
    p_tournament_event_id,
    v_name,
    NULLIF(btrim(COALESCE(p_logo_url, '')), ''),
    NULLIF(btrim(COALESCE(p_website_url, '')), ''),
    COALESCE(p_display_order, 0)
  )
  RETURNING id INTO v_sponsor_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_sponsor_added',
          'tournament_event', p_tournament_event_id::text,
          jsonb_build_object(
            'tournament_event_id', p_tournament_event_id,
            'sponsor_id',          v_sponsor_id,
            'name',                v_name
          ));

  RETURN jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_add_sponsor(uuid, text, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_add_sponsor(uuid, text, text, text, int) TO authenticated;

-- ─── 2. club_admin_list_sponsors ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_list_sponsors(
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
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

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sponsor_id',    ts.id,
      'name',          ts.name,
      'logo_url',      ts.logo_url,
      'website_url',   ts.website_url,
      'display_order', ts.display_order,
      'active',        ts.active
    ) ORDER BY ts.display_order, ts.name)
    FROM tournament_sponsors ts
    WHERE ts.tournament_event_id = p_tournament_event_id
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_list_sponsors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_list_sponsors(uuid) TO authenticated;

-- ─── 3. club_admin_remove_sponsor ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_remove_sponsor(
  p_sponsor_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_te_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Ownership guard: sponsor → tournament → club_id
  SELECT te.club_id, te.id
    INTO v_club_id, v_te_id
    FROM tournament_sponsors ts
    JOIN tournament_events te ON te.id = ts.tournament_event_id
   WHERE ts.id = p_sponsor_id
   LIMIT 1;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'sponsor_not_found' USING ERRCODE = 'P0001';
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

  DELETE FROM tournament_sponsors WHERE id = p_sponsor_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_sponsor_removed',
          'tournament_sponsor', p_sponsor_id::text,
          jsonb_build_object(
            'tournament_event_id', v_te_id,
            'sponsor_id',          p_sponsor_id
          ));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_remove_sponsor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_remove_sponsor(uuid) TO authenticated;

-- ─── 4. club_admin_set_branding ───────────────────────────────────────────────
-- Writes into the existing tournament_events.branding jsonb (column from mig 315).
-- Keys: primary_colour, secondary_colour, custom_logo_url (all nullable text).

CREATE OR REPLACE FUNCTION public.club_admin_set_branding(
  p_tournament_event_id uuid,
  p_primary_colour      text DEFAULT NULL,
  p_secondary_colour    text DEFAULT NULL,
  p_custom_logo_url     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
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

  UPDATE tournament_events
     SET branding = jsonb_build_object(
           'primary_colour',   NULLIF(btrim(COALESCE(p_primary_colour, '')), ''),
           'secondary_colour', NULLIF(btrim(COALESCE(p_secondary_colour, '')), ''),
           'custom_logo_url',  NULLIF(btrim(COALESCE(p_custom_logo_url, '')), '')
         )
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_branding_updated',
          'tournament_event', p_tournament_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_set_branding(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_set_branding(uuid, text, text, text) TO authenticated;

-- ─── 5. club_admin_set_player_of_tournament ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_set_player_of_tournament(
  p_tournament_event_id uuid,
  p_name                text,
  p_team_name           text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_name       text := NULLIF(btrim(COALESCE(p_name, '')), '');
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

  UPDATE tournament_events
     SET player_of_tournament_name = v_name,
         player_of_tournament_team = NULLIF(btrim(COALESCE(p_team_name, '')), '')
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_pot_set',
          'tournament_event', p_tournament_event_id::text,
          jsonb_build_object(
            'tournament_event_id', p_tournament_event_id,
            'name',                v_name,
            'team_name',           p_team_name
          ));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_set_player_of_tournament(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_set_player_of_tournament(uuid, text, text) TO authenticated;

-- ─── 6. club_admin_get_equipment_for_tournament ───────────────────────────────
-- Returns the active equipment catalogue at the tournament's venue.
-- Read-only. Directors can then call club_admin_book_equipment_for_tournament.

CREATE OR REPLACE FUNCTION public.club_admin_get_equipment_for_tournament(
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_venue_id   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id, venue_id INTO v_club_id, v_venue_id
    FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
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

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'equipment_id',      e.id,
      'name',              e.name,
      'category',          e.category,
      'quantity',          e.quantity,
      'default_fee_pence', e.default_fee_pence,
      'deposit_pence',     e.deposit_pence,
      'hire_unit',         e.hire_unit,
      'condition',         e.condition
    ) ORDER BY e.category, e.name)
    FROM equipment e
    WHERE e.venue_id = v_venue_id
      AND e.active = true
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_get_equipment_for_tournament(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_equipment_for_tournament(uuid) TO authenticated;

-- ─── 7. club_admin_book_equipment_for_tournament ──────────────────────────────
-- Director creates a confirmed equipment_bookings row linked to the tournament.
-- Reuses _equipment_peak_committed for availability; no charge row created
-- (directors don't bill through venue_charges — venue staff handle billing).
-- Status = 'confirmed'; venue staff can hand-out / return / cancel as normal.

CREATE OR REPLACE FUNCTION public.club_admin_book_equipment_for_tournament(
  p_tournament_event_id uuid,
  p_equipment_id        uuid,
  p_qty                 int,
  p_start_at            timestamptz,
  p_end_at              timestamptz,
  p_due_back_at         timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_venue_id   text;
  v_te_name    text;
  v_eq         record;
  v_peak       int;
  v_free       int;
  v_booking_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id, venue_id, name INTO v_club_id, v_venue_id, v_te_name
    FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
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

  SELECT * INTO v_eq FROM equipment WHERE id = p_equipment_id FOR UPDATE;
  IF v_eq.id IS NULL THEN
    RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_eq.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'equipment_not_at_venue' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_eq.active THEN
    RAISE EXCEPTION 'equipment_inactive' USING ERRCODE = 'P0001';
  END IF;

  v_peak := public._equipment_peak_committed(p_equipment_id, p_start_at, p_end_at);
  v_free  := v_eq.quantity - v_peak;
  IF p_qty > v_free THEN
    RAISE EXCEPTION 'insufficient_availability' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO equipment_bookings (
    equipment_id, venue_id, booked_by_name,
    qty, start_at, end_at, due_back_at,
    tournament_event_id, status
  )
  VALUES (
    p_equipment_id, v_venue_id, 'Tournament: ' || v_te_name,
    p_qty, p_start_at, p_end_at, p_due_back_at,
    p_tournament_event_id, 'confirmed'
  )
  RETURNING id INTO v_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_equipment_booked',
          'equipment_booking', v_booking_id::text,
          jsonb_build_object(
            'tournament_event_id', p_tournament_event_id,
            'booking_id',          v_booking_id,
            'equipment_id',        p_equipment_id,
            'qty',                 p_qty
          ));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_book_equipment_for_tournament(uuid, uuid, int, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_book_equipment_for_tournament(uuid, uuid, int, timestamptz, timestamptz, timestamptz) TO authenticated;

-- ─── 8. club_admin_list_tournament_equipment_bookings ─────────────────────────

CREATE OR REPLACE FUNCTION public.club_admin_list_tournament_equipment_bookings(
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
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

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'booking_id',     eb.id,
      'equipment_id',   eb.equipment_id,
      'equipment_name', e.name,
      'category',       e.category,
      'qty',            eb.qty,
      'start_at',       eb.start_at,
      'end_at',         eb.end_at,
      'due_back_at',    eb.due_back_at,
      'returned_at',    eb.returned_at,
      'status',         eb.status,
      'amount_pence',   eb.amount_pence
    ) ORDER BY eb.start_at, e.name)
    FROM equipment_bookings eb
    JOIN equipment e ON e.id = eb.equipment_id
    WHERE eb.tournament_event_id = p_tournament_event_id
      AND eb.status NOT IN ('cancelled', 'declined')
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_list_tournament_equipment_bookings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_list_tournament_equipment_bookings(uuid) TO authenticated;

-- ─── 9. club_admin_cancel_equipment_booking ───────────────────────────────────
-- Directors can only cancel bookings they created (tournament_event_id link required).
-- Cannot cancel a booking that is already out, returned, or cancelled.

CREATE OR REPLACE FUNCTION public.club_admin_cancel_equipment_booking(
  p_booking_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_status     text;
  v_te_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Ownership: booking must have tournament_event_id; traverse to club_id
  SELECT eb.status, eb.tournament_event_id, te.club_id
    INTO v_status, v_te_id, v_club_id
    FROM equipment_bookings eb
    JOIN tournament_events te ON te.id = eb.tournament_event_id
   WHERE eb.id = p_booking_id
   LIMIT 1;

  IF v_club_id IS NULL THEN
    -- No tournament link means this booking was not created by a director
    RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001';
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

  IF v_status IN ('out', 'returned', 'cancelled') THEN
    RAISE EXCEPTION 'cannot_cancel' USING ERRCODE = 'P0001';
  END IF;

  UPDATE equipment_bookings SET status = 'cancelled' WHERE id = p_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_equipment_booking_cancelled',
          'equipment_booking', p_booking_id::text,
          jsonb_build_object(
            'tournament_event_id', v_te_id,
            'booking_id',          p_booking_id
          ));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_cancel_equipment_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_cancel_equipment_booking(uuid) TO authenticated;

-- ─── 10. get_tournament_public — 5th CREATE OR REPLACE ────────────────────────
-- Adds: branding, sponsors[], player_of_tournament_name, player_of_tournament_team.
-- All other sections preserved verbatim from mig 326.
-- Signature unchanged: get_tournament_public(p_slug text).

CREATE OR REPLACE FUNCTION public.get_tournament_public(
  p_slug text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_te            record;
  v_points_config jsonb;
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

  v_points_config := v_te.points_config;

  RETURN jsonb_build_object(
    'ok',                       true,
    'name',                     v_te.name,
    'slug',                     v_te.slug,
    'status',                   v_te.status,
    'event_date',               v_te.event_date,
    'event_end_date',           v_te.event_end_date,
    'venue_name',               v_te.venue_name,
    'club_name',                v_te.club_name,
    'entry_fee_pence',          v_te.entry_fee_pence,
    'entry_fee_payer',          v_te.entry_fee_payer,
    'registration_deadline',    v_te.registration_deadline,
    -- ── Phase 7 Commercial (NEW) ────────────────────────────────────────────────
    'branding',                 v_te.branding,
    'player_of_tournament_name', v_te.player_of_tournament_name,
    'player_of_tournament_team', v_te.player_of_tournament_team,
    'sponsors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sponsor_id',  ts.id,
        'name',        ts.name,
        'logo_url',    ts.logo_url,
        'website_url', ts.website_url
      ) ORDER BY ts.display_order, ts.name)
      FROM tournament_sponsors ts
      WHERE ts.tournament_event_id = v_te.id
        AND ts.active = true
    ), '[]'::jsonb),
    -- ── competitions with registered teams (unchanged from mig 326) ─────────────
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
    -- ── fixtures ─────────────────────────────────────────────────────────────────
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
        'current_period',   fx.current_period,
        'de_bracket',       fx.de_bracket
      ) ORDER BY fx.scheduled_date NULLS LAST, fx.kickoff_time NULLS LAST, fx.week_number, fx.id)
      FROM fixtures fx
      JOIN competitions comp    ON comp.id = fx.competition_id
      LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
      LEFT JOIN competition_teams at2 ON at2.id = fx.away_competition_team_id
      LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    -- ── knockout / DE fixtures ────────────────────────────────────────────────────
    'knockout_fixtures', COALESCE((
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
        'home_team_name',   COALESCE(ht.team_name, hf_home.team_name, hf_away.team_name),
        'away_team_name',   COALESCE(at2.team_name, af_home.team_name, af_away.team_name),
        'home_score',       fx.home_score,
        'away_score',       fx.away_score,
        'status',           fx.status,
        'current_period',   fx.current_period,
        'de_bracket',       fx.de_bracket
      ) ORDER BY fx.week_number NULLS LAST, fx.id)
      FROM fixtures fx
      JOIN competitions comp         ON comp.id = fx.competition_id
      LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
      LEFT JOIN competition_teams at2 ON at2.id = fx.away_competition_team_id
      LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
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
    -- ── standings ─────────────────────────────────────────────────────────────────
    'standings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id',   comp.id,
        'competition_name', comp.name,
        'knockout_seeded',  (comp.config->>'knockout_seeded')::boolean,
        'rows', COALESCE((
          SELECT jsonb_agg(row ORDER BY pts DESC, gd DESC, gf DESC, team_name ASC)
          FROM (
            SELECT
              ct.id::text AS team_id,
              ct.team_name,
              ct.group_label,
              ct.group_rank,
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
              AND fx.knockout_home_feeder_id IS NULL
              AND fx.knockout_away_feeder_id IS NULL
              AND fx.de_bracket IS NULL
            WHERE ct.competition_id = comp.id
              AND ct.status = 'active'
            GROUP BY ct.id, ct.team_name, ct.group_label, ct.group_rank
          ) row
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    -- ── performance events with results (from mig 326) ────────────────────────────
    'performance_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_id',         pe.id,
        'name',             pe.name,
        'measurement_type', pe.measurement_type,
        'unit',             pe.unit,
        'category',         pe.category,
        'scheduled_time',   pe.scheduled_time,
        'display_order',    pe.display_order,
        'results', COALESCE((
          WITH best AS (
            SELECT
              pr.athlete_name,
              pr.competition_team_id,
              ct.team_name,
              CASE WHEN pe.measurement_type = 'time_asc'
                   THEN MIN(CASE WHEN pr.status = 'recorded' THEN pr.value END)
                   ELSE MAX(CASE WHEN pr.status = 'recorded' THEN pr.value END)
              END AS best_value
            FROM performance_results pr
            JOIN competition_teams ct ON ct.id = pr.competition_team_id
            WHERE pr.performance_event_id = pe.id
              AND pr.status = 'recorded'
            GROUP BY pr.athlete_name, pr.competition_team_id, ct.team_name
          ),
          ranked AS (
            SELECT *,
              CASE WHEN pe.measurement_type = 'time_asc'
                   THEN RANK() OVER (ORDER BY best_value ASC)
                   ELSE RANK() OVER (ORDER BY best_value DESC)
              END AS finish_rank
            FROM best
            WHERE best_value IS NOT NULL
          )
          SELECT jsonb_agg(jsonb_build_object(
            'athlete_name', r.athlete_name,
            'team_name',    r.team_name,
            'value',        r.best_value,
            'rank',         r.finish_rank
          ) ORDER BY r.finish_rank, r.athlete_name)
          FROM ranked r
        ), '[]'::jsonb)
      ) ORDER BY COALESCE(pe.display_order, 9999), pe.scheduled_time NULLS LAST, pe.name)
      FROM performance_events pe
      WHERE pe.tournament_event_id = v_te.id
    ), '[]'::jsonb),
    -- ── performance standings (from mig 326) ──────────────────────────────────────
    'performance_standings', COALESCE((
      WITH event_results AS (
        SELECT
          pe.id AS event_id,
          pe.measurement_type,
          pr.competition_team_id,
          pr.athlete_name,
          CASE WHEN pe.measurement_type = 'time_asc'
               THEN MIN(CASE WHEN pr.status = 'recorded' THEN pr.value END)
               ELSE MAX(CASE WHEN pr.status = 'recorded' THEN pr.value END)
          END AS best_value
        FROM performance_events pe
        JOIN performance_results pr ON pr.performance_event_id = pe.id
        WHERE pe.tournament_event_id = v_te.id
          AND pr.status = 'recorded'
        GROUP BY pe.id, pe.measurement_type, pr.competition_team_id, pr.athlete_name
      ),
      ranked_results AS (
        SELECT
          er.*,
          CASE WHEN er.measurement_type = 'time_asc'
               THEN RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value ASC)
               ELSE RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value DESC)
          END AS finish_rank
        FROM event_results er
        WHERE er.best_value IS NOT NULL
      ),
      team_points AS (
        SELECT
          rr.competition_team_id,
          ct.team_name,
          SUM(COALESCE((v_points_config->>(rr.finish_rank::text))::int, 0)) AS total_points,
          COUNT(CASE WHEN rr.finish_rank = 1 THEN 1 END)::int AS gold,
          COUNT(CASE WHEN rr.finish_rank = 2 THEN 1 END)::int AS silver,
          COUNT(CASE WHEN rr.finish_rank = 3 THEN 1 END)::int AS bronze,
          COUNT(DISTINCT rr.event_id)::int AS events_entered
        FROM ranked_results rr
        JOIN competition_teams ct ON ct.id = rr.competition_team_id
        GROUP BY rr.competition_team_id, ct.team_name
      )
      SELECT jsonb_agg(jsonb_build_object(
        'competition_team_id', tp.competition_team_id,
        'team_name',           tp.team_name,
        'points',              tp.total_points,
        'gold',                tp.gold,
        'silver',              tp.silver,
        'bronze',              tp.bronze,
        'events_entered',      tp.events_entered
      ) ORDER BY tp.total_points DESC, tp.gold DESC, tp.silver DESC, tp.bronze DESC, tp.team_name ASC)
      FROM team_points tp
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_tournament_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_public(text) TO anon, authenticated;

-- ─── 11. club_admin_get_tournament — updated ──────────────────────────────────
-- Adds sponsors[], player_of_tournament_name, player_of_tournament_team.
-- All other fields preserved verbatim from mig 324.

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
    -- ── Phase 7 Commercial (NEW) ────────────────────────────────────────────────
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
    -- ── performance events (from mig 324) ───────────────────────────────────────
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
    -- ── competitions with teams (from mig 324) ───────────────────────────────────
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
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_get_tournament(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_get_tournament(text) TO authenticated;
