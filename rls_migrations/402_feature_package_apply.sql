-- Migration 402 — Venue OS nav Phase 3: package presets (bulk flag apply).
--
-- Phase 2 (mig 400) gave per-flag toggles. Phase 3 adds named PRESETS — "apply
-- this whole bundle at once" — as the operator shortcut. Per the locked design
-- (MODULAR_PLATFORM_HANDOFF.md Epic A): packages are SHORTCUTS, flags are TRUTH.
-- So a preset is nothing but a target flag-set; it adds NO data model. The preset
-- catalogue lives CLIENT-SIDE (apps/venue FeaturesView PACKAGES const) so renaming
-- or re-bundling is a one-line edit, never a migration — and the commercial
-- tier/pricing decision stays deferred (no `tier` enum, no hardcoded behaviour).
--
-- The server side is just two generic atomic "set these flags" RPCs (so a preset
-- applies in ONE transaction with ONE audit row and the dependency graph enforced
-- server-side — better than N chatty per-flag calls that could partially apply):
--   venue_set_venue_features(token, jsonb)            — facility flags
--   venue_set_club_features(token, club_id, jsonb)    — org flags + dependency closure
--
-- Both mirror the mig-400 invariants exactly: manage_facility-gated, audited
-- (Hard Rule #9), a row written only to hold an OFF and pruned once all-on
-- (no-row=on preserved), and GRANTed to anon+authenticated (the shared
-- venue_admin_token backdoor calls every venue_* RPC as anon — auth is enforced
-- INSIDE via resolve_venue_caller + _venue_has_cap; the Phase-2 lesson).
--
-- Only keys PRESENT in the jsonb are changed (absent keys keep their current
-- value), so a preset that omits a flag leaves it untouched. Dependency closure:
-- if the resulting Coaching is on, Memberships is forced on too (same rule the
-- per-flag RPC enforces) — so a preset can never land an invalid state.
--
-- Consumers (Hard Rule #14): apps/venue FeaturesView preset buttons + wrappers
-- venueSetVenueFeatures / venueSetClubFeatures. Next free mig = 403.

-- ── 1. Bulk-apply VENUE (facility) features ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_venue_features(p_venue_token text, p_flags jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_bad      text;
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

  IF p_flags IS NULL OR jsonb_typeof(p_flags) <> 'object' THEN
    RAISE EXCEPTION 'flags_required' USING ERRCODE = 'P0001';
  END IF;
  -- Reject unknown keys (catches a typo'd flag rather than silently ignoring it).
  SELECT k INTO v_bad FROM jsonb_object_keys(p_flags) k
   WHERE k NOT IN ('bookings','spaces','room_hire','equipment') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_feature' USING ERRCODE = 'P0001', DETAIL = v_bad;
  END IF;

  INSERT INTO public.venue_features (venue_id) VALUES (v_venue_id)
    ON CONFLICT (venue_id) DO NOTHING;

  UPDATE public.venue_features SET
    bookings   = COALESCE((p_flags->>'bookings')::boolean,  bookings),
    spaces     = COALESCE((p_flags->>'spaces')::boolean,    spaces),
    room_hire  = COALESCE((p_flags->>'room_hire')::boolean, room_hire),
    equipment  = COALESCE((p_flags->>'equipment')::boolean, equipment),
    updated_at = now()
  WHERE venue_id = v_venue_id
  RETURNING * INTO v_row;

  DELETE FROM public.venue_features
  WHERE venue_id = v_venue_id
    AND bookings AND spaces AND room_hire AND equipment;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_features_set', 'venue_feature', v_venue_id,
          jsonb_build_object('venue_id', v_venue_id, 'flags', p_flags));

  RETURN jsonb_build_object(
    'ok', true, 'scope', 'venue',
    'applied', jsonb_build_object(
      'bookings',  COALESCE(v_row.bookings,  true),
      'spaces',    COALESCE(v_row.spaces,    true),
      'room_hire', COALESCE(v_row.room_hire, true),
      'equipment', COALESCE(v_row.equipment, true)));
END;
$function$;

REVOKE ALL    ON FUNCTION public.venue_set_venue_features(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.venue_set_venue_features(text, jsonb) TO anon, authenticated;

-- ── 2. Bulk-apply CLUB (org) features + dependency closure ───────────────────
CREATE OR REPLACE FUNCTION public.venue_set_club_features(p_venue_token text, p_club_id text, p_flags jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller  record;
  v_venue_id text;
  v_linked  boolean;
  v_bad     text;
  v_cur     record;
  t_mem boolean; t_comp boolean; t_coach boolean; t_tourn boolean; t_pub boolean;
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
  IF p_flags IS NULL OR jsonb_typeof(p_flags) <> 'object' THEN
    RAISE EXCEPTION 'flags_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_flags) k
   WHERE k NOT IN ('memberships','competition','coaching','tournaments','public_web') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_feature' USING ERRCODE = 'P0001', DETAIL = v_bad;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.club_venues cv
                 WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_features (club_id) VALUES (p_club_id)
    ON CONFLICT (club_id) DO NOTHING;
  SELECT * INTO v_cur FROM public.club_features WHERE club_id = p_club_id;

  -- Target = present keys override current; absent keys unchanged.
  t_mem   := COALESCE((p_flags->>'memberships')::boolean, v_cur.memberships);
  t_comp  := COALESCE((p_flags->>'competition')::boolean, v_cur.competition);
  t_coach := COALESCE((p_flags->>'coaching')::boolean,    v_cur.coaching);
  t_tourn := COALESCE((p_flags->>'tournaments')::boolean, v_cur.tournaments);
  t_pub   := COALESCE((p_flags->>'public_web')::boolean,  v_cur.public_web);
  -- Dependency closure: Coaching requires Memberships (mig 400 graph). A preset
  -- can never land an invalid state — if Coaching ends on, Memberships is forced on.
  IF t_coach THEN t_mem := true; END IF;

  UPDATE public.club_features SET
    memberships = t_mem, competition = t_comp, coaching = t_coach,
    tournaments = t_tourn, public_web = t_pub, updated_at = now()
  WHERE club_id = p_club_id;

  DELETE FROM public.club_features
  WHERE club_id = p_club_id
    AND memberships AND competition AND coaching AND tournaments AND public_web;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_features_set', 'club_feature', p_club_id,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', p_club_id, 'flags', p_flags,
                             'coaching_forced_memberships',
                             (t_coach AND COALESCE((p_flags->>'memberships')::boolean, true) = false)));

  RETURN jsonb_build_object(
    'ok', true, 'scope', 'club', 'club_id', p_club_id,
    'applied', jsonb_build_object(
      'memberships', t_mem, 'competition', t_comp, 'coaching', t_coach,
      'tournaments', t_tourn, 'public_web', t_pub));
END;
$function$;

REVOKE ALL    ON FUNCTION public.venue_set_club_features(text, text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.venue_set_club_features(text, text, jsonb) TO anon, authenticated;
