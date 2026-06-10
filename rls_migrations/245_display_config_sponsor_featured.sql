-- 245: venue_update_display_config — sponsor creative + featured-match pin
-- (Reception Display Part A2). Base body = the LIVE function (mig 167 logic +
-- the mig-239 manage_facility capability guard, which was injected live via
-- pg_get_functiondef rewrite — the 167 source file does NOT contain it).
--
-- Additions, all validated only when the key is present (null always allowed —
-- null clears the setting; the whole p_config replaces venues.display_config
-- as before, so the operator UI must always send the full object):
--   sponsor_image_url / sponsor_label / sponsor_title / sponsor_body /
--   sponsor_url / featured_pin_story_tag — must be string or null
--     → 'config_field_invalid' (DETAIL = offending key).
--     custom_message joins the same loop (was previously unvalidated).
--   sponsor_ratio — must be a number; CLAMPED server-side to 0..1 (not
--     rejected) and the clamped value is what gets persisted
--     → 'sponsor_ratio_invalid' when not a number.
--   featured_fixture_id — uuid string or null. Non-null must belong to this
--     venue's competitions (fixtures → competitions → seasons → leagues.venue_id)
--     → 'featured_fixture_invalid' (not a uuid) / 'fixture_not_in_venue'.
--   featured_pin_expires_at — timestamptz string or null
--     → 'featured_expiry_invalid'.
--
-- PIN handling, whole-config persist, audit_events insert (hard-rule #9) and
-- notify_venue_change('venue_updated') are unchanged — live displays re-pull
-- on save, which is how the sponsor creative + featured pin reach the screen.
-- Signature unchanged → grants preserved (restated below for explicitness).
--
-- Consumers (hard-rule #14): apps/venue DisplaySettings (Part C extends it to
-- send the new keys); apps/display reads them back via get_display_state's
-- display_config passthrough (featured.js pin honour + TallPromo sponsor).

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
  v_text_key  text;
  v_text_keys text[] := ARRAY['custom_message','sponsor_image_url','sponsor_label','sponsor_title','sponsor_body','sponsor_url','featured_pin_story_tag'];
  v_ratio     numeric;
  v_fid       uuid;
  v_pin_set   boolean := false;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;

  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'config_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_config ? 'mode' THEN
    v_mode := p_config->>'mode';
    IF v_mode NOT IN ('fixed','cycle','smart') THEN
      RAISE EXCEPTION 'mode_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_config ? 'interval_secs' THEN
    IF jsonb_typeof(p_config->'interval_secs') <> 'number' THEN
      RAISE EXCEPTION 'interval_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_interval := (p_config->>'interval_secs')::int;
    IF v_interval < 10 OR v_interval > 60 THEN
      RAISE EXCEPTION 'interval_out_of_range' USING ERRCODE = 'P0001';
    END IF;
  END IF;

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

  -- 245: sponsor + story-tag free-text fields — string or null when present
  FOREACH v_text_key IN ARRAY v_text_keys LOOP
    IF p_config ? v_text_key AND jsonb_typeof(p_config->v_text_key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'config_field_invalid' USING ERRCODE = 'P0001', DETAIL = v_text_key;
    END IF;
  END LOOP;

  -- 245: sponsor_ratio — number, clamped (not rejected) to 0..1
  IF p_config ? 'sponsor_ratio' AND jsonb_typeof(p_config->'sponsor_ratio') <> 'null' THEN
    IF jsonb_typeof(p_config->'sponsor_ratio') <> 'number' THEN
      RAISE EXCEPTION 'sponsor_ratio_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_ratio := LEAST(1, GREATEST(0, (p_config->>'sponsor_ratio')::numeric));
    p_config := jsonb_set(p_config, '{sponsor_ratio}', to_jsonb(v_ratio));
  END IF;

  -- 245: featured pin — fixture must belong to this venue's competitions
  IF p_config ? 'featured_fixture_id' AND jsonb_typeof(p_config->'featured_fixture_id') <> 'null' THEN
    IF jsonb_typeof(p_config->'featured_fixture_id') <> 'string' THEN
      RAISE EXCEPTION 'featured_fixture_invalid' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      v_fid := (p_config->>'featured_fixture_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'featured_fixture_invalid' USING ERRCODE = 'P0001';
    END;
    IF NOT EXISTS (
      SELECT 1
      FROM public.fixtures f
      JOIN public.competitions c ON c.id = f.competition_id
      JOIN public.seasons s ON s.id = c.season_id
      JOIN public.leagues l ON l.id = s.league_id
      WHERE f.id = v_fid AND l.venue_id = v_venue_id
    ) THEN
      RAISE EXCEPTION 'fixture_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 245: featured_pin_expires_at — timestamptz or null when present
  IF p_config ? 'featured_pin_expires_at' AND jsonb_typeof(p_config->'featured_pin_expires_at') <> 'null' THEN
    IF jsonb_typeof(p_config->'featured_pin_expires_at') <> 'string' THEN
      RAISE EXCEPTION 'featured_expiry_invalid' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      PERFORM (p_config->>'featured_pin_expires_at')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'featured_expiry_invalid' USING ERRCODE = 'P0001';
    END;
  END IF;

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
