-- Migration 400 — Venue OS nav Phase 2 (A + B + C): operator feature toggles.
--
-- Phase 1 (mig 399) shipped the flag stores (venue_features / club_features), the
-- merged reader (get_venue_feature_flags), and the 74 server-side guards — all
-- DEFAULT-ALL-ON, so nothing is hidden until a flag is flipped off. There was no
-- way to flip a flag. This migration adds that, with three pieces:
--
--   A — Operator toggle write RPCs (venue_set_venue_feature / venue_set_club_feature)
--       + a one-shot settings read (venue_get_feature_settings). manage_facility-
--       gated (same cap as grading/bouts), audited (Hard Rule #9). A row is written
--       ONLY when a feature is OFF — turning everything back on prunes the row, so the
--       no-row=on / zero-backfill invariant from mig 399 is preserved exactly.
--
--   B — Dependency graph, enforced server-side in venue_set_club_feature. Edges
--       (locked DECISIONS s179): Memberships→Payments, Coaching→Memberships→Payments,
--       paid Tournaments→Payments. Payments is always-on core (NOT a flag), so among
--       the real toggleable flags the only edge that bites is Coaching→Memberships:
--       enabling Coaching auto-enables Memberships; disabling Memberships is BLOCKED
--       while Coaching is on (raise 'dependency_required'). The Payments edges are
--       satisfied-by-construction (Payments can never be turned off) and are recorded
--       here as comments so a future `payments` flag drops in without rework.
--
--   C — Discipline axis (relevance, SECOND gate, kept separate from the purchased
--       flag): get_venue_feature_flags is extended to also return `disciplines` (the
--       distinct clubs.discipline across every club at the venue) so the venue rail
--       can hide items irrelevant to the venue's disciplines (football never sees
--       Classes/Trainers; gym never sees Leagues/Cups) — computed client-side in
--       Dashboard.jsx, mirroring disciplineLabels semantics. No new server gate; the
--       discipline axis never blocks a write (a flag does), it only hides nav.
--
-- Consumers (Hard Rule #14): apps/venue FeaturesView.jsx (the toggle screen) +
-- Dashboard rail (disciplines from the extended reader). Wrappers venueGetFeatureSettings
-- / venueSetVenueFeature / venueSetClubFeature in packages/core.

-- ── 1. Read: full feature settings for the toggle screen ─────────────────────
-- Returns the venue's facility flags (effective, default true) + one row per club
-- operating at the venue with its discipline + that club's org flags (effective).
-- manage_facility-gated: the toggle screen is operator-only.
CREATE OR REPLACE FUNCTION public.venue_get_feature_settings(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_venue    jsonb;
  v_clubs    jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  -- Venue facility flags (missing row → all true).
  SELECT jsonb_build_object(
           'bookings',  COALESCE(vf.bookings,  true),
           'spaces',    COALESCE(vf.spaces,    true),
           'room_hire', COALESCE(vf.room_hire, true),
           'equipment', COALESCE(vf.equipment, true))
    INTO v_venue
  FROM (SELECT v_venue_id AS venue_id) base
  LEFT JOIN public.venue_features vf ON vf.venue_id = base.venue_id;

  -- Each club at the venue with its discipline + org flags (missing row → all true).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'club_id',     c.id,
             'name',        c.name,
             'discipline',  c.discipline,
             'memberships', COALESCE(cf.memberships, true),
             'competition', COALESCE(cf.competition, true),
             'coaching',    COALESCE(cf.coaching,    true),
             'tournaments', COALESCE(cf.tournaments, true),
             'public_web',  COALESCE(cf.public_web,  true)
           ) ORDER BY c.name), '[]'::jsonb)
    INTO v_clubs
  FROM public.club_venues cv
  JOIN public.clubs c            ON c.id = cv.club_id
  LEFT JOIN public.club_features cf ON cf.club_id = c.id
  WHERE cv.venue_id = v_venue_id;

  RETURN jsonb_build_object('venue', v_venue, 'clubs', v_clubs);
END;
$function$;

REVOKE ALL    ON FUNCTION public.venue_get_feature_settings(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.venue_get_feature_settings(text) TO anon, authenticated;
-- anon GRANT is REQUIRED, not a leak: the shared venue_admin_token backdoor
-- (dev/demo + legacy) calls every venue_* RPC as anon, passing the token as an
-- arg — not as an auth session. Authorization is enforced INSIDE via
-- resolve_venue_caller (needs a valid token or auth.uid() staff row) +
-- _venue_has_cap('manage_facility'); an anon caller with no valid token gets
-- invalid_venue_token. Same grant shape as every venue write RPC (e.g. grading,
-- mig 357). Locking to authenticated-only breaks the backdoor.

-- ── 2. Write: set a VENUE (facility) feature ─────────────────────────────────
-- Facility features (bookings/spaces/room_hire/equipment) have NO dependencies.
-- A row is materialised only to hold an OFF; once all four are on again the row is
-- pruned so no-row=on holds.
CREATE OR REPLACE FUNCTION public.venue_set_venue_feature(
  p_venue_token text,
  p_feature     text,
  p_enabled     boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_row      record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_feature IS NULL OR p_feature NOT IN ('bookings','spaces','room_hire','equipment') THEN
    RAISE EXCEPTION 'invalid_feature' USING ERRCODE = 'P0001';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = 'P0001';
  END IF;

  -- Materialise an all-true row if none exists, then set the one column.
  INSERT INTO public.venue_features (venue_id) VALUES (v_venue_id)
    ON CONFLICT (venue_id) DO NOTHING;

  UPDATE public.venue_features SET
    bookings   = CASE WHEN p_feature = 'bookings'  THEN p_enabled ELSE bookings  END,
    spaces     = CASE WHEN p_feature = 'spaces'    THEN p_enabled ELSE spaces    END,
    room_hire  = CASE WHEN p_feature = 'room_hire' THEN p_enabled ELSE room_hire END,
    equipment  = CASE WHEN p_feature = 'equipment' THEN p_enabled ELSE equipment END,
    updated_at = now()
  WHERE venue_id = v_venue_id
  RETURNING * INTO v_row;

  -- Prune the row once everything is on again (restore no-row=on).
  DELETE FROM public.venue_features
  WHERE venue_id = v_venue_id
    AND bookings AND spaces AND room_hire AND equipment;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_feature_toggled', 'venue_feature', v_venue_id,
          jsonb_build_object('venue_id', v_venue_id, 'feature', p_feature, 'enabled', p_enabled));

  RETURN jsonb_build_object(
    'ok', true, 'scope', 'venue', 'feature', p_feature, 'enabled', p_enabled,
    'applied', jsonb_build_object(
      'bookings',  COALESCE(v_row.bookings,  true),
      'spaces',    COALESCE(v_row.spaces,    true),
      'room_hire', COALESCE(v_row.room_hire, true),
      'equipment', COALESCE(v_row.equipment, true)));
END;
$function$;

REVOKE ALL    ON FUNCTION public.venue_set_venue_feature(text, text, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION public.venue_set_venue_feature(text, text, boolean) TO anon, authenticated;

-- ── 3. Write: set a CLUB (org) feature — with the dependency graph (B) ────────
-- Edges (DECISIONS s179): Coaching→Memberships(→Payments); Memberships→Payments;
-- paid Tournaments→Payments. Payments is always-on core (no flag), so among the
-- real toggleable flags only Coaching→Memberships is enforceable:
--   • enabling Coaching auto-enables Memberships;
--   • disabling Memberships is blocked while Coaching is on.
CREATE OR REPLACE FUNCTION public.venue_set_club_feature(
  p_venue_token text,
  p_club_id     text,
  p_feature     text,
  p_enabled     boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_linked   boolean;
  v_coaching boolean;
  v_row      record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'club_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_feature IS NULL OR p_feature NOT IN ('memberships','competition','coaching','tournaments','public_web') THEN
    RAISE EXCEPTION 'invalid_feature' USING ERRCODE = 'P0001';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  -- Materialise an all-true row if none exists (so dependency reads see effective state).
  INSERT INTO public.club_features (club_id) VALUES (p_club_id)
    ON CONFLICT (club_id) DO NOTHING;

  -- Dependency block: cannot disable Memberships while Coaching is enabled.
  IF p_feature = 'memberships' AND NOT p_enabled THEN
    SELECT coaching INTO v_coaching FROM public.club_features WHERE club_id = p_club_id;
    IF COALESCE(v_coaching, true) THEN
      RAISE EXCEPTION 'dependency_required'
        USING ERRCODE = 'P0001',
              DETAIL  = 'coaching_requires_memberships';
    END IF;
  END IF;

  -- Apply the change. Enabling Coaching auto-enables its prerequisite Memberships.
  UPDATE public.club_features SET
    memberships = CASE
                    WHEN p_feature = 'memberships'             THEN p_enabled
                    WHEN p_feature = 'coaching' AND p_enabled  THEN true   -- prereq auto-enable
                    ELSE memberships END,
    coaching    = CASE WHEN p_feature = 'coaching'    THEN p_enabled ELSE coaching    END,
    competition = CASE WHEN p_feature = 'competition' THEN p_enabled ELSE competition END,
    tournaments = CASE WHEN p_feature = 'tournaments' THEN p_enabled ELSE tournaments END,
    public_web  = CASE WHEN p_feature = 'public_web'  THEN p_enabled ELSE public_web  END,
    updated_at  = now()
  WHERE club_id = p_club_id
  RETURNING * INTO v_row;

  -- Prune the row once everything is on again (restore no-row=on).
  DELETE FROM public.club_features
  WHERE club_id = p_club_id
    AND memberships AND competition AND coaching AND tournaments AND public_web;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_feature_toggled', 'club_feature', p_club_id,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', p_club_id,
                             'feature', p_feature, 'enabled', p_enabled,
                             'auto_enabled_memberships',
                             (p_feature = 'coaching' AND p_enabled)));

  RETURN jsonb_build_object(
    'ok', true, 'scope', 'club', 'club_id', p_club_id, 'feature', p_feature, 'enabled', p_enabled,
    'applied', jsonb_build_object(
      'memberships', COALESCE(v_row.memberships, true),
      'competition', COALESCE(v_row.competition, true),
      'coaching',    COALESCE(v_row.coaching,    true),
      'tournaments', COALESCE(v_row.tournaments, true),
      'public_web',  COALESCE(v_row.public_web,  true)));
END;
$function$;

REVOKE ALL    ON FUNCTION public.venue_set_club_feature(text, text, text, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION public.venue_set_club_feature(text, text, text, boolean) TO anon, authenticated;

-- ── 4. Extend the merged reader with `disciplines` (axis C) ──────────────────
-- Adds the distinct set of clubs.discipline across every club at the venue so the
-- rail can apply the discipline-relevance gate. Everything else is byte-identical
-- to the mig-399 body (default-all-on union preserved).
CREATE OR REPLACE FUNCTION public.get_venue_feature_flags(p_credential text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_vf       record;
  v_cf       record;
  v_disc     jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_credential);
  v_venue_id := v_caller.venue_id;

  IF v_venue_id IS NULL THEN
    RETURN jsonb_build_object(
      'bookings', true, 'spaces', true, 'room_hire', true, 'equipment', true,
      'memberships', true, 'competition', true, 'coaching', true,
      'tournaments', true, 'public_web', true,
      'disciplines', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(vf.bookings,  true) AS bookings,
         COALESCE(vf.spaces,    true) AS spaces,
         COALESCE(vf.room_hire, true) AS room_hire,
         COALESCE(vf.equipment, true) AS equipment
    INTO v_vf
  FROM (SELECT v_venue_id AS venue_id) base
  LEFT JOIN public.venue_features vf ON vf.venue_id = base.venue_id;

  SELECT COALESCE(bool_or(COALESCE(cf.memberships, true)), true) AS memberships,
         COALESCE(bool_or(COALESCE(cf.competition, true)), true) AS competition,
         COALESCE(bool_or(COALESCE(cf.coaching,    true)), true) AS coaching,
         COALESCE(bool_or(COALESCE(cf.tournaments, true)), true) AS tournaments,
         COALESCE(bool_or(COALESCE(cf.public_web,  true)), true) AS public_web
    INTO v_cf
  FROM public.club_venues cv
  LEFT JOIN public.club_features cf ON cf.club_id = cv.club_id
  WHERE cv.venue_id = v_venue_id;

  -- Distinct, non-null disciplines of every club operating at this venue.
  SELECT COALESCE(jsonb_agg(DISTINCT c.discipline) FILTER (WHERE c.discipline IS NOT NULL), '[]'::jsonb)
    INTO v_disc
  FROM public.club_venues cv
  JOIN public.clubs c ON c.id = cv.club_id
  WHERE cv.venue_id = v_venue_id;

  RETURN jsonb_build_object(
    'bookings',    v_vf.bookings,
    'spaces',      v_vf.spaces,
    'room_hire',   v_vf.room_hire,
    'equipment',   v_vf.equipment,
    'memberships', COALESCE(v_cf.memberships, true),
    'competition', COALESCE(v_cf.competition, true),
    'coaching',    COALESCE(v_cf.coaching,    true),
    'tournaments', COALESCE(v_cf.tournaments, true),
    'public_web',  COALESCE(v_cf.public_web,  true),
    'disciplines', v_disc
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_venue_feature_flags(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_venue_feature_flags(text) TO anon, authenticated;
