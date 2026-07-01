-- 461_incident_triage.sql
-- Incident Triage — PR #1: additive schema + GDPR delete-account cleanup.
-- Builds on the existing venue `incidents` lifecycle (migs 231 / 437 / 171).
-- All new columns are nullable / defaulted → existing rows are unchanged
-- (priority backfills to its 'normal' default; no other value moves).
-- Lifecycle stays timestamp-derived: open = resolved_at IS NULL (untouched);
-- "acknowledged" / "escalated" are their own nullable timestamps. No status enum.

-- ---------------------------------------------------------------------------
-- 1. Additive triage columns on incidents
-- ---------------------------------------------------------------------------
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IS NULL OR category IN
      ('facility','equipment','safety','medical','conduct','security','weather','safeguarding','other')),
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_by text,
  ADD COLUMN IF NOT EXISTS escalation_reason text;

-- ---------------------------------------------------------------------------
-- 2. Partial indexes for the two hot read paths
-- ---------------------------------------------------------------------------
-- Venue triage queue: open incidents, ranked by priority / age within a venue.
CREATE INDEX IF NOT EXISTS idx_incidents_queue
  ON public.incidents (venue_id, priority, created_at)
  WHERE resolved_at IS NULL;

-- HQ escalation inbox: escalated + still-open incidents across venues.
CREATE INDEX IF NOT EXISTS idx_incidents_escalation_inbox
  ON public.incidents (escalated_at)
  WHERE escalated_at IS NOT NULL AND resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. GDPR: account deletion must not orphan incident references.
--    incidents.reported_by / resolved_by / assigned_to are auth-user uuids
--    with no FK cascade → NULL them for the deleted user.
--    Both bodies are reproduced verbatim from the live functions (2026-07-01)
--    with ONLY the three incident UPDATEs added; SECDEF + search_path unchanged.
-- ---------------------------------------------------------------------------

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

    DELETE FROM match_health_sessions WHERE user_id = v_user_id;

    -- GDPR (mig 461): NULL orphaned incident references for the deleted user.
    UPDATE public.incidents SET reported_by = NULL WHERE reported_by = v_user_id;
    UPDATE public.incidents SET resolved_by = NULL WHERE resolved_by = v_user_id;
    UPDATE public.incidents SET assigned_to = NULL WHERE assigned_to = v_user_id;
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

  DELETE FROM match_health_sessions WHERE user_id = v_user_id;

  -- GDPR (mig 461): NULL orphaned incident references for the deleted user.
  UPDATE public.incidents SET reported_by = NULL WHERE reported_by = v_user_id;
  UPDATE public.incidents SET resolved_by = NULL WHERE resolved_by = v_user_id;
  UPDATE public.incidents SET assigned_to = NULL WHERE assigned_to = v_user_id;

  FOREACH v_team_id IN ARRAY v_team_ids LOOP
    PERFORM notify_team_change(v_team_id, 'player_account_deleted');
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'auth_user_id', v_user_id, 'team_ids', to_jsonb(v_team_ids));
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

-- Refresh PostgREST schema cache for the replaced functions.
SELECT pg_notify('pgrst', 'reload schema');
