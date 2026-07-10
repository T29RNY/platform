-- 537_class_types_expose_camp_flags.sql — P9.4 support: surface the camp flags on the
-- venue operator's class-type catalogue.
--
-- venue_list_class_types (mig 360) selects a fixed column list that predates the camp columns
-- (mig 534), so the ClassesView "Camp" pill (reads t.is_camp / t.audience) had no data. ADDITIVE
-- return-shape change: add is_camp, audience, target_team_id to the row. CREATE OR REPLACE, same
-- signature/grants, STABLE SECDEF, search_path pinned. Existing consumers read the same keys —
-- unaffected (the new keys are ignored by anything that doesn't look for them).

CREATE OR REPLACE FUNCTION public.venue_list_class_types(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.is_active DESC, x.name), '[]'::jsonb) INTO v_result FROM (
    SELECT ct.id, ct.venue_id, ct.space_id, sp.name AS space_name, ct.name, ct.description,
           ct.category, ct.duration_minutes, ct.default_capacity, ct.cancellation_cutoff_hours,
           ct.first_session_free, ct.is_sparring, ct.members_only, ct.is_active, ct.created_at,
           ct.is_camp, ct.audience, ct.target_team_id,
           (SELECT count(*) FROM public.venue_class_sessions cs
             WHERE cs.class_type_id = ct.id AND cs.status = 'scheduled' AND cs.starts_at >= now())::int AS upcoming_session_count
    FROM public.venue_class_types ct
    JOIN public.venue_spaces sp ON sp.id = ct.space_id
    WHERE ct.venue_id = v_caller.venue_id
  ) x;
  RETURN v_result;
END;
$function$;
