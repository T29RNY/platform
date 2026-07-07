-- 496_tournament_report_dedup_ratelimit_down.sql
-- Revert tournament_report to the mig-495 body (no dedup, no burst guard).
CREATE OR REPLACE FUNCTION public.tournament_report(p_slug text, p_reason text, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_te_id uuid;
  v_venue text;
  v_note  text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('offensive','inappropriate','spam','impersonation','other') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    v_note := left(v_note, 500);
  END IF;

  SELECT id, venue_id INTO v_te_id, v_venue FROM public.tournament_events WHERE slug = p_slug LIMIT 1;
  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tournament_reports (tournament_event_id, reason, reporter_note, reporter_uid)
  VALUES (v_te_id, p_reason, v_note, auth.uid());

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue, auth.uid(), 'system', COALESCE(auth.uid()::text, 'public'),
    'tournament_reported', 'tournament_event', v_te_id::text,
    jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.tournament_report(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tournament_report(text, text, text) TO anon, authenticated;
