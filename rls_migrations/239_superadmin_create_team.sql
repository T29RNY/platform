-- 239_superadmin_create_team.sql
-- Operator-led casual squad creation from the superadmin dashboard (Create Squad tab) —
-- the casual equivalent of superadmin_create_venue. Creates the squad SHELL only: team +
-- schedule + settings, with an admin_token for hand-off. NO players, NO team_admins (the
-- admin_token IS the access path — /admin/<admin_token> — same model as a normal casual
-- team's admin_token from create_team). The new operator runs the squad via that link;
-- when they later sign in they can be linked as an account-admin separately.
--
-- WRITE RPC, is_platform_admin() gated. Ephemeral-verified (team=1 schedule=1 settings=1
-- members=0 admins=0 audit=1, rolled back, leak-check 0). Mirrors create_team's
-- schedule/settings setup exactly (DST-safe game_date_time, opens_day offset).

CREATE OR REPLACE FUNCTION superadmin_create_team(
  p_team_name   text,
  p_admin_email text,
  p_day_of_week text,
  p_kickoff     text,
  p_squad_size  integer,
  p_venue       text DEFAULT NULL,
  p_price       numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id     text;
  v_admin_token text;
  v_join_code   text;
  v_channel_key text;
  v_schedule_id text;
  v_opens_day   text;
  v_target_dow  int;
  v_days_ahead  int;
  v_game_dt     timestamptz;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_team_name IS NULL OR trim(p_team_name) = '' THEN
    RAISE EXCEPTION 'team_name_required';
  END IF;
  IF p_admin_email IS NULL OR position('@' in p_admin_email) = 0 THEN
    RAISE EXCEPTION 'admin_email_invalid';
  END IF;
  IF p_squad_size IS NULL OR p_squad_size < 1 OR p_squad_size > 30 THEN
    RAISE EXCEPTION 'invalid_squad_size';
  END IF;
  IF p_day_of_week NOT IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') THEN
    RAISE EXCEPTION 'invalid_day';
  END IF;

  v_team_id     := generate_url_safe_token('team_', 8);
  v_admin_token := generate_url_safe_token('admin_', 16);
  v_join_code   := generate_url_safe_token('', 6);
  v_channel_key := gen_random_uuid()::text;
  v_schedule_id := 'sched_' || v_team_id;

  INSERT INTO teams (id, name, admin_token, join_code, onboarding_complete, admin_email, live_channel_key, team_type)
  VALUES (v_team_id, trim(p_team_name), v_admin_token, v_join_code, true, trim(p_admin_email), v_channel_key, 'casual');

  v_opens_day := (ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[
      ((ARRAY_POSITION(ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']::text[], p_day_of_week::text) + 5) % 7) + 1];

  v_target_dow := CASE p_day_of_week
    WHEN 'Sunday' THEN 0 WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
    WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6 ELSE 1 END;

  v_days_ahead := (v_target_dow - EXTRACT(DOW FROM (now() AT TIME ZONE 'Europe/London'))::int + 7) % 7;
  IF v_days_ahead = 0 AND (now() AT TIME ZONE 'Europe/London')::time >= (p_kickoff || ':00')::time THEN
    v_days_ahead := 7;
  END IF;
  v_game_dt := ((((date_trunc('day', now() AT TIME ZONE 'Europe/London') + (v_days_ahead * interval '1 day'))::date)::text
                 || 'T' || p_kickoff || ':00')::timestamp) AT TIME ZONE 'Europe/London';

  INSERT INTO schedule (
    id, team_id, day_of_week, kickoff, venue, city, squad_size, price_per_player, bibs_enabled,
    opens_day, opens_time, priority_lead_mins, game_date_time, auto_open_pending, active, is_draft, is_cancelled, game_is_live
  ) VALUES (
    v_schedule_id, v_team_id, p_day_of_week, p_kickoff, NULLIF(p_venue, ''), NULL,
    p_squad_size, COALESCE(p_price, 0), true, v_opens_day, '20:00', 60, v_game_dt, true, true, false, false, false
  );

  INSERT INTO settings (id, team_id, group_name) VALUES ('sett_' || v_team_id, v_team_id, trim(p_team_name));

  INSERT INTO audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'super_admin', 'superadmin', 'team_created_by_admin', 'team', v_team_id,
          jsonb_build_object('admin_email', trim(p_admin_email), 'via', 'superadmin'));

  RETURN jsonb_build_object(
    'team_id', v_team_id, 'admin_token', v_admin_token, 'join_code', v_join_code, 'name', trim(p_team_name)
  );
END;
$$;

REVOKE ALL ON FUNCTION superadmin_create_team(text, text, text, text, integer, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION superadmin_create_team(text, text, text, text, integer, text, numeric) TO authenticated;
