-- ── 361 DOWN: revert DB background calls to the apex/www + old CRON_SECRET ───────
-- Rollback for 361. Re-points the 7 cron jobs back to www.in-or-out.com with the
-- pre-rotation bearer, and both functions back to apex/www. Use ONLY alongside
-- reverting CRON_SECRET on platform-clubmanager back to the old value, or every
-- job will 401. (apex/www still serves /api until Phase 5 of the domain migration.)

SELECT cron.schedule('notif-flush-queue', '*/15 * * * *', $cron$
  SELECT net.http_post(
    url     := 'https://www.in-or-out.com/api/notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer Liverp00l123?!!*'
    ),
    body    := '{"cronType":"flushQueue"}'::jsonb
  );
$cron$);

SELECT cron.schedule('notif-game-day-9am', '0 9 * * *', $cron$
  SELECT net.http_post(
    url     := 'https://www.in-or-out.com/api/notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer Liverp00l123?!!*'
    ),
    body    := '{"cronType":"gameDay9am"}'::jsonb
  );
$cron$);

SELECT cron.schedule('notif-one-hr-before', '*/15 * * * *', $cron$
  SELECT net.http_post(
    url     := 'https://www.in-or-out.com/api/notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer Liverp00l123?!!*'
    ),
    body    := '{"cronType":"oneHrBefore"}'::jsonb
  );
$cron$);

SELECT cron.schedule('notif-debt-reminder', '*/15 * * * *', $cron$
  SELECT net.http_post(
    url     := 'https://www.in-or-out.com/api/notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer Liverp00l123?!!*'
    ),
    body    := '{"cronType":"debtReminder"}'::jsonb
  );
$cron$);

SELECT cron.schedule('notif-bibs-24hr', '0 * * * *', $cron$
  SELECT net.http_post(
    url     := 'https://www.in-or-out.com/api/notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer Liverp00l123?!!*'
    ),
    body    := '{"cronType":"bibs24hr"}'::jsonb
  );
$cron$);

SELECT cron.schedule('notif-bibs-45min', '*/15 * * * *', $cron$
  SELECT net.http_post(
    url     := 'https://www.in-or-out.com/api/notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer Liverp00l123?!!*'
    ),
    body    := '{"cronType":"bibs45min"}'::jsonb
  );
$cron$);

SELECT cron.schedule('inorout-cron-main', '*/15 * * * *', $cron$
  SELECT net.http_post(
    url     := 'https://www.in-or-out.com/api/cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer Liverp00l123?!!*'
    ),
    body    := '{}'::jsonb
  );
$cron$);

CREATE OR REPLACE FUNCTION public.notify_spot_opened()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id   text;
  v_squad     int;
  v_game_dt   timestamptz;
  v_day       text;
  v_in_count  int;
  v_reserve   text;
BEGIN
  IF COALESCE(current_setting('inorout.bulk_reset', true), '') <> '' THEN
    RETURN NEW;
  END IF;

  SELECT team_id INTO v_team_id FROM team_players WHERE player_id = NEW.id LIMIT 1;
  IF v_team_id IS NULL THEN RETURN NEW; END IF;

  SELECT squad_size, game_date_time, day_of_week
    INTO v_squad, v_game_dt, v_day
    FROM schedule
   WHERE team_id = v_team_id AND active = true
     AND game_is_live = true AND COALESCE(is_cancelled, false) = false
   LIMIT 1;
  IF v_squad IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_in_count
    FROM players p JOIN team_players tp ON tp.player_id = p.id
   WHERE tp.team_id = v_team_id
     AND p.status = 'in' AND NOT p.disabled AND NOT p.injured;
  IF v_in_count >= v_squad THEN RETURN NEW; END IF;

  SELECT p.id INTO v_reserve
    FROM players p JOIN team_players tp ON tp.player_id = p.id
   WHERE tp.team_id = v_team_id AND p.status = 'reserve' AND NOT p.disabled
   ORDER BY tp.reserve_priority_order NULLS LAST, tp.created_at
   LIMIT 1;
  IF v_reserve IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url     := 'https://www.in-or-out.com/api/notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'type',      'spotOpened',
      'teamId',    v_team_id,
      'playerIds', jsonb_build_array(v_reserve),
      'payload',   jsonb_build_object(
        'title', 'In or Out ⚽',
        'body',  '🟣 A spot''s opened up for ' || COALESCE(v_day, 'the game') || ' — tap to claim it!',
        'icon',  '/icons/icon-192.png'),
      'gameDate',  to_char(v_game_dt, 'YYYY-MM-DD')
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_display_landing_code(p_display_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue_id text;
  v_code     text;
BEGIN
  IF p_display_token IS NULL THEN RETURN jsonb_build_object('code', NULL); END IF;

  SELECT id INTO v_venue_id FROM venues WHERE display_token = p_display_token;
  IF v_venue_id IS NULL THEN RETURN jsonb_build_object('code', NULL); END IF;

  SELECT code INTO v_code FROM invite_links
   WHERE entity_type = 'venue' AND entity_id = v_venue_id
     AND action = 'venue_landing' AND active = true
   ORDER BY created_at ASC LIMIT 1;

  RETURN jsonb_build_object(
    'code', v_code,
    'url',  CASE WHEN v_code IS NOT NULL THEN 'https://in-or-out.com/q/' || v_code ELSE NULL END
  );
END;
$function$;
