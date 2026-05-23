-- 040_player_self_destructive_actions.sql
-- Session B (PROFILE_SCOPE step B1+B2).
-- Two player-token-authed destructive RPCs:
--   leave_squad(p_token)        → soft remove from THIS team only
--   delete_my_account(p_token)  → anonymise across all teams + return
--                                  auth_user_id for the edge function
--                                  to finish with auth.users deletion

-- ── leave_squad ──────────────────────────────────────────────────────
-- Detaches the player from this team only. Player row + history
-- (player_match, payment_ledger, player_injuries) preserved so the
-- team's records stay intact. Refuses if owes > 0.
CREATE OR REPLACE FUNCTION public.leave_squad(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_owes      numeric;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT COALESCE(owes, 0) INTO v_owes FROM players WHERE id = v_player_id;
  IF v_owes > 0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='debt_owed:' || v_owes::text;
  END IF;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', NULL,
    'player_token:' || md5(p_token),
    'player_left_squad', 'player', v_player_id,
    jsonb_build_object('player_id', v_player_id)
  );

  DELETE FROM team_players
   WHERE player_id = v_player_id AND team_id = v_team_id;

  DELETE FROM push_subscriptions
   WHERE player_id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_left_squad');

  RETURN jsonb_build_object('ok', true, 'team_id', v_team_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.leave_squad(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.leave_squad(text) TO anon, authenticated;

-- ── delete_my_account ────────────────────────────────────────────────
-- Anonymises the player row (preserves player_match FKs), removes all
-- team memberships, push subs, career, and admin grants. Returns the
-- auth user_id so the edge function can finish by deleting auth.users
-- via the admin API. Refuses with 'last_admin:<csv of team_ids>' if
-- this user is the only non-revoked admin of any team.
CREATE OR REPLACE FUNCTION public.delete_my_account(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id   text;
  v_user_id     uuid;
  v_team_ids    text[];
  v_blocking    text[];
  v_team_id     text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT id, user_id
    INTO v_player_id, v_user_id
    FROM players
   WHERE token = p_token
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT COALESCE(array_agg(team_id), ARRAY[]::text[])
    INTO v_team_ids
    FROM team_players
   WHERE player_id = v_player_id;

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

  FOREACH v_team_id IN ARRAY v_team_ids LOOP
    INSERT INTO audit_events (
      team_id, actor_type, actor_user_id, actor_identifier,
      action, entity_type, entity_id, metadata
    ) VALUES (
      v_team_id, 'player', v_user_id,
      'player_token:' || md5(p_token),
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

  DELETE FROM team_players  WHERE player_id = v_player_id;
  DELETE FROM player_career WHERE player_id = v_player_id;
  DELETE FROM push_subscriptions WHERE player_id = v_player_id;

  IF v_user_id IS NOT NULL THEN
    UPDATE team_admins
       SET revoked_at = now(),
           revoked_by = v_user_id
     WHERE user_id   = v_user_id
       AND revoked_at IS NULL;
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

REVOKE ALL ON FUNCTION public.delete_my_account(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO anon, authenticated;
