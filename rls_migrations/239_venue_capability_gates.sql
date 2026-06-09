-- 239_venue_capability_gates.sql
--
-- Venue staff logins — Phase 4 (server-side capability enforcement). Until now
-- the venue screens HIDE controls a role can't use, but the underlying RPCs did
-- not REFUSE a too-low role. This injects the capability gate into the ~11 venue
-- write RPCs that map to a gated capability (DECISIONS.md "VENUE LOGIN
-- CREDENTIALS → Session 78"). Everything else (bookings, record-payment,
-- incidents, rota assign, nudge, full league/cup admin) stays open to any
-- logged-in member, by design.
--
-- Gate ⇆ capability:
--   reverse_money    → venue_void_payment, venue_void_charge, venue_set_charge_due
--   booking_settings → venue_update_booking_settings
--   manage_facility  → venue_add_pitch, venue_update_pitch, venue_add_ref,
--                      venue_update_ref, venue_update_display_config
--   staff_directory  → venue_add_staff, venue_update_staff
--   (manage_logins is already enforced inside the mig-238 RPCs.)
--
-- Mechanism: every one of these RPCs resolves the caller with the identical
-- preamble ending `v_venue_id := v_caller.venue_id;`. We read each body verbatim
-- (pg_get_functiondef — no hand transcription) and inject one guard line right
-- after that anchor, then CREATE OR REPLACE. Idempotent: skips any body that
-- already references _venue_has_cap. The shared-token backdoor + platform_admin
-- resolve as role 'owner', so they pass every gate (unchanged behaviour).

DO $mig$
DECLARE
  v_map  jsonb := jsonb_build_object(
    'venue_void_payment',          'reverse_money',
    'venue_void_charge',           'reverse_money',
    'venue_set_charge_due',        'reverse_money',
    'venue_update_booking_settings','booking_settings',
    'venue_add_pitch',             'manage_facility',
    'venue_update_pitch',          'manage_facility',
    'venue_add_ref',               'manage_facility',
    'venue_update_ref',            'manage_facility',
    'venue_update_display_config', 'manage_facility',
    'venue_add_staff',             'staff_directory',
    'venue_update_staff',          'staff_directory'
  );
  v_fn    record;
  v_def   text;
  v_guard text;
  v_anchor constant text := '  v_venue_id := v_caller.venue_id;';
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (SELECT jsonb_object_keys(v_map))
  LOOP
    v_def := pg_get_functiondef(v_fn.oid);

    -- idempotent: already gated?
    IF position('_venue_has_cap' IN v_def) > 0 THEN CONTINUE; END IF;

    -- sanity: the anchor must appear exactly once
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'anchor not unique in %', v_fn.proname;
    END IF;

    v_guard := v_anchor || chr(10)
      || '  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, '
      || quote_literal(v_map->>v_fn.proname)
      || ') THEN RAISE EXCEPTION ''insufficient_role'' USING ERRCODE = ''P0001''; END IF;';

    v_def := replace(v_def, v_anchor, v_guard);
    EXECUTE v_def;
  END LOOP;
END $mig$;
