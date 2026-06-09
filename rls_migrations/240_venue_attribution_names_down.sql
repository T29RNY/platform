-- 240_venue_attribution_names_down.sql
-- Revert Phase 5: strip reported_by_name from venue_get_state, drop the helper.

DO $mig$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc
   WHERE proname = 'venue_get_state' AND pronamespace = 'public'::regnamespace;
  v_def := pg_get_functiondef(v_oid);
  IF position('reported_by_name' IN v_def) > 0 THEN
    v_def := replace(
      v_def,
      $q$'reported_by', i.reported_by, 'reported_by_name', public._venue_actor_name(i.reported_by), 'created_at', i.created_at)$q$,
      $q$'reported_by', i.reported_by, 'created_at', i.created_at)$q$
    );
    EXECUTE v_def;
  END IF;
END $mig$;

DROP FUNCTION IF EXISTS public._venue_actor_name(uuid);
