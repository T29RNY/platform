-- 189_phase9_player_contact.sql
-- LEAGUE MODE — Phase 9 (finish): player contact-capture + notification preference.
--
-- players.phone / players.notification_channel exist (mig 056) but nothing ever captured
-- a phone, so player SMS/WhatsApp could never deliver. This adds the player-self setter
-- (modelled on set_player_note) + a tiny read for prefill. Wiring the push→email→SMS
-- fallback into the 48h/2h reminder crons is the matching cron change (same Phase 9 finish).
--
-- whatsapp + sms both use players.phone (players have no separate whatsapp_number — only
-- match_officials do); email uses the player's linked auth email (user_id). Audit metadata
-- stores has_phone, never the number itself (PII lives only in players.phone).

CREATE OR REPLACE FUNCTION public.set_player_contact(p_token text, p_phone text, p_channel text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_phone     text;
  v_channel   text;
BEGIN
  IF p_token IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token'; END IF;

  SELECT p.id, tp.team_id INTO v_player_id, v_team_id
    FROM players p JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token ORDER BY tp.created_at ASC LIMIT 1;
  IF v_player_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token'; END IF;

  v_channel := lower(coalesce(p_channel, 'push'));
  IF v_channel NOT IN ('push','email','sms','whatsapp') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_channel';
  END IF;
  v_phone := NULLIF(btrim(coalesce(p_phone, '')), '');
  IF v_phone IS NOT NULL AND length(v_phone) > 32 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_phone';
  END IF;
  IF v_channel IN ('sms','whatsapp') AND v_phone IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='phone_required_for_channel';
  END IF;

  UPDATE players SET phone = v_phone, notification_channel = v_channel WHERE id = v_player_id;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'player', auth.uid(), 'player_token:' || md5(p_token),
          'player_contact_updated_self', 'player', v_player_id,
          jsonb_build_object('notification_channel', v_channel, 'has_phone', v_phone IS NOT NULL));

  PERFORM notify_team_change(v_team_id, 'player_contact_updated');

  RETURN jsonb_build_object('ok', true, 'phone', v_phone, 'notification_channel', v_channel);
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = 'P0001' THEN RAISE; END IF;
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_contact(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF p_token IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token'; END IF;
  SELECT jsonb_build_object(
           'phone', phone,
           'notification_channel', COALESCE(notification_channel, 'push'),
           'has_linked_email', user_id IS NOT NULL
         ) INTO v
  FROM players WHERE token = p_token LIMIT 1;
  IF v IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token'; END IF;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_player_contact(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_player_contact(text, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_contact(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_contact(text) TO anon, authenticated;
