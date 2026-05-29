-- 167_venue_update_display_config.sql
-- League Mode Phase 4 (Reception Display), STAGE A4 — venue display config write RPC.
--
-- venue_update_display_config(p_venue_token, p_config, p_display_pin) — the operator
-- (venue_admin_token, resolved via resolve_venue_caller) sets the reception-TV panel
-- layout (venues.display_config) and optionally the PIN (venues.display_pin). This is
-- the ONLY write in Phase 4; ephemeral-verify gate applies.
--
-- p_config (jsonb object) — validated shape:
--   zones          text[]  (optional) ordered list of enabled zones; each must be a
--                            known key (live_scores/standings/top_scorers/upcoming/
--                            recent/goals_ticker/custom_message)
--   mode           text    (optional) fixed | cycle | smart
--   interval_secs  int     (optional) 10..60 (cycle dwell)
--   custom_message text    (optional) free text
-- p_display_pin — NULL = leave PIN unchanged; '' = clear PIN; else must be 4–8 digits.
--
-- Pattern mirrors venue_update_booking_settings (mig 150): resolve_venue_caller →
-- venue_id; audit_events (Phase 2 shape, hard-rule #9); notify_venue_change('venue_updated').
-- SECURITY DEFINER, search_path pinned, anon+authenticated (parity-sweep mig 075).
--
-- Consumers (hard-rule #14): apps/venue Reception Display settings editor (Stage C).

CREATE OR REPLACE FUNCTION public.venue_update_display_config(
  p_venue_token text,
  p_config jsonb,
  p_display_pin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_mode      text;
  v_interval  int;
  v_zone      text;
  v_known     text[] := ARRAY['live_scores','standings','top_scorers','upcoming','recent','goals_ticker','custom_message'];
  v_pin_set   boolean := false;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'config_required' USING ERRCODE = 'P0001';
  END IF;

  -- mode
  IF p_config ? 'mode' THEN
    v_mode := p_config->>'mode';
    IF v_mode NOT IN ('fixed','cycle','smart') THEN
      RAISE EXCEPTION 'mode_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- interval_secs
  IF p_config ? 'interval_secs' THEN
    IF jsonb_typeof(p_config->'interval_secs') <> 'number' THEN
      RAISE EXCEPTION 'interval_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_interval := (p_config->>'interval_secs')::int;
    IF v_interval < 10 OR v_interval > 60 THEN
      RAISE EXCEPTION 'interval_out_of_range' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- zones
  IF p_config ? 'zones' THEN
    IF jsonb_typeof(p_config->'zones') <> 'array' THEN
      RAISE EXCEPTION 'zones_invalid' USING ERRCODE = 'P0001';
    END IF;
    FOR v_zone IN SELECT jsonb_array_elements_text(p_config->'zones') LOOP
      IF NOT (v_zone = ANY(v_known)) THEN
        RAISE EXCEPTION 'zone_unknown' USING ERRCODE = 'P0001', DETAIL = v_zone;
      END IF;
    END LOOP;
  END IF;

  -- PIN (NULL = leave; '' = clear; else 4–8 digits)
  IF p_display_pin IS NOT NULL THEN
    IF length(trim(p_display_pin)) > 0 AND trim(p_display_pin) !~ '^[0-9]{4,8}$' THEN
      RAISE EXCEPTION 'pin_invalid' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.venues SET display_pin = NULLIF(trim(p_display_pin), '') WHERE id = v_venue_id;
    v_pin_set := true;
  END IF;

  UPDATE public.venues SET display_config = p_config WHERE id = v_venue_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'display_config_updated', 'venue', v_venue_id,
    jsonb_build_object('venue_id', v_venue_id, 'config', p_config, 'pin_changed', v_pin_set)
  );

  PERFORM public.notify_venue_change(v_venue_id, 'venue_updated');

  RETURN jsonb_build_object('ok', true, 'pin_changed', v_pin_set);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_update_display_config(text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_display_config(text, jsonb, text) TO anon, authenticated;
