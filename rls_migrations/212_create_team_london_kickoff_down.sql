-- DOWN 212: restore the pre-212 create_team (bare UTC now() for the first
-- game_date_time; no SET search_path). Strict revert — re-introduces the summer
-- 1hr-late first-week reminders, which is correct for a down migration.

CREATE OR REPLACE FUNCTION public.create_team(p_admin_email text, p_team_name text, p_day_of_week text, p_kickoff text, p_squad_size integer, p_venue text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_price numeric DEFAULT 0, p_bibs_enabled boolean DEFAULT true, p_player_names text[] DEFAULT ARRAY[]::text[], p_opens_day text DEFAULT NULL::text, p_opens_time text DEFAULT NULL::text, p_priority_lead_mins integer DEFAULT NULL::integer, p_team_type text DEFAULT 'casual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  v_admin_pid      text;
  v_admin_ptoken   text;
  v_admin_name     text;
BEGIN
  IF p_team_name IS NULL OR trim(p_team_name) = '' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='team_name_required';
  END IF;
  IF p_admin_email IS NULL OR trim(p_admin_email) = '' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='admin_email_required';
  END IF;
  IF p_squad_size IS NULL OR p_squad_size < 1 OR p_squad_size > 30 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_squad_size';
  END IF;
  IF p_team_type IS NOT NULL AND p_team_type NOT IN ('casual', 'competitive') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_team_type';
  END IF;

  v_team_id     := generate_url_safe_token('team_', 8);
  v_admin_token := generate_url_safe_token('admin_', 16);
  v_join_code   := generate_url_safe_token('', 6);
  v_channel_key := gen_random_uuid()::text;
  v_schedule_id := 'sched_' || v_team_id;

  INSERT INTO teams (id, name, admin_token, join_code,
                     onboarding_complete, admin_email, live_channel_key,
                     team_type)
  VALUES (v_team_id, trim(p_team_name), v_admin_token, v_join_code,
          true, trim(p_admin_email), v_channel_key,
          COALESCE(p_team_type, 'casual'));

  v_opens_day := COALESCE(
    NULLIF(p_opens_day, ''),
    (ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[
      ((ARRAY_POSITION(
          ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']::text[],
          p_day_of_week::text
        ) + 5) % 7) + 1
    ]
  );

  v_target_dow := CASE p_day_of_week
    WHEN 'Sunday'    THEN 0  WHEN 'Monday'    THEN 1
    WHEN 'Tuesday'   THEN 2  WHEN 'Wednesday' THEN 3
    WHEN 'Thursday'  THEN 4  WHEN 'Friday'    THEN 5
    WHEN 'Saturday'  THEN 6  ELSE 1
  END;

  v_days_ahead := (v_target_dow - EXTRACT(DOW FROM now())::int + 7) % 7;

  IF v_days_ahead = 0 AND now()::time >= (p_kickoff || ':00')::time THEN
    v_days_ahead := 7;
  END IF;

  v_game_dt := date_trunc('day', now())
               + (v_days_ahead * interval '1 day')
               + (p_kickoff || ':00')::time;

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

  INSERT INTO settings (id, team_id, group_name)
  VALUES ('sett_' || v_team_id, v_team_id, trim(p_team_name));

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

  IF auth.uid() IS NOT NULL THEN
    INSERT INTO team_admins (team_id, user_id, role, granted_by)
    VALUES (v_team_id, auth.uid(), 'team_admin', null)
    ON CONFLICT DO NOTHING;

    v_admin_name   := split_part(trim(p_admin_email), '@', 1);
    v_admin_pid    := generate_url_safe_token('p_', 8);
    v_admin_ptoken := generate_url_safe_token('p_', 14);

    INSERT INTO players (
      id, name, token, type, disabled, priority,
      status, paid, owes, goals, motm, attended, total,
      bib_count, team, w, l, d, pay_count, late_dropouts,
      note, self_paid, user_id
    ) VALUES (
      v_admin_pid, v_admin_name, v_admin_ptoken,
      'regular', false, false,
      'none', false, 0, 0, 0, 0, 0, 0, null, 0, 0, 0, 0, 0, '', false,
      auth.uid()
    );

    INSERT INTO team_players (team_id, player_id)
    VALUES (v_team_id, v_admin_pid);
  END IF;

  RETURN jsonb_build_object(
    'team_id',            v_team_id,
    'admin_token',        v_admin_token,
    'join_code',          v_join_code,
    'live_channel_key',   v_channel_key,
    'players',            v_players_arr,
    'admin_player_token', v_admin_ptoken
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
