-- ════════════════════════════════════════════════════════════════════════════
-- 068 — delete_my_account: wipe ALL player rows owned by the auth user
-- ════════════════════════════════════════════════════════════════════════════
-- Companion to 065/066. Under the new "one player row per team-membership"
-- model, an auth user can have multiple player rows (one per team). The
-- pre-068 RPC (migration 040) anonymised only the single player row
-- matching the supplied token — leaving the user's other team-memberships
-- orphaned: those player rows still carried their user_id and team_players
-- rows, surviving "account deletion" entirely.
--
-- Fix: resolve the auth user from the token, then iterate the wipe over
-- every players row where user_id = that auth user. Per-row wipe is
-- identical to 040 (anonymise PII, delete team_players, player_career,
-- push_subscriptions). The team_admins revoke and the last-admin guard
-- are already user-scoped, so they only need to run once.
--
-- Tokens may be null on previously-anonymised rows; skip those when
-- emitting the audit_events identifier (use 'account_deleted_bulk' as
-- a sentinel actor_identifier in that case).
-- ════════════════════════════════════════════════════════════════════════════

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

  -- Resolve the caller's auth user via the supplied token.
  SELECT id, user_id
    INTO v_caller_player_id, v_user_id
    FROM players
   WHERE token = p_token
   LIMIT 1;

  IF v_caller_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  -- Collect every player row owned by this auth user (token may be null on
  -- some — that's fine). When v_user_id is null (anonymous token, never
  -- linked) we still operate on just the caller's row, matching legacy.
  IF v_user_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(id), ARRAY[]::text[])
      INTO v_player_ids
      FROM players
     WHERE user_id = v_user_id;
  ELSE
    v_player_ids := ARRAY[v_caller_player_id];
  END IF;

  -- Union of every team_id any of those player rows belongs to.
  SELECT COALESCE(array_agg(DISTINCT team_id), ARRAY[]::text[])
    INTO v_team_ids
    FROM team_players
   WHERE player_id = ANY(v_player_ids);

  -- Last-admin guard (user-scoped) — refuse if this user is the sole
  -- non-revoked admin of any team. Same shape as 040.
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

  -- Per-player wipe + per-team audit row.
  FOREACH v_player_id IN ARRAY v_player_ids LOOP
    -- Emit one audit row per (player, team) so the trail mirrors 040.
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

SELECT pg_notify('pgrst', 'reload schema');
