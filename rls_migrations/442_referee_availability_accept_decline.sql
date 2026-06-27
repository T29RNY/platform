-- 442_referee_availability_accept_decline.sql
-- REFEREE epic — PR #3: Availability + accept/decline.
--
-- The FIRST referee PR that WRITES. Two new RPC-only tables + three write RPCs
-- (each INSERTs audit_events, Hard Rule #9) + two readers. Deliberately ISOLATED:
-- the response/availability state lives in its OWN tables, so the security-sensitive
-- assign RPCs (venue_assign_ref / assign_casual_match_ref) and the Swift-locked
-- get_my_assignments (mig 372) are LEFT UNTOUCHED. A re-assignment naturally reads
-- "pending" for the new ref (no response row for their person) with zero reset logic.
-- Mirrors this epic's additive-reader-merged-client-side pattern (PR #2's "Past").
--
--   • ref_assignment_responses — one row per (context, game_id, person) once a ref
--     accepts/declines. Absent row = pending. league game_id = fixtures.id::text,
--     casual game_id = matches.id (text).
--   • ref_unavailability — blackout date ranges the ref can't work; venues assign
--     around them.
--
-- Resolution mirrors mig 372/441 exactly: auth.uid() → people → match_officials.person_id
-- (league) / players.person_id (casual). All writes authenticated-only.

-- ─── Tables (RLS on, NO client policies — RPC-gated only) ─────────────────────

CREATE TABLE IF NOT EXISTS public.ref_assignment_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context       text NOT NULL CHECK (context IN ('league', 'casual')),
  game_id       text NOT NULL,
  person_id     uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  response      text NOT NULL CHECK (response IN ('accepted', 'declined')),
  note          text,
  responded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (context, game_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_ref_responses_person ON public.ref_assignment_responses (person_id);
ALTER TABLE public.ref_assignment_responses ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ref_unavailability (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_ref_unavail_person ON public.ref_unavailability (person_id);
ALTER TABLE public.ref_unavailability ENABLE ROW LEVEL SECURITY;

-- ─── ref_respond_to_assignment — accept/decline a specific assignment ─────────
-- Verifies the caller's person is the CURRENTLY-assigned official (league) or
-- ref_player (casual) for an active (non-terminal) game, then upserts the response.

CREATE OR REPLACE FUNCTION public.ref_respond_to_assignment(
  p_context  text,
  p_game_id  text,
  p_response text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_person  uuid;
  v_team_id text;
  v_entity  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_context NOT IN ('league', 'casual') THEN
    RAISE EXCEPTION 'invalid_context' USING ERRCODE = 'P0001';
  END IF;
  IF p_response NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'invalid_response' USING ERRCODE = 'P0001';
  END IF;
  IF p_game_id IS NULL THEN
    RAISE EXCEPTION 'game_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person FROM public.people WHERE auth_user_id = v_uid;
  IF v_person IS NULL THEN
    RAISE EXCEPTION 'no_person' USING ERRCODE = 'P0001';
  END IF;

  IF p_context = 'league' THEN
    SELECT mo.venue_id, 'fixture'
      INTO v_team_id, v_entity
      FROM public.fixtures f
      JOIN public.match_officials mo ON mo.id = f.official_id AND mo.person_id = v_person
     WHERE f.id::text = p_game_id
       AND f.status IN ('scheduled', 'allocated', 'in_progress');
  ELSE
    SELECT m.team_id, 'match'
      INTO v_team_id, v_entity
      FROM public.matches m
      JOIN public.players p ON p.id = m.ref_player_id AND p.person_id = v_person
     WHERE m.id = p_game_id
       AND m.winner IS NULL
       AND COALESCE(m.cancelled, false) = false;
  END IF;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'not_your_assignment' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ref_assignment_responses (context, game_id, person_id, response, responded_at)
  VALUES (p_context, p_game_id, v_person, p_response, now())
  ON CONFLICT (context, game_id, person_id)
  DO UPDATE SET response = EXCLUDED.response, responded_at = now();

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_uid, 'referee', 'auth_user:' || v_uid::text,
    'ref_assignment_' || p_response, v_entity, p_game_id,
    jsonb_build_object('context', p_context, 'person_id', v_person, 'response', p_response)
  );

  RETURN jsonb_build_object('ok', true, 'context', p_context, 'game_id', p_game_id, 'response', p_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_respond_to_assignment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ref_respond_to_assignment(text, text, text) TO authenticated;

-- ─── ref_add_unavailability — add a blackout date range ──────────────────────

CREATE OR REPLACE FUNCTION public.ref_add_unavailability(
  p_start date,
  p_end   date,
  p_note  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_person uuid;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_start IS NULL OR p_end IS NULL THEN
    RAISE EXCEPTION 'dates_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end < p_start THEN
    RAISE EXCEPTION 'end_before_start' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person FROM public.people WHERE auth_user_id = v_uid;
  IF v_person IS NULL THEN
    RAISE EXCEPTION 'no_person' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ref_unavailability (person_id, start_date, end_date, note)
  VALUES (v_person, p_start, p_end, NULLIF(btrim(COALESCE(p_note, '')), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    'ref_person:' || v_person::text, v_uid, 'referee', 'auth_user:' || v_uid::text,
    'ref_unavailability_added', 'ref_unavailability', v_id::text,
    jsonb_build_object('start_date', p_start, 'end_date', p_end)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'start_date', p_start, 'end_date', p_end);
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_add_unavailability(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ref_add_unavailability(date, date, text) TO authenticated;

-- ─── ref_remove_unavailability — remove one of the caller's own windows ───────

CREATE OR REPLACE FUNCTION public.ref_remove_unavailability(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_person uuid;
  v_del    int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person FROM public.people WHERE auth_user_id = v_uid;
  IF v_person IS NULL THEN
    RAISE EXCEPTION 'no_person' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.ref_unavailability WHERE id = p_id AND person_id = v_person;
  GET DIAGNOSTICS v_del = ROW_COUNT;
  IF v_del = 0 THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    'ref_person:' || v_person::text, v_uid, 'referee', 'auth_user:' || v_uid::text,
    'ref_unavailability_removed', 'ref_unavailability', p_id::text,
    '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true, 'removed_id', p_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_remove_unavailability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ref_remove_unavailability(uuid) TO authenticated;

-- ─── get_my_ref_status — the caller's responses + upcoming unavailability ─────
-- Merged client-side into RefFixtures (Swift-locked get_my_assignments untouched).
-- responses: all the caller's accept/decline rows (client matches by game_id).
-- unavailability: current/future windows only (end_date >= today), soonest first.

CREATE OR REPLACE FUNCTION public.get_my_ref_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_person uuid;
  v_resp   jsonb;
  v_unav   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person FROM public.people WHERE auth_user_id = v_uid;
  IF v_person IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'responses', '[]'::jsonb, 'unavailability', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'context', r.context, 'game_id', r.game_id,
           'response', r.response, 'responded_at', r.responded_at)), '[]'::jsonb)
    INTO v_resp
    FROM public.ref_assignment_responses r
   WHERE r.person_id = v_person;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', u.id, 'start_date', u.start_date,
           'end_date', u.end_date, 'note', u.note)
           ORDER BY u.start_date), '[]'::jsonb)
    INTO v_unav
    FROM public.ref_unavailability u
   WHERE u.person_id = v_person
     AND u.end_date >= (now() AT TIME ZONE 'Europe/London')::date;

  RETURN jsonb_build_object('ok', true, 'responses', v_resp, 'unavailability', v_unav);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_ref_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ref_status() TO authenticated;

-- ─── venue_get_ref_responses — the operator surface (LEAGUE only) ─────────────
-- For the venue's active league fixtures: the assigned ref's accept/decline (only
-- rows with a response — pending = absent). Plus each of the venue's officials'
-- current/future unavailability windows so the assign UI can flag a clash.

CREATE OR REPLACE FUNCTION public.venue_get_ref_responses(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_resp     jsonb;
  v_unav     jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'fixture_id', f.id, 'official_id', f.official_id,
           'response', rar.response, 'responded_at', rar.responded_at)), '[]'::jsonb)
    INTO v_resp
    FROM public.fixtures f
    JOIN public.competitions c ON c.id = f.competition_id
    JOIN public.seasons s ON s.id = c.season_id
    JOIN public.leagues l ON l.id = s.league_id AND l.venue_id = v_venue_id
    JOIN public.match_officials mo ON mo.id = f.official_id
    JOIN public.ref_assignment_responses rar
      ON rar.context = 'league' AND rar.game_id = f.id::text AND rar.person_id = mo.person_id
   WHERE f.status IN ('scheduled', 'allocated', 'in_progress');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'official_id', mo.id, 'start_date', u.start_date, 'end_date', u.end_date)), '[]'::jsonb)
    INTO v_unav
    FROM public.match_officials mo
    JOIN public.ref_unavailability u ON u.person_id = mo.person_id
   WHERE mo.venue_id = v_venue_id
     AND mo.person_id IS NOT NULL
     AND u.end_date >= (now() AT TIME ZONE 'Europe/London')::date;

  RETURN jsonb_build_object('ok', true, 'fixture_responses', v_resp, 'official_unavailability', v_unav);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_get_ref_responses(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_get_ref_responses(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
