-- 559_coach_venue_gate_futureproof_down.sql
-- Reverts mig 559 — restores both functions to their pre-559 bodies verbatim:
--   _venue_in_club_operator → mig 412 (company_id required for ALL callers)
--   venue_add_club_venue    → mig 308 (no control gate on the target venue)
-- After this down-migration a coach can no longer book a company_id-NULL linked
-- venue (see-but-can't-book returns), AND venue_add_club_venue again accepts any
-- existing target (the consent-less link hole reopens). Down them together.

-- #1 restore _venue_in_club_operator (mig 412 body)
CREATE OR REPLACE FUNCTION public._venue_in_club_operator(
  p_caller_venue_id text,
  p_club_id         text,
  p_target_venue_id text
) RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.club_venues cv
    JOIN public.venues tv ON tv.id = cv.venue_id
    WHERE cv.club_id    = p_club_id
      AND cv.venue_id   = p_target_venue_id
      AND tv.company_id IS NOT NULL
      AND (
        p_caller_venue_id IS NULL
        OR tv.company_id = (SELECT company_id FROM public.venues WHERE id = p_caller_venue_id)
      )
  );
$fn$;
REVOKE ALL     ON FUNCTION public._venue_in_club_operator(text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public._venue_in_club_operator(text, text, text) FROM anon, authenticated;

-- #2 restore venue_add_club_venue (mig 308 body — no control gate)
CREATE OR REPLACE FUNCTION public.venue_add_club_venue(
  p_venue_token    text,
  p_club_id        text,
  p_target_venue_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller  record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'not_club_venue' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_target_venue_id) THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE='P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = p_target_venue_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_existed', true);
  END IF;

  INSERT INTO public.club_venues (club_id, venue_id) VALUES (p_club_id, p_target_venue_id);

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier,
     action, entity_type, entity_id, metadata)
  VALUES
    (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
     'club_venue_added', 'club', p_club_id,
     jsonb_build_object('target_venue_id', p_target_venue_id));

  RETURN jsonb_build_object('ok', true, 'already_existed', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_add_club_venue(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_add_club_venue(text,text,text) TO anon, authenticated;
