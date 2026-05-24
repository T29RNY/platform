-- Migration 047 — delete_my_account must purge all FK refs to auth.users
--
-- Background: auth.admin.deleteUser() was failing silently because
-- public-schema FKs to auth.users (NO ACTION) blocked the row deletion.
-- The /api/delete-account endpoint returned ok:true,authDeleted:false
-- and the user's auth row + identity stayed behind — locking that email
-- out of future sign-ins (Google says "yes this is the user", Supabase
-- finds the identity, looks up the user_id → 404 "User not found" loop).
--
-- The 040 version of this RPC anonymised the player row and revoked
-- team_admins rows but didn't:
--   - delete user_profiles row
--   - DELETE team_admins rows (only revoked them — row + FK still live)
--   - null out team_admins.granted_by / revoked_by references where this
--     user had granted or revoked other admins
--
-- This migration rewrites the RPC to purge every FK ref to auth.users
-- before the edge function calls admin.deleteUser. After this, the auth
-- row deletion succeeds and auth.identities cascades naturally.

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

  DELETE FROM team_players      WHERE player_id = v_player_id;
  DELETE FROM player_career     WHERE player_id = v_player_id;
  DELETE FROM push_subscriptions WHERE player_id = v_player_id;

  IF v_user_id IS NOT NULL THEN
    -- DELETE (not revoke) the user's own team_admins rows. The 040 version
    -- only set revoked_at, leaving team_admins.user_id pointing at the
    -- auth.users row — that FK (NO ACTION) blocked admin.deleteUser.
    DELETE FROM team_admins WHERE user_id = v_user_id;

    -- Null out granted_by / revoked_by references on OTHER team_admins
    -- rows that this user granted or revoked. Same FK NO ACTION risk.
    UPDATE team_admins SET granted_by = NULL WHERE granted_by = v_user_id;
    UPDATE team_admins SET revoked_by = NULL WHERE revoked_by = v_user_id;

    -- platform_admins: user_id FK is CASCADE so it'll go on auth delete;
    -- granted_by is NO ACTION and needs nulling.
    UPDATE platform_admins SET granted_by = NULL WHERE granted_by = v_user_id;

    -- user_profiles: NO ACTION FK on user_id. Delete the row.
    DELETE FROM user_profiles WHERE user_id = v_user_id;
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
