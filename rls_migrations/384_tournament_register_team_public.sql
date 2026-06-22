-- 383_tournament_register_team_public.sql
-- Tournament Hub Phase 2 — public self-serve team registration.
--
-- tournament_register_team(slug, competition_id, team_name, contact_email) lets anyone on
-- the public tournament page register a team while the event is OPEN (status='open' and
-- before registration_deadline). Creates a competition_teams row with status='pending'
-- (so it still needs club-admin approval — abuse stays gated). SECURITY DEFINER, pinned
-- search_path, granted to anon + authenticated (the public page is anon). Writes an
-- audit_events row (Hard Rule #9). Idempotency: a duplicate active/pending name in the
-- same competition is rejected.

CREATE OR REPLACE FUNCTION public.tournament_register_team(
  p_slug           text,
  p_competition_id uuid,
  p_team_name      text,
  p_contact_email  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_te        record;
  v_comp      record;
  v_team_name text := NULLIF(btrim(p_team_name), '');
  v_email     text := NULLIF(btrim(p_contact_email), '');
  v_ct_id     uuid;
BEGIN
  IF v_team_name IS NULL THEN
    RAISE EXCEPTION 'team_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_team_name) > 60 THEN
    RAISE EXCEPTION 'team_name_too_long' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.id, te.club_id, te.name, te.status, te.registration_deadline
    INTO v_te
    FROM tournament_events te
   WHERE te.slug = p_slug
   LIMIT 1;
  IF v_te IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_te.status <> 'open'
     OR (v_te.registration_deadline IS NOT NULL AND now() >= v_te.registration_deadline) THEN
    RAISE EXCEPTION 'registration_closed' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.id, c.name
    INTO v_comp
    FROM competitions c
   WHERE c.id = p_competition_id AND c.tournament_event_id = v_te.id
   LIMIT 1;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM competition_teams ct
     WHERE ct.competition_id = p_competition_id
       AND lower(btrim(ct.team_name)) = lower(v_team_name)
       AND ct.status IN ('active', 'pending')
  ) THEN
    RAISE EXCEPTION 'team_name_taken' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competition_teams (competition_id, team_name, status)
  VALUES (p_competition_id, v_team_name, 'pending')
  RETURNING id INTO v_ct_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_te.club_id, auth.uid(), 'system', COALESCE(v_email, 'public'),
    'tournament_team_registered', 'competition_team', v_ct_id::text,
    jsonb_build_object('slug', p_slug, 'team_name', v_team_name,
      'competition_id', p_competition_id, 'contact_email', v_email)
  );

  RETURN jsonb_build_object(
    'ok',                  true,
    'competition_team_id', v_ct_id,
    'status',              'pending',
    'tournament_name',     v_te.name,
    'competition_name',    v_comp.name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.tournament_register_team(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tournament_register_team(text, uuid, text, text) TO anon, authenticated;
