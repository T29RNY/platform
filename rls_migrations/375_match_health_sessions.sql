-- 375: Phase 4 — Match health-summary storage (watchOS companion, Unified Identity & Sync Spine)
--
-- The watchOS ref app (a later, App-Store-gated phase) auto-tracks an Apple "Outdoor Football"
-- workout for whoever is acting as ref, and posts a SUMMARY (never the raw stream — UK-GDPR data
-- minimisation, special-category health data) back to us on Full Time. This migration builds the
-- backend that receives + surfaces that summary, ahead of the native build (operator s162: build
-- everything that doesn't need an approved App Store listing).
--
--   • match_health_sessions   — one summary row per ref, per match (RLS on, NO policies → RPC-only)
--   • save_match_health_summary — idempotent upsert keyed on (user_id, client_session_id)
--   • get_my_match_health       — read-back for the inorout "Your match fitness" surface
--
-- BOTH RPCs are authenticated-only (auth.uid()): REVOKE anon, GRANT authenticated — mirrors the two
-- account-scoped fns in mig 369. SECURITY DEFINER + pinned search_path. save_* writes audit_events
-- (Hard Rule #9). Consumers: watchOS (writer) + inorout web (reader) — recorded in RPCS.md (HR#14).
--
-- ⚠️ MANDATORY GDPR cascade (DECISIONS.md s161 #6): match_health_sessions is special-category data,
--    so its purge ships in the SAME migration that creates it. Belt: user_id → auth.users ON DELETE
--    CASCADE. Braces: an explicit DELETE is added to BOTH account-deletion RPCs (delete_my_account_auth
--    auth path + delete_my_account token path) so the row goes the moment the account is anonymised,
--    not only when auth.users is finally removed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_health_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_context      text NOT NULL CHECK (match_context IN ('league','casual','cohort')),
  match_ref          text NOT NULL,
  client_session_id  text NOT NULL,
  duration_seconds   int,
  active_energy_kcal numeric,
  distance_meters    numeric,
  avg_hr             int,
  max_hr             int,
  hr_zones           jsonb,
  started_at         timestamptz,
  ended_at           timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_session_id)
);

ALTER TABLE match_health_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: all access is via the SECURITY DEFINER RPCs below (mirrors the `people` spine table).

CREATE INDEX IF NOT EXISTS idx_mhs_user ON match_health_sessions (user_id, ended_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. save_match_health_summary — idempotent upsert (watch posts on Full Time)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION save_match_health_summary(
  p_match_context     text,
  p_match_ref         text,
  p_client_session_id text,
  p_duration_seconds  int         DEFAULT NULL,
  p_active_energy_kcal numeric     DEFAULT NULL,
  p_distance_meters   numeric      DEFAULT NULL,
  p_avg_hr            int          DEFAULT NULL,
  p_max_hr            int          DEFAULT NULL,
  p_hr_zones          jsonb        DEFAULT NULL,
  p_started_at        timestamptz  DEFAULT NULL,
  p_ended_at          timestamptz  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id  uuid := auth.uid();
  v_existing uuid;
  v_id       uuid;
  v_updated  boolean;
  v_team_id  text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_match_context IS NULL OR p_match_context NOT IN ('league','casual','cohort') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_match_context';
  END IF;
  IF p_match_ref IS NULL OR p_client_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT id INTO v_existing
    FROM match_health_sessions
   WHERE user_id = v_user_id AND client_session_id = p_client_session_id;

  INSERT INTO match_health_sessions (
    user_id, match_context, match_ref, client_session_id,
    duration_seconds, active_energy_kcal, distance_meters,
    avg_hr, max_hr, hr_zones, started_at, ended_at
  ) VALUES (
    v_user_id, p_match_context, p_match_ref, p_client_session_id,
    p_duration_seconds, p_active_energy_kcal, p_distance_meters,
    p_avg_hr, p_max_hr, p_hr_zones, p_started_at, p_ended_at
  )
  ON CONFLICT (user_id, client_session_id) DO UPDATE SET
    match_context      = EXCLUDED.match_context,
    match_ref          = EXCLUDED.match_ref,
    duration_seconds   = EXCLUDED.duration_seconds,
    active_energy_kcal = EXCLUDED.active_energy_kcal,
    distance_meters    = EXCLUDED.distance_meters,
    avg_hr             = EXCLUDED.avg_hr,
    max_hr             = EXCLUDED.max_hr,
    hr_zones           = EXCLUDED.hr_zones,
    started_at         = EXCLUDED.started_at,
    ended_at           = EXCLUDED.ended_at
  RETURNING id INTO v_id;

  v_updated := (v_existing IS NOT NULL);

  -- Derive an audit team_id (Hard Rule #9). audit_events.team_id is NOT NULL text with NO FK,
  -- so any string is safe; we use the real owning team where we can, else a literal 'health'.
  IF p_match_context = 'casual' THEN
    SELECT team_id INTO v_team_id FROM matches WHERE id = p_match_ref;
  ELSE
    BEGIN
      SELECT home_team_id INTO v_team_id FROM fixtures WHERE id = p_match_ref::uuid;
    EXCEPTION WHEN others THEN
      v_team_id := NULL;
    END;
  END IF;
  v_team_id := COALESCE(v_team_id, 'health');

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', v_user_id, 'auth_uid:' || v_user_id::text,
    CASE WHEN v_updated THEN 'match_health_updated' ELSE 'match_health_saved' END,
    'match_health_session', v_id::text,
    jsonb_build_object(
      'match_context', p_match_context,
      'match_ref', p_match_ref,
      'client_session_id', p_client_session_id,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'updated', v_updated);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION save_match_health_summary(text,text,text,int,numeric,numeric,int,int,jsonb,timestamptz,timestamptz) FROM anon, public;
GRANT EXECUTE ON FUNCTION save_match_health_summary(text,text,text,int,numeric,numeric,int,int,jsonb,timestamptz,timestamptz) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_my_match_health — read-back for the inorout "Your match fitness" surface
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_match_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id  uuid := auth.uid();
  v_sessions jsonb;
  v_totals   jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'sessions', '[]'::jsonb,
      'totals', jsonb_build_object('games',0,'minutes',0,'kcal',0,'distance',0,'avg_hr',0)
    );
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.ended_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_sessions
  FROM (
    SELECT id, match_context, match_ref, duration_seconds, active_energy_kcal,
           distance_meters, avg_hr, max_hr, hr_zones, started_at, ended_at
      FROM match_health_sessions
     WHERE user_id = v_user_id
  ) s;

  SELECT jsonb_build_object(
    'games',    count(*),
    'minutes',  COALESCE(round(sum(duration_seconds) / 60.0), 0),
    'kcal',     COALESCE(round(sum(active_energy_kcal)), 0),
    'distance', COALESCE(round(sum(distance_meters)), 0),
    'avg_hr',   COALESCE(round(avg(avg_hr)), 0)
  ) INTO v_totals
  FROM match_health_sessions
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'sessions', v_sessions, 'totals', v_totals);
END;
$function$;

REVOKE ALL ON FUNCTION get_my_match_health() FROM anon, public;
GRANT EXECUTE ON FUNCTION get_my_match_health() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GDPR cascade — add the health-row purge to BOTH account-deletion RPCs.
--    Bodies reproduced verbatim from live (migs 370/370-photo-fix/371) with ONLY the
--    `DELETE FROM match_health_sessions` line added. Do not drift any other line.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_my_account_auth()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id    uuid;
  v_player_ids text[];
  v_team_ids   text[];
  v_blocking   text[];
  v_player_id  text;
  v_team_id    text;
  v_row_token  text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::text[])
    INTO v_player_ids FROM players WHERE user_id = v_user_id;

  SELECT COALESCE(array_agg(DISTINCT team_id), ARRAY[]::text[])
    INTO v_team_ids FROM team_players WHERE player_id = ANY(v_player_ids);

  SELECT COALESCE(array_agg(t.team_id), ARRAY[]::text[])
    INTO v_blocking
    FROM team_admins t
   WHERE t.user_id = v_user_id AND t.revoked_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM team_admins o
        WHERE o.team_id = t.team_id AND o.user_id <> v_user_id AND o.revoked_at IS NULL);
  IF array_length(v_blocking, 1) > 0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='last_admin:' || array_to_string(v_blocking, ',');
  END IF;

  FOREACH v_player_id IN ARRAY v_player_ids LOOP
    FOR v_team_id, v_row_token IN
      SELECT tp.team_id, p.token FROM team_players tp
        JOIN players p ON p.id = tp.player_id WHERE tp.player_id = v_player_id
    LOOP
      INSERT INTO audit_events (
        team_id, actor_type, actor_user_id, actor_identifier,
        action, entity_type, entity_id, metadata
      ) VALUES (
        v_team_id, 'player', v_user_id,
        CASE WHEN v_row_token IS NOT NULL THEN 'player_token:' || md5(v_row_token)
             ELSE 'account_deleted_bulk' END,
        'account_deleted', 'player', v_player_id,
        jsonb_build_object('player_id', v_player_id, 'auth_user_id', v_user_id, 'via', 'auth'));
    END LOOP;

    UPDATE players
       SET name='Deleted player', nickname=NULL, token=NULL, user_id=NULL,
           disabled=true, disable_reason='account_deleted', status='out',
           injured=false, injured_since=NULL, priority=false, admin_locked_in=false,
           note=NULL, paid=false, self_paid=false, paid_by=NULL
     WHERE id = v_player_id;

    DELETE FROM team_players       WHERE player_id = v_player_id;
    DELETE FROM player_career      WHERE player_id = v_player_id;
    DELETE FROM push_subscriptions WHERE player_id = v_player_id;
  END LOOP;

  UPDATE team_admins SET revoked_at = now(), revoked_by = v_user_id
   WHERE user_id = v_user_id AND revoked_at IS NULL;

  UPDATE member_profiles
     SET first_name='Deleted member', last_name=NULL, email=NULL, phone=NULL,
         dob=NULL, gender=NULL,
         address_line1=NULL, address_line2=NULL, address_city=NULL, address_postcode=NULL,
         ec1_name=NULL, ec1_relationship=NULL, ec1_phone=NULL,
         ec2_name=NULL, ec2_relationship=NULL, ec2_phone=NULL,
         send_notes=NULL, dietary_notes=NULL, authorised_collectors=NULL,
         medical_conditions=NULL, allergies=NULL, medications=NULL, gp_details=NULL,
         photo_consent='{}'::jsonb, auth_user_id=NULL
   WHERE auth_user_id = v_user_id;

  DELETE FROM user_profiles WHERE user_id = v_user_id;

  -- mig 375: special-category health data purge (UK-GDPR). v_user_id is always non-null here.
  DELETE FROM match_health_sessions WHERE user_id = v_user_id;

  FOREACH v_team_id IN ARRAY v_team_ids LOOP
    PERFORM notify_team_change(v_team_id, 'player_account_deleted');
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'auth_user_id', v_user_id, 'team_ids', to_jsonb(v_team_ids));
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_account(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_player_id text;
  v_user_id          uuid;
  v_player_ids       text[];
  v_team_ids         text[];
  v_blocking         text[];
  v_player_id        text;
  v_team_id          text;
  v_row_token        text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT id, user_id
    INTO v_caller_player_id, v_user_id
    FROM players
   WHERE token = p_token
   LIMIT 1;

  IF v_caller_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(id), ARRAY[]::text[])
      INTO v_player_ids
      FROM players
     WHERE user_id = v_user_id;
  ELSE
    v_player_ids := ARRAY[v_caller_player_id];
  END IF;

  SELECT COALESCE(array_agg(DISTINCT team_id), ARRAY[]::text[])
    INTO v_team_ids
    FROM team_players
   WHERE player_id = ANY(v_player_ids);

  IF v_user_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(t.team_id), ARRAY[]::text[])
      INTO v_blocking
      FROM team_admins t
     WHERE t.user_id = v_user_id
       AND t.revoked_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM team_admins o
          WHERE o.team_id  = t.team_id
            AND o.user_id <> v_user_id
            AND o.revoked_at IS NULL
       );

    IF array_length(v_blocking, 1) > 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='last_admin:' || array_to_string(v_blocking, ',');
    END IF;
  END IF;

  FOREACH v_player_id IN ARRAY v_player_ids LOOP
    FOR v_team_id, v_row_token IN
      SELECT tp.team_id, p.token
        FROM team_players tp
        JOIN players p ON p.id = tp.player_id
       WHERE tp.player_id = v_player_id
    LOOP
      INSERT INTO audit_events (
        team_id, actor_type, actor_user_id, actor_identifier,
        action, entity_type, entity_id, metadata
      ) VALUES (
        v_team_id, 'player', v_user_id,
        CASE
          WHEN v_row_token IS NOT NULL
            THEN 'player_token:' || md5(v_row_token)
          ELSE 'account_deleted_bulk'
        END,
        'account_deleted', 'player', v_player_id,
        jsonb_build_object('player_id', v_player_id, 'auth_user_id', v_user_id)
      );
    END LOOP;

    UPDATE players
       SET name              = 'Deleted player',
           nickname          = NULL,
           token             = NULL,
           user_id           = NULL,
           disabled          = true,
           disable_reason    = 'account_deleted',
           status            = 'out',
           injured           = false,
           injured_since     = NULL,
           priority          = false,
           admin_locked_in   = false,
           note              = NULL,
           paid              = false,
           self_paid         = false,
           paid_by           = NULL
     WHERE id = v_player_id;

    DELETE FROM team_players       WHERE player_id = v_player_id;
    DELETE FROM player_career      WHERE player_id = v_player_id;
    DELETE FROM push_subscriptions WHERE player_id = v_player_id;
  END LOOP;

  IF v_user_id IS NOT NULL THEN
    UPDATE team_admins
       SET revoked_at = now(),
           revoked_by = v_user_id
     WHERE user_id   = v_user_id
       AND revoked_at IS NULL;

    -- mig 375: special-category health data purge (UK-GDPR). Guarded: health rows are
    -- keyed on auth.users, so a token-only player (no account) has none.
    DELETE FROM match_health_sessions WHERE user_id = v_user_id;
  END IF;

  FOREACH v_team_id IN ARRAY v_team_ids LOOP
    PERFORM notify_team_change(v_team_id, 'player_account_deleted');
  END LOOP;

  RETURN jsonb_build_object(
    'ok',           true,
    'auth_user_id', v_user_id,
    'team_ids',     to_jsonb(v_team_ids)
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

-- Refresh PostgREST so the two new RPCs resolve immediately (avoids the 404 cache trap).
SELECT pg_notify('pgrst', 'reload schema');
