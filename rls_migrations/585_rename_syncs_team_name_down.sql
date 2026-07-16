-- Down for 585 — restore admin_upsert_settings to the pre-585 body (settings only).
--
-- Reverts the teams.name sync and the 'team_name_synced' audit field. NOTE: this
-- restores the DRIFT bug (a casual rename moves the header name but not teams.name),
-- and it does NOT un-rename any team already synced while 585 was live — those rows
-- keep the name the admin chose, which is the name they asked for either way.

CREATE OR REPLACE FUNCTION public.admin_upsert_settings(p_admin_token text, p_group_name text, p_group_labels jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id     text;
  v_settings_id text;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF p_group_name IS NULL OR trim(p_group_name) = '' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='group_name_required';
  END IF;

  UPDATE settings
     SET group_name   = trim(p_group_name),
         group_labels = COALESCE(p_group_labels, settings.group_labels)
   WHERE team_id = v_team_id;

  IF NOT FOUND THEN
    v_settings_id := 'sett_' || v_team_id;
    INSERT INTO settings (id, team_id, group_name, group_labels)
    VALUES (v_settings_id, v_team_id, trim(p_group_name), p_group_labels)
    ON CONFLICT (team_id) DO UPDATE SET
      group_name   = EXCLUDED.group_name,
      group_labels = COALESCE(EXCLUDED.group_labels, settings.group_labels);
  END IF;

  PERFORM notify_team_change(v_team_id, 'settings_updated');

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
    'settings_updated', 'settings', v_team_id,
    jsonb_build_object(
      'group_name',         trim(p_group_name),
      'group_labels_keys',  CASE WHEN p_group_labels IS NULL
                              THEN null
                              ELSE (SELECT array_agg(k)
                                      FROM jsonb_object_keys(p_group_labels) k)
                            END
    )
  );

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;
