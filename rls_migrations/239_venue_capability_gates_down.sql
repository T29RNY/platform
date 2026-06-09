-- 239_venue_capability_gates_down.sql
-- Revert Phase 4: strip the injected capability guard line from each gated RPC,
-- restoring the pre-239 body (resolve preamble straight into the rest).

DO $mig$
DECLARE
  v_fn  record;
  v_def text;
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'venue_void_payment','venue_void_charge','venue_set_charge_due',
        'venue_update_booking_settings','venue_add_pitch','venue_update_pitch',
        'venue_add_ref','venue_update_ref','venue_update_display_config',
        'venue_add_staff','venue_update_staff'
      )
  LOOP
    v_def := pg_get_functiondef(v_fn.oid);
    IF position('_venue_has_cap' IN v_def) = 0 THEN CONTINUE; END IF;
    -- remove the single injected guard line (and its trailing newline)
    v_def := regexp_replace(
      v_def,
      '\n  IF NOT public\._venue_has_cap\(v_caller\.role, v_caller\.caps_grant, v_caller\.caps_deny, ''[a-z_]+''\) THEN RAISE EXCEPTION ''insufficient_role'' USING ERRCODE = ''P0001''; END IF;',
      '');
    EXECUTE v_def;
  END LOOP;
END $mig$;
