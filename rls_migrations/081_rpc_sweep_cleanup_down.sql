-- Down migration for 081 — restores the four dropped RPCs, recreates the
-- 13-arg admin_upsert_schedule overload, and removes the
-- notify_team_change call from submit_potm_vote. Bodies copied verbatim
-- from pg_get_functiondef at the time of the forward migration.

-- ─── Revert submit_potm_vote (remove broadcast) ────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_potm_vote(p_token text, p_match_id text, p_team_id text, p_nominee_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_existing  uuid;
BEGIN
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT id INTO v_existing FROM potm_votes
  WHERE match_id = p_match_id AND voter_id = v_player_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already_voted');
  END IF;

  INSERT INTO potm_votes (match_id, team_id, voter_id, nominee_id)
  VALUES (p_match_id, p_team_id, v_player_id, p_nominee_id);

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    p_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'potm_vote_cast_self', 'player', v_player_id,
    jsonb_build_object(
      'match_id',    p_match_id,
      'nominee_id',  p_nominee_id
    )
  );

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

-- ─── Restore admin_upsert_schedule 13-arg overload ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_upsert_schedule(
  p_admin_token text, p_day_of_week text, p_kickoff text, p_venue text,
  p_city text, p_squad_size integer, p_price_per_player integer,
  p_bibs_enabled boolean, p_opens_day text, p_opens_time text,
  p_priority_lead_mins integer, p_reminders_config jsonb, p_one_off_date text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id     text;
  v_schedule_id text;
  v_opens_day   text;
  v_game_dt     timestamptz;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
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
    v_game_dt := (p_one_off_date || ' ' || p_kickoff || ':00')::timestamptz;
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
    game_date_time     = v_game_dt
  WHERE id = v_schedule_id AND team_id = v_team_id;

  PERFORM notify_team_change(v_team_id, 'schedule_updated');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
          'schedule_updated', 'schedule', v_schedule_id,
          jsonb_build_object('day_of_week', p_day_of_week, 'kickoff', p_kickoff,
                             'venue', p_venue, 'squad_size', p_squad_size));

  RETURN jsonb_build_object('ok', true, 'schedule_id', v_schedule_id);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

-- ─── Restore player_create_cash_payment_entry ──────────────────────────────
CREATE OR REPLACE FUNCTION public.player_create_cash_payment_entry(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN set_player_paid(p_token);
END;
$function$;

-- ─── Restore unregister_push_subscription ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.unregister_push_subscription(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  DELETE FROM push_subscriptions WHERE player_id = v_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'push_subscription_removed', 'player', v_player_id,
    '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

-- ─── Restore admin_set_player_note ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_player_note(p_admin_token text, p_player_id text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id text;
  v_result  jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  IF p_note IS NOT NULL AND length(p_note) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  UPDATE players SET note = p_note WHERE id = p_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
    'player_note_updated', 'player', p_player_id,
    jsonb_build_object('note', p_note)
  );

  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname,
    'status', p.status, 'type', p.type, 'priority', p.priority,
    'paid', p.paid, 'owes', p.owes, 'self_paid', p.self_paid,
    'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended,
    'total', p.total, 'w', p.w, 'l', p.l, 'd', p.d,
    'bib_count', p.bib_count, 'late_dropouts', p.late_dropouts,
    'injured', p.injured, 'injured_since', p.injured_since,
    'is_guest', p.is_guest, 'guest_of', p.guest_of,
    'note', p.note, 'disabled', p.disabled,
    'disable_reason', p.disable_reason, 'team', p.team
  )
  INTO v_result
  FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_note_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

-- ─── Restore join_team_as_returning_player ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_team_as_returning_player(p_join_code text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_team_id        text;
  v_existing_id    text;
  v_existing_name  text;
  v_existing_nick  text;
  v_in_team_id     text;
  v_in_team_token  text;
  v_new_id         text;
  v_new_token      text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE join_code = p_join_code OR id = p_join_code LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='team_not_found';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='forbidden';
  END IF;

  SELECT id, name, nickname
    INTO v_existing_id, v_existing_name, v_existing_nick
    FROM players WHERE user_id = p_user_id ORDER BY created_at ASC LIMIT 1;

  IF v_existing_id IS NULL THEN
    RETURN jsonb_build_object('player_id', null, 'team_id', v_team_id, 'token', null, 'is_new_team', false);
  END IF;

  SELECT p.id, p.token
    INTO v_in_team_id, v_in_team_token
    FROM players p JOIN team_players tp ON tp.player_id = p.id
   WHERE p.user_id = p_user_id AND tp.team_id = v_team_id LIMIT 1;

  IF v_in_team_id IS NOT NULL THEN
    RETURN jsonb_build_object('player_id', v_in_team_id, 'team_id', v_team_id, 'token', v_in_team_token, 'is_new_team', false);
  END IF;

  v_new_id    := 'p_' || substr(md5(random()::text), 1, 8);
  v_new_token := generate_url_safe_token('p_', 14);

  INSERT INTO players (
    id, name, nickname, token, user_id, type, status,
    disabled, priority, paid, self_paid,
    goals, motm, attended, total,
    bib_count, w, l, d,
    pay_count, late_dropouts, is_guest
  ) VALUES (
    v_new_id, v_existing_name, v_existing_nick, v_new_token, p_user_id, 'regular', 'none',
    false, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false
  );

  INSERT INTO team_players (team_id, player_id) VALUES (v_team_id, v_new_id)
  ON CONFLICT (team_id, player_id) DO NOTHING;

  RETURN jsonb_build_object('player_id', v_new_id, 'team_id', v_team_id, 'token', v_new_token, 'is_new_team', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
