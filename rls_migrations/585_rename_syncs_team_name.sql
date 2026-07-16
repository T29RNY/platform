-- Migration 585 — a squad rename must move BOTH of the squad's names (casual only)
--
-- WHY. create_team (and superadmin_create_team) write teams.name AND
-- settings.group_name together, so a squad is born with one name in two columns.
-- admin_upsert_settings is the ONLY rename path in the product and it wrote
-- settings.group_name alone — so teams.name could never be renamed, only drift.
-- The result an operator actually hit: the My View header showed the new name
-- while the context switcher, My Squads, the unified feed, the "Your teams"
-- chooser and the guardian team screen (all of which read teams.name) kept the
-- ORIGINAL name forever, with no way for the admin to correct it from the app.
--
-- SCOPED TO CASUAL SQUADS — deliberate. For a competitive team, teams.name is its
-- identity in the league table and in already-published fixtures, so renaming it
-- as a side effect of a squad-settings edit could relabel a side mid-season in
-- front of its opponents. The intended product rule ("a league team may rename
-- only at the end of a season") is NOT implementable today: 'completed' is a legal
-- value for seasons.status and competitions.status, but NOTHING in the codebase
-- ever sets it — every season ever created is still 'active', including two whose
-- end_date has passed. Gating on season-end would therefore mean a league team
-- could NEVER rename. Competitive teams keep today's behaviour (group_name only)
-- until a season lifecycle exists; that is scoped separately.
--
-- Body is the live function verbatim with ONE added UPDATE. No signature change,
-- no grant change, no new overload: CREATE OR REPLACE of the same
-- (text, text, jsonb) identity.

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
  v_renamed     boolean := false;
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

  -- THE FIX. Keep teams.name in step for CASUAL squads only. team_type is NOT NULL
  -- DEFAULT 'casual', so no NULL branch is needed. The name <> trim(...) guard keeps
  -- a labels-only save (same name) from touching teams at all.
  UPDATE teams
     SET name = trim(p_group_name)
   WHERE id        = v_team_id
     AND team_type = 'casual'
     AND name     <> trim(p_group_name);
  v_renamed := FOUND;

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
      'team_name_synced',   v_renamed,
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
