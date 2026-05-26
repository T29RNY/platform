-- 098_phase2_join_register_team.sql
--
-- Phase 2 (League Mode) — Cycle 2.5a public team-registration RPC.
--
--   join_register_team(p_league_code, p_competition_id, p_team jsonb)
--     Self-serve team registration via /join/CODE. The caller MUST
--     be authenticated (Google OAuth in the wizard UI). The RPC
--     creates a competitive team, claims the caller as team_admin,
--     and submits a competition_teams row with status='pending' for
--     venue admin approval.
--
-- p_team shape (creating a new team):
--   {
--     "name":            "Acme FC",            -- required
--     "short_name":      "ACME",               -- optional
--     "primary_colour":  "#60A0FF",            -- optional
--     "secondary_colour":"#FF6060",            -- optional
--     "admin_email":     "captain@acme.fc"     -- optional, audit-only
--   }
--
-- Or, reusing an existing team the caller already admins:
--   {
--     "existing_team_id": "team_xxx"
--   }
--
-- Validation:
--   - auth.uid() not null (anon registration is not supported v1)
--   - league_code resolves to an active league
--   - p_competition_id belongs to that league, status IN ('setup','active')
--   - For new team: name required, length 1..120
--   - For existing team: caller must be team_admin or vice_captain
--     of that team, team_type='competitive' compatible (we promote
--     casual→competitive on first competitive registration)
--   - No existing competition_teams row for (competition_id, team_id)
--     in status pending/active — surfaces UNIQUE conflict as a clean
--     error rather than letting Postgres raise
--
-- Behaviour:
--   - team_type set to 'competitive' on the created/reused team
--   - team_admins gets a row with role='team_admin', granted_by=
--     auth.uid(), granted_at=now()
--   - competition_teams gets a row with status='pending' (DEFAULT)
--   - Single audit row; one venue broadcast 'team_registration_pending'
--
-- Squad collection is deferred — the team admin uses the existing
-- AdminView SquadScreen via /admin/<admin_token> once approval lands,
-- exactly like the existing casual-team onboarding flow.
--
-- Returns:
--   { "ok": true,
--     "team_id": "team_xxx",
--     "admin_token": "<token>",
--     "competition_team_id": "<uuid>",
--     "status": "pending" }

CREATE OR REPLACE FUNCTION public.join_register_team(
  p_league_code   text,
  p_competition_id uuid,
  p_team          jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_league record;
  v_comp record;
  v_team_id text;
  v_team_name text;
  v_team_short text;
  v_team_admin_token text;
  v_team_join_code text;
  v_existing_team_id text;
  v_competition_team_id uuid;
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  -- League by code
  IF p_league_code IS NULL OR length(trim(p_league_code)) = 0 THEN
    RAISE EXCEPTION 'league_code_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT id, venue_id, name, league_code, active
  INTO v_league
  FROM leagues
  WHERE league_code = upper(trim(p_league_code))
    AND active = true
  LIMIT 1;
  IF v_league.id IS NULL THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Competition belongs to league + accepting registrations
  IF p_competition_id IS NULL THEN
    RAISE EXCEPTION 'competition_id_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT c.id, c.season_id, c.status, s.league_id
  INTO v_comp
  FROM competitions c
  JOIN seasons s ON s.id = c.season_id
  WHERE c.id = p_competition_id;
  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp.league_id <> v_league.id THEN
    RAISE EXCEPTION 'competition_not_in_league' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp.status NOT IN ('setup','active') THEN
    RAISE EXCEPTION 'competition_closed_to_registration' USING ERRCODE = 'P0001',
      DETAIL = v_comp.status;
  END IF;

  -- Decide: new team OR existing
  v_existing_team_id := NULLIF(trim(p_team->>'existing_team_id'), '');

  IF v_existing_team_id IS NOT NULL THEN
    -- Existing team: caller must already admin it
    SELECT EXISTS (
      SELECT 1 FROM team_admins
      WHERE team_id = v_existing_team_id
        AND user_id = v_uid
        AND role IN ('team_admin','vice_captain')
        AND revoked_at IS NULL
    ) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'not_team_admin' USING ERRCODE = 'P0001';
    END IF;
    -- Promote casual → competitive (idempotent: no-op if already competitive)
    UPDATE teams
       SET team_type = 'competitive'
     WHERE id = v_existing_team_id
       AND team_type = 'casual';
    v_team_id := v_existing_team_id;

  ELSE
    -- New team
    v_team_name := NULLIF(trim(p_team->>'name'), '');
    IF v_team_name IS NULL OR length(v_team_name) > 120 THEN
      RAISE EXCEPTION 'team_name_required' USING ERRCODE = 'P0001';
    END IF;
    v_team_short := NULLIF(trim(p_team->>'short_name'), '');
    v_team_id := 'team_' || replace(gen_random_uuid()::text, '-', '');
    v_team_admin_token := gen_random_uuid()::text;
    v_team_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    INSERT INTO teams (
      id, name, admin_token, join_code, team_type,
      primary_colour, secondary_colour, admin_email, onboarding_complete
    ) VALUES (
      v_team_id, v_team_name, v_team_admin_token, v_team_join_code,
      'competitive',
      NULLIF(p_team->>'primary_colour', ''),
      NULLIF(p_team->>'secondary_colour', ''),
      NULLIF(p_team->>'admin_email', ''),
      true
    );

    INSERT INTO team_admins (team_id, user_id, role, granted_by, granted_at)
    VALUES (v_team_id, v_uid, 'team_admin', v_uid, now());
  END IF;

  -- Prevent duplicate pending/active registration to this competition
  IF EXISTS (
    SELECT 1 FROM competition_teams
    WHERE competition_id = p_competition_id
      AND team_id = v_team_id
      AND status IN ('pending','active')
  ) THEN
    RAISE EXCEPTION 'team_already_registered' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competition_teams (competition_id, team_id, status)
  VALUES (p_competition_id, v_team_id, 'pending')
  RETURNING id INTO v_competition_team_id;

  -- Resolve admin_token to return (existing teams may have one already)
  SELECT admin_token INTO v_team_admin_token FROM teams WHERE id = v_team_id;

  -- Audit
  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_team_id, v_uid, 'team_admin', ('user_id:' || v_uid::text),
    'team_registration_submitted', 'competition_team', v_competition_team_id::text,
    jsonb_build_object(
      'league_id', v_league.id,
      'league_code', v_league.league_code,
      'competition_id', p_competition_id,
      'venue_id', v_league.venue_id,
      'is_new_team', v_existing_team_id IS NULL,
      'team_name', (SELECT name FROM teams WHERE id = v_team_id)
    )
  );

  -- Broadcast to venue + league
  PERFORM public.notify_venue_change(v_league.venue_id, 'team_registration_pending');
  PERFORM public.notify_league_change(v_league.id, 'team_registration_pending');

  RETURN jsonb_build_object(
    'ok', true,
    'team_id', v_team_id,
    'admin_token', v_team_admin_token,
    'competition_team_id', v_competition_team_id,
    'status', 'pending'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.join_register_team(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_register_team(text, uuid, jsonb)
  TO authenticated;
