-- 496_tournament_report_dedup_ratelimit.sql
-- UGC-moderation hardening (#3): add dedup + a burst guard to tournament_report.
-- Transcribed verbatim from the mig-495 body; the only additions are (a) a per-uid
-- dedup for signed-in reporters and (b) a per-tournament rolling-window burst cap
-- that protects the moderation queue from anonymous flooding. Same signature as
-- mig 495 → CREATE OR REPLACE (no new overload). Grants unchanged (anon+auth).
CREATE OR REPLACE FUNCTION public.tournament_report(p_slug text, p_reason text, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_te_id uuid;
  v_venue text;
  v_uid   uuid := auth.uid();
  v_note  text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_recent int;
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

  -- Dedup: a signed-in reporter files at most once per tournament (idempotent).
  IF v_uid IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.tournament_reports
       WHERE tournament_event_id = v_te_id AND reporter_uid = v_uid) THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  -- Burst guard (covers anon, who have no stable identity): cap at 10 reports per
  -- tournament per rolling 10 minutes. Beyond the cap, accept silently without
  -- writing — a flooded tournament is already flagged, extra rows add nothing, and
  -- a hard error would only signal the limit to an attacker.
  SELECT count(*) INTO v_recent FROM public.tournament_reports
    WHERE tournament_event_id = v_te_id AND created_at > now() - interval '10 minutes';
  IF v_recent >= 10 THEN
    RETURN jsonb_build_object('ok', true, 'throttled', true);
  END IF;

  INSERT INTO public.tournament_reports (tournament_event_id, reason, reporter_note, reporter_uid)
  VALUES (v_te_id, p_reason, v_note, v_uid);

  -- Fire-and-forget from the public page → leave a server-side trace (HR#9). Only on
  -- a real new report row (deduped/throttled calls above return before this).
  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue, v_uid, 'system', COALESCE(v_uid::text, 'public'),
    'tournament_reported', 'tournament_event', v_te_id::text,
    jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.tournament_report(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tournament_report(text, text, text) TO anon, authenticated;
