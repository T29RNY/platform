-- ============================================================
-- Migration 015: Onboarding RPCs
-- Phase B (design only — DO NOT EXECUTE)
-- ============================================================
-- Depends on:
--   001_helpers.sql                    — generate_url_safe_token
--   002_team_admins.sql                — team_admins table
--   004_teams_live_channel_key.sql     — teams.live_channel_key column
--   004b_team_players_created_at.sql   — team_players.created_at
--
-- Functions:
--   1. create_team                      — atomic single-transaction team creation
--   2. join_team_as_returning_player    — link existing auth user to new team
--
-- Note: create_team is the ONLY RPC that returns admin_token.
--       No other function returns admin_token under any circumstances.
-- ============================================================


-- ── 1. create_team ──────────────────────────────────────────────────────────────
-- Replaces the three-step onboarding flow (CreateTeam → AddPlayers → ShareLinks)
-- with a single atomic transaction. Returns admin_token so the caller can
-- navigate directly to /admin/<token> on completion.

CREATE OR REPLACE FUNCTION create_team(
  p_admin_email        text,
  p_team_name          text,
  p_day_of_week        text,
  p_kickoff            text,             -- 'HH:MM'
  p_squad_size         int,
  p_venue              text    DEFAULT null,
  p_city               text    DEFAULT null,
  p_price              numeric(10,2) DEFAULT 0,
  p_bibs_enabled       boolean DEFAULT true,
  p_player_names       text[]  DEFAULT ARRAY[]::text[],
  p_opens_day          text    DEFAULT null,
  p_opens_time         text    DEFAULT null,
  p_priority_lead_mins int     DEFAULT null
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id        text;
  v_admin_token    text;
  v_join_code      text;
  v_channel_key    text;
  v_schedule_id    text;
  v_opens_day      text;
  v_target_dow     int;
  v_days_ahead     int;
  v_game_dt        timestamptz;
  v_names          text[];
  v_name           text;
  v_pid            text;
  v_ptoken         text;
  v_players_arr    jsonb := '[]'::jsonb;
BEGIN
  -- Validate required fields
  IF p_team_name IS NULL OR trim(p_team_name) = '' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='team_name_required';
  END IF;
  IF p_admin_email IS NULL OR trim(p_admin_email) = '' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='admin_email_required';
  END IF;
  IF p_squad_size IS NULL OR p_squad_size < 1 OR p_squad_size > 30 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_squad_size';
  END IF;

  -- Step 1–4: Generate IDs
  v_team_id     := generate_url_safe_token('team_', 8);
  v_admin_token := generate_url_safe_token('admin_', 16);
  v_join_code   := generate_url_safe_token('', 6);
  v_channel_key := gen_random_uuid()::text;
  v_schedule_id := 'sched_' || v_team_id;

  -- Step 5: Insert team
  INSERT INTO teams (id, name, admin_token, join_code,
                     onboarding_complete, admin_email, live_channel_key)
  VALUES (v_team_id, trim(p_team_name), v_admin_token, v_join_code,
          true, trim(p_admin_email), v_channel_key);

  -- Step 6: Compute opens_day (day before p_day_of_week; same formula as 013)
  v_opens_day := COALESCE(
    NULLIF(p_opens_day, ''),
    (ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[
      ((ARRAY_POSITION(
          ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']::text[],
          p_day_of_week::text
        ) + 5) % 7) + 1
    ]
  );

  -- Step 7: Compute game_date_time — next occurrence of p_day_of_week at p_kickoff
  -- PostgreSQL EXTRACT(DOW): 0=Sunday … 6=Saturday
  v_target_dow := CASE p_day_of_week
    WHEN 'Sunday'    THEN 0  WHEN 'Monday'    THEN 1
    WHEN 'Tuesday'   THEN 2  WHEN 'Wednesday' THEN 3
    WHEN 'Thursday'  THEN 4  WHEN 'Friday'    THEN 5
    WHEN 'Saturday'  THEN 6  ELSE 1
  END;

  v_days_ahead := (v_target_dow - EXTRACT(DOW FROM now())::int + 7) % 7;

  -- Same-day check: if kickoff has already passed today, push to next week
  IF v_days_ahead = 0 AND now()::time >= (p_kickoff || ':00')::time THEN
    v_days_ahead := 7;
  END IF;

  v_game_dt := date_trunc('day', now())
               + (v_days_ahead * interval '1 day')
               + (p_kickoff || ':00')::time;

  -- Step 8: Insert schedule
  INSERT INTO schedule (
    id, team_id, day_of_week, kickoff, venue, city,
    squad_size, price_per_player, bibs_enabled,
    opens_day, opens_time, priority_lead_mins,
    game_date_time, auto_open_pending, active,
    is_draft, is_cancelled, game_is_live
  ) VALUES (
    v_schedule_id, v_team_id, p_day_of_week, p_kickoff,
    NULLIF(p_venue, ''), NULLIF(p_city, ''),
    p_squad_size, COALESCE(p_price, 0), COALESCE(p_bibs_enabled, true),
    v_opens_day, COALESCE(p_opens_time, '20:00'),
    COALESCE(p_priority_lead_mins, 60),
    v_game_dt, true, true, false, false, false
  );

  -- Step 9: Insert settings
  INSERT INTO settings (id, team_id, group_name)
  VALUES ('sett_' || v_team_id, v_team_id, trim(p_team_name));

  -- Step 10: Create initial players
  v_names := COALESCE(p_player_names, ARRAY[]::text[]);
  FOREACH v_name IN ARRAY v_names LOOP
    CONTINUE WHEN trim(v_name) = '';

    v_pid    := generate_url_safe_token('p_', 8);
    v_ptoken := generate_url_safe_token('p_', 14);

    INSERT INTO players (
      id, name, token, type, disabled, priority,
      status, paid, owes, goals, motm, attended, total,
      bib_count, team, w, l, d, pay_count, late_dropouts,
      note, self_paid
    ) VALUES (
      v_pid, trim(v_name), v_ptoken, 'regular', false, false,
      'none', false, 0, 0, 0, 0, 0, 0, null, 0, 0, 0, 0, 0, '', false
    );

    INSERT INTO team_players (team_id, player_id) VALUES (v_team_id, v_pid);

    v_players_arr := v_players_arr
      || jsonb_build_array(
           jsonb_build_object('id', v_pid, 'name', trim(v_name), 'token', v_ptoken)
         );
  END LOOP;

  -- Step 11: Link authenticated creator as team admin
  -- auth.uid() may be null for non-auth context (Stage 1: allow gracefully)
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO team_admins (team_id, user_id, role, granted_by)
    VALUES (v_team_id, auth.uid(), 'team_admin', null)
    ON CONFLICT DO NOTHING;  -- OI-67
  END IF;

  RETURN jsonb_build_object(
    'team_id',          v_team_id,
    'admin_token',      v_admin_token,
    'join_code',        v_join_code,
    'live_channel_key', v_channel_key,
    'players',          v_players_arr
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION create_team(text,text,text,text,int,text,text,int,boolean,text[],text,text,int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_team(text,text,text,text,int,text,text,int,boolean,text[],text,text,int) TO authenticated, anon;


-- ── 2. join_team_as_returning_player ───────────────────────────────────────────
-- Links an authenticated user's existing player record to a new team.
-- Returns null player_id when no player row exists for p_user_id — client
-- interprets this as "brand new user, show NameStep" and handles player creation.
-- Phase C: add auth.uid() == p_user_id server-side check for spoof protection.

CREATE OR REPLACE FUNCTION join_team_as_returning_player(
  p_join_code text,
  p_user_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id   text;
  v_player_id text;
  v_token     text;
BEGIN
  -- Resolve team from join_code (or team_id fallback, matching get_team_by_join_code)
  SELECT id INTO v_team_id FROM teams WHERE join_code = p_join_code OR id = p_join_code LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='team_not_found';
  END IF;

  -- OI-70: prevent authenticated callers from spoofing a different user_id
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='forbidden';
  END IF;

  -- Look for existing player row for this auth user
  SELECT id, token INTO v_player_id, v_token
  FROM players WHERE user_id = p_user_id LIMIT 1;

  -- No existing player record — signal client to show NameStep
  IF v_player_id IS NULL THEN
    RETURN jsonb_build_object(
      'player_id',    null,
      'team_id',      v_team_id,
      'token',        null,
      'is_new_team',  false
    );
  END IF;

  -- Already a member of this team
  IF EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = v_player_id
  ) THEN
    RETURN jsonb_build_object(
      'player_id',   v_player_id,
      'team_id',     v_team_id,
      'token',       v_token,
      'is_new_team', false
    );
  END IF;

  -- Link player to this team
  INSERT INTO team_players (team_id, player_id)
  VALUES (v_team_id, v_player_id)
  ON CONFLICT (team_id, player_id) DO NOTHING;

  RETURN jsonb_build_object(
    'player_id',   v_player_id,
    'team_id',     v_team_id,
    'token',       v_token,
    'is_new_team', true
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION join_team_as_returning_player(text,uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION join_team_as_returning_player(text,uuid) TO authenticated, anon;


-- ── Verification queries (commented out) ────────────────────────────────────────
-- SELECT proname FROM pg_proc
-- WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
--   AND proname IN ('create_team','join_team_as_returning_player');
-- Expected: 2 rows.
--
-- SELECT create_team('admin@test.com','Test FC','Tuesday','20:00',null,'London',
--                    10,5,true,ARRAY['Alice','Bob'],null,null,null);
-- → { team_id, admin_token, join_code, live_channel_key, players: [{id,name,token}x2] }
-- Verify: SELECT * FROM teams WHERE id = '<team_id>';
-- Verify: SELECT count(*) FROM players WHERE name IN ('Alice','Bob');  -- expect 2
-- Verify: SELECT * FROM schedule WHERE team_id = '<team_id>';
-- Verify: SELECT * FROM team_admins WHERE team_id = '<team_id>';