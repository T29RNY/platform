-- Fix 1: admin_upsert_schedule — interpret kickoff as Europe/London, not UTC.
-- Fix 2: Correct REVOKE/GRANT — prior grants referenced 13-param signature, never applied to live 14-param function.
-- Fix 3: Subtract 1 hour from all future game_date_time values stored wrong during BST 2026.

CREATE OR REPLACE FUNCTION admin_upsert_schedule(
  p_admin_token        text,
  p_day_of_week        text,
  p_kickoff            text,
  p_venue              text,
  p_city               text,
  p_squad_size         int,
  p_price_per_player   int,
  p_bibs_enabled       boolean,
  p_opens_day          text,
  p_opens_time         text,
  p_priority_lead_mins int,
  p_reminders_config   jsonb,
  p_one_off_date       text,
  p_game_is_live       boolean DEFAULT null
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id     text;
  v_schedule_id text;
  v_opens_day   text;
  v_game_dt     timestamptz;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id INTO v_schedule_id FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;

  v_opens_day := COALESCE(
    NULLIF(p_opens_day, ''),
    (ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[
      ((ARRAY_POSITION(
          ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']::text[],
          p_day_of_week::text
        ) + 5) % 7) + 1
    ]
  );

  IF p_one_off_date IS NOT NULL AND p_one_off_date <> '' THEN
    -- Interpret kickoff as Europe/London wall-clock (DST-aware).
    -- Previous code cast without timezone, defaulting to UTC and causing
    -- a 1-hour BST offset on all kickoff-relative cron jobs.
    v_game_dt := (p_one_off_date || 'T' || p_kickoff || ':00') AT TIME ZONE 'Europe/London';
  ELSE
    SELECT game_date_time INTO v_game_dt FROM schedule WHERE id = v_schedule_id;
  END IF;

  UPDATE schedule SET
    day_of_week        = p_day_of_week,
    kickoff            = p_kickoff,
    venue              = p_venue,
    city               = p_city,
    squad_size         = p_squad_size,
    price_per_player   = p_price_per_player,
    bibs_enabled       = p_bibs_enabled,
    opens_day          = v_opens_day,
    opens_time         = p_opens_time,
    priority_lead_mins = p_priority_lead_mins,
    reminders_config   = p_reminders_config,
    game_date_time     = v_game_dt,
    game_is_live       = COALESCE(p_game_is_live, game_is_live)
  WHERE id = v_schedule_id AND team_id = v_team_id;

  PERFORM notify_team_change(v_team_id, 'schedule_updated');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'schedule_updated', 'schedule', v_schedule_id,
          jsonb_build_object('day_of_week', p_day_of_week, 'kickoff', p_kickoff,
                             'venue', p_venue, 'squad_size', p_squad_size));

  RETURN jsonb_build_object('ok', true, 'schedule_id', v_schedule_id);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE ALL    ON FUNCTION admin_upsert_schedule(text,text,text,text,text,int,int,boolean,text,text,int,jsonb,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_upsert_schedule(text,text,text,text,text,int,int,boolean,text,text,int,jsonb,text,boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION admin_upsert_schedule(text,text,text,text,text,int,int,boolean,text,text,int,jsonb,text,boolean) TO authenticated;

-- Correct existing game_date_time values stored 1hr too late during BST 2026.
-- Only touches future-dated real teams; demo excluded.
UPDATE schedule
SET    game_date_time = game_date_time - INTERVAL '1 hour'
WHERE  game_date_time IS NOT NULL
  AND  game_date_time > NOW()
  AND  team_id NOT LIKE 'team_demo%';
