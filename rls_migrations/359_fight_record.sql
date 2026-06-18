-- 359_fight_record.sql
-- Gym/Boxing vertical, Phase 4 (LAST) — bout / fight record + sparring stats.
--
-- Boxing's progression is a fight record, not a belt ladder (disciplineLabels
-- hasFightRecord = boxing only). A bout is recorded by the operator against a
-- member's profile; the member sees a derived W-L-D-NC record + bout list on
-- their profile. Mirrors the Phase 2 grading shape: operator writes gated on
-- manage_facility (resolve_venue_caller + _venue_has_cap) + audited (Hard Rule
-- #9); member reads via pass_token (like member_get_grade_history).
--
-- Two pieces:
--   1. DORMANT realisation of the documented player_match/matches sport_stats
--      jsonb pattern (DECISIONS.md). Additive-NULLABLE, nothing reads or writes
--      it yet — the football result cascade is byte-unchanged. It exists so a
--      future non-football sport can hang per-appearance stats off the existing
--      match spine without another migration.
--   2. member_bouts: dedicated table keyed on member_profile_id (football's
--      player_match keys on a football players row — kept separate by design).
--      Soft-void (voided flag), never hard delete, so history is preserved.
--      W-L-D-NC is DERIVED from non-voided, non-sparring rows; sparring rows
--      (is_sparring=true) are listed but excluded from the headline record.
--
-- member_bouts is RLS-walled with NO policies → all client access blocked; only
-- the SECURITY DEFINER RPCs below reach it.
--
-- NOTE: the member_get_fight_record headline-record fix (sparring excluded from
-- W-L-D, applied live as 359b) is folded into the body below (Hard Rule #11).

-- ---------------------------------------------------------------------------
-- 1. DORMANT sport_stats realisation (additive-NULLABLE; football byte-unchanged)
-- ---------------------------------------------------------------------------
ALTER TABLE public.player_match ADD COLUMN IF NOT EXISTS sport_stats jsonb;
ALTER TABLE public.matches      ADD COLUMN IF NOT EXISTS sport_stats jsonb;

-- ---------------------------------------------------------------------------
-- 2. member_bouts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_bouts (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_profile_id       uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  club_id                 text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  bout_date               date        NOT NULL,
  opponent_name           text,
  event_name              text,
  result                  text        NOT NULL CHECK (result IN ('win','loss','draw','no_contest')),
  method                  text,                       -- KO/TKO/decision/submission/…
  rounds                  int         CHECK (rounds IS NULL OR rounds >= 0),
  is_sparring             boolean     NOT NULL DEFAULT false,
  stats                   jsonb,                      -- optional per-bout extras
  note                    text,
  voided                  boolean     NOT NULL DEFAULT false,   -- soft-delete
  recorded_by             text,
  recorded_by_actor_type  text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz
);
CREATE INDEX IF NOT EXISTS member_bouts_by_member
  ON public.member_bouts (member_profile_id, bout_date DESC);

ALTER TABLE public.member_bouts ENABLE ROW LEVEL SECURITY;
-- No policies by design: all client access blocked; SECURITY DEFINER RPCs only.

-- ---------------------------------------------------------------------------
-- RPC: venue_record_bout  (gated manage_facility, audited)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_record_bout(
  p_venue_token   text,
  p_membership_id uuid,
  p_bout_date     date,
  p_result        text,
  p_opponent_name text    DEFAULT NULL,
  p_event_name    text    DEFAULT NULL,
  p_method        text    DEFAULT NULL,
  p_rounds        int     DEFAULT NULL,
  p_is_sparring   boolean DEFAULT false,
  p_stats         jsonb   DEFAULT NULL,
  p_note          text    DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_mem      record;
  v_id       uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_membership_id IS NULL THEN
    RAISE EXCEPTION 'membership_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_bout_date IS NULL THEN
    RAISE EXCEPTION 'bout_date_required' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_result,'') NOT IN ('win','loss','draw','no_contest') THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = 'P0001';
  END IF;
  IF p_rounds IS NOT NULL AND p_rounds < 0 THEN
    RAISE EXCEPTION 'invalid_rounds' USING ERRCODE = 'P0001';
  END IF;

  -- membership must belong to caller's venue, and carry a member_profile + club
  SELECT m.venue_id, m.club_id, m.member_profile_id
    INTO v_mem
    FROM public.venue_memberships m
   WHERE m.id = p_membership_id;
  IF v_mem.venue_id IS NULL THEN
    RAISE EXCEPTION 'membership_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_mem.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'membership_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  IF v_mem.member_profile_id IS NULL THEN
    RAISE EXCEPTION 'membership_has_no_member_profile' USING ERRCODE = 'P0001';
  END IF;
  IF v_mem.club_id IS NULL THEN
    RAISE EXCEPTION 'membership_has_no_club' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.member_bouts
    (member_profile_id, club_id, bout_date, opponent_name, event_name, result,
     method, rounds, is_sparring, stats, note, recorded_by, recorded_by_actor_type)
  VALUES
    (v_mem.member_profile_id, v_mem.club_id, p_bout_date,
     NULLIF(btrim(COALESCE(p_opponent_name,'')),''),
     NULLIF(btrim(COALESCE(p_event_name,'')),''),
     p_result, NULLIF(btrim(COALESCE(p_method,'')),''), p_rounds,
     COALESCE(p_is_sparring,false), p_stats,
     NULLIF(btrim(COALESCE(p_note,'')),''),
     v_caller.actor_ident, v_caller.actor_type)
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'bout_recorded', 'member_bout', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', v_mem.club_id,
                             'membership_id', p_membership_id,
                             'member_profile_id', v_mem.member_profile_id,
                             'result', p_result, 'is_sparring', COALESCE(p_is_sparring,false),
                             'bout_date', p_bout_date));

  RETURN jsonb_build_object('ok', true, 'bout_id', v_id, 'result', p_result,
                            'is_sparring', COALESCE(p_is_sparring,false));
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_record_bout(text, uuid, date, text, text, text, text, int, boolean, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_record_bout(text, uuid, date, text, text, text, text, int, boolean, jsonb, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: venue_update_bout  (gated manage_facility, audited; COALESCE patch)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_update_bout(
  p_venue_token   text,
  p_bout_id       uuid,
  p_bout_date     date    DEFAULT NULL,
  p_result        text    DEFAULT NULL,
  p_opponent_name text    DEFAULT NULL,
  p_event_name    text    DEFAULT NULL,
  p_method        text    DEFAULT NULL,
  p_rounds        int     DEFAULT NULL,
  p_is_sparring   boolean DEFAULT NULL,
  p_stats         jsonb   DEFAULT NULL,
  p_note          text    DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club     text;
  v_linked   boolean;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_bout_id IS NULL THEN
    RAISE EXCEPTION 'bout_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_result IS NOT NULL AND p_result NOT IN ('win','loss','draw','no_contest') THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = 'P0001';
  END IF;
  IF p_rounds IS NOT NULL AND p_rounds < 0 THEN
    RAISE EXCEPTION 'invalid_rounds' USING ERRCODE = 'P0001';
  END IF;

  -- bout's club must belong to caller's venue
  SELECT club_id INTO v_club FROM public.member_bouts WHERE id = p_bout_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'bout_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = v_club AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'bout_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.member_bouts SET
    bout_date     = COALESCE(p_bout_date, bout_date),
    result        = COALESCE(p_result, result),
    opponent_name = CASE WHEN p_opponent_name IS NULL THEN opponent_name ELSE NULLIF(btrim(p_opponent_name),'') END,
    event_name    = CASE WHEN p_event_name IS NULL THEN event_name ELSE NULLIF(btrim(p_event_name),'') END,
    method        = CASE WHEN p_method IS NULL THEN method ELSE NULLIF(btrim(p_method),'') END,
    rounds        = COALESCE(p_rounds, rounds),
    is_sparring   = COALESCE(p_is_sparring, is_sparring),
    stats         = COALESCE(p_stats, stats),
    note          = CASE WHEN p_note IS NULL THEN note ELSE NULLIF(btrim(p_note),'') END,
    updated_at    = now()
  WHERE id = p_bout_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'bout_updated', 'member_bout', p_bout_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', v_club));

  RETURN jsonb_build_object('ok', true, 'bout_id', p_bout_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_update_bout(text, uuid, date, text, text, text, text, int, boolean, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_update_bout(text, uuid, date, text, text, text, text, int, boolean, jsonb, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: venue_delete_bout  (gated manage_facility, audited — SOFT-VOID, not hard delete)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_delete_bout(
  p_venue_token text,
  p_bout_id     uuid,
  p_void        boolean DEFAULT true
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club     text;
  v_linked   boolean;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF p_bout_id IS NULL THEN
    RAISE EXCEPTION 'bout_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club FROM public.member_bouts WHERE id = p_bout_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'bout_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = v_club AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'bout_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.member_bouts
     SET voided = COALESCE(p_void, true), updated_at = now()
   WHERE id = p_bout_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          CASE WHEN COALESCE(p_void,true) THEN 'bout_voided' ELSE 'bout_restored' END,
          'member_bout', p_bout_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', v_club,
                             'voided', COALESCE(p_void,true)));

  RETURN jsonb_build_object('ok', true, 'bout_id', p_bout_id, 'voided', COALESCE(p_void,true));
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_delete_bout(text, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_delete_bout(text, uuid, boolean) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: venue_list_member_bouts  (operator read; membership in caller's venue)
--   Returns the full bout list (incl. voided so the operator can restore) plus
--   the derived record (non-voided, non-sparring).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_list_member_bouts(
  p_venue_token   text,
  p_membership_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_mem      record;
  v_bouts    jsonb;
  v_rec      record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_membership_id IS NULL THEN
    RAISE EXCEPTION 'membership_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.venue_id, m.club_id, m.member_profile_id
    INTO v_mem
    FROM public.venue_memberships m
   WHERE m.id = p_membership_id;
  IF v_mem.venue_id IS NULL THEN
    RAISE EXCEPTION 'membership_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_mem.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'membership_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bout_id',       b.id,
           'bout_date',     b.bout_date,
           'opponent_name', b.opponent_name,
           'event_name',    b.event_name,
           'result',        b.result,
           'method',        b.method,
           'rounds',        b.rounds,
           'is_sparring',   b.is_sparring,
           'stats',         b.stats,
           'note',          b.note,
           'voided',        b.voided,
           'created_at',    b.created_at
         ) ORDER BY b.bout_date DESC, b.created_at DESC), '[]'::jsonb)
    INTO v_bouts
    FROM public.member_bouts b
   WHERE b.member_profile_id = v_mem.member_profile_id
     AND (v_mem.club_id IS NULL OR b.club_id = v_mem.club_id);

  SELECT
    COUNT(*) FILTER (WHERE result='win')        AS wins,
    COUNT(*) FILTER (WHERE result='loss')       AS losses,
    COUNT(*) FILTER (WHERE result='draw')       AS draws,
    COUNT(*) FILTER (WHERE result='no_contest') AS no_contests
    INTO v_rec
    FROM public.member_bouts b
   WHERE b.member_profile_id = v_mem.member_profile_id
     AND (v_mem.club_id IS NULL OR b.club_id = v_mem.club_id)
     AND b.voided = false AND b.is_sparring = false;

  RETURN jsonb_build_object('ok', true,
    'membership_id', p_membership_id,
    'member_profile_id', v_mem.member_profile_id,
    'record', jsonb_build_object('wins', COALESCE(v_rec.wins,0), 'losses', COALESCE(v_rec.losses,0),
                                 'draws', COALESCE(v_rec.draws,0), 'no_contests', COALESCE(v_rec.no_contests,0)),
    'bouts', v_bouts);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_list_member_bouts(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_list_member_bouts(text, uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: member_get_fight_record  (member read via pass_token; own bouts)
--   Derived W-L-D-NC from non-voided, NON-SPARRING bouts at the pass's club
--   (sparring_count reported separately); bouts list excludes voided (members
--   never see voided rows). [359b fix folded in: NOT is_sparring on the record.]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_get_fight_record(
  p_token text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mp    uuid;
  v_club  text;
  v_bouts jsonb;
  v_rec   record;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT m.member_profile_id, m.club_id
    INTO v_mp, v_club
    FROM public.venue_memberships m
   WHERE m.pass_token = p_token AND m.status <> 'cancelled';
  IF v_mp IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bout_id',       b.id,
           'bout_date',     b.bout_date,
           'opponent_name', b.opponent_name,
           'event_name',    b.event_name,
           'result',        b.result,
           'method',        b.method,
           'rounds',        b.rounds,
           'is_sparring',   b.is_sparring
         ) ORDER BY b.bout_date DESC, b.created_at DESC), '[]'::jsonb)
    INTO v_bouts
    FROM public.member_bouts b
   WHERE b.member_profile_id = v_mp
     AND b.voided = false
     AND (v_club IS NULL OR b.club_id = v_club);

  SELECT
    COUNT(*) FILTER (WHERE result='win'        AND NOT is_sparring) AS wins,
    COUNT(*) FILTER (WHERE result='loss'       AND NOT is_sparring) AS losses,
    COUNT(*) FILTER (WHERE result='draw'       AND NOT is_sparring) AS draws,
    COUNT(*) FILTER (WHERE result='no_contest' AND NOT is_sparring) AS no_contests,
    COUNT(*) FILTER (WHERE is_sparring)                              AS sparring_count
    INTO v_rec
    FROM public.member_bouts b
   WHERE b.member_profile_id = v_mp
     AND b.voided = false
     AND (v_club IS NULL OR b.club_id = v_club);

  RETURN jsonb_build_object('ok', true,
    'record', jsonb_build_object(
      'wins', COALESCE(v_rec.wins,0), 'losses', COALESCE(v_rec.losses,0),
      'draws', COALESCE(v_rec.draws,0), 'no_contests', COALESCE(v_rec.no_contests,0),
      'sparring_count', COALESCE(v_rec.sparring_count,0)),
    'bouts', v_bouts);
END;
$function$;

REVOKE ALL ON FUNCTION public.member_get_fight_record(text) FROM public;
GRANT EXECUTE ON FUNCTION public.member_get_fight_record(text) TO anon, authenticated;
