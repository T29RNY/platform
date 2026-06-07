-- DOWN 218: drop admin_promote_guest; restore link_player_to_user to its
-- pre-218 (mig-129) body. Already-promoted players keep is_guest=false (a one-way
-- data change, not reverted — they are valid permanent members).

DROP FUNCTION IF EXISTS public.admin_promote_guest(text, text);

CREATE OR REPLACE FUNCTION public.link_player_to_user(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id      text;
  v_existing_user  uuid;
  v_user_id        uuid;
  v_team_id        text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;

  SELECT id, user_id INTO v_player_id, v_existing_user
    FROM players WHERE token = p_token;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  IF v_existing_user IS NOT NULL AND v_existing_user <> v_user_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='user_already_linked';
  END IF;

  UPDATE players SET user_id = v_user_id WHERE id = v_player_id;

  SELECT team_id INTO v_team_id FROM team_players
    WHERE player_id = v_player_id
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_team_id IS NOT NULL THEN
    INSERT INTO audit_events (
      team_id, actor_type, actor_user_id, actor_identifier,
      action, entity_type, entity_id, metadata
    ) VALUES (
      v_team_id, 'player', v_user_id,
      'player_token:' || md5(p_token),
      'player_account_linked', 'player', v_player_id,
      jsonb_build_object('linked_user_id', v_user_id)
    );

    PERFORM notify_team_change(v_team_id, 'player_updated');
  END IF;

  RETURN jsonb_build_object('ok', true, 'player_id', v_player_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
