-- Migration 486: Venue Setup Wizard PR-W3 — details/branding + opening-hours +
-- dismissal write path. Three SECDEF setters + two additive columns.
--
-- Fills the ONLY genuine new-backend gap in the whole epic: the `venues` branding/
-- address columns (name/address/city/postcode/logo_url/*_colour/contact_*) exist
-- (mig 055) but NOTHING writes them. Modelled on venue_update_booking_settings
-- (mig 150) — partial-jsonb update, per-key whitelist, audited — plus the
-- _venue_has_cap('manage_facility') gate from mig 400 (booking_settings omits the
-- cap; a details/branding/hours write is facility config, so we gate it).
--
-- All three: SECURITY DEFINER, search_path pinned, resolve_venue_caller token gate,
-- manage_facility cap, canonical audit_events insert (HR#9), REVOKE ALL then GRANT
-- anon+authenticated (same shape as every venue write RPC — the shared
-- venue_admin_token backdoor needs anon; the self-serve owner resolves Stage-1b via
-- auth.uid()).
--
-- Two additive columns (Decision #2 + #6):
--   venues.opening_hours          — venue-level weekly hours, independent of pitch
--                                   booking_windows (they describe different facts).
--   venues.setup_dismissed_steps  — a DISMISSAL set (never a completion set);
--                                   completion stays DERIVED from real state.

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS opening_hours jsonb,                                  -- [{day_of_week 0-6, open_time, close_time, closed?}]
  ADD COLUMN IF NOT EXISTS setup_dismissed_steps jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ===========================================================================
-- 1. venue_update_details — partial update of the venues branding/contact row.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.venue_update_details(
  p_venue_token text,
  p_updates     jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_changed  text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' OR p_updates = '{}'::jsonb THEN
    RAISE EXCEPTION 'updates_required' USING ERRCODE = 'P0001';
  END IF;

  -- name is the one non-nullable identity field: if supplied it must be non-empty.
  IF p_updates ? 'name' THEN
    IF NULLIF(trim(p_updates->>'name'), '') IS NULL THEN
      RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
    END IF;
    UPDATE venues SET name = trim(p_updates->>'name') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'name');
  END IF;

  -- Free-text fields: trim, empty-string → NULL (a blanked field clears cleanly).
  IF p_updates ? 'address' THEN
    UPDATE venues SET address = NULLIF(trim(p_updates->>'address'), '') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'address');
  END IF;
  IF p_updates ? 'city' THEN
    UPDATE venues SET city = NULLIF(trim(p_updates->>'city'), '') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'city');
  END IF;
  IF p_updates ? 'postcode' THEN
    UPDATE venues SET postcode = NULLIF(trim(p_updates->>'postcode'), '') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'postcode');
  END IF;
  IF p_updates ? 'logo_url' THEN
    UPDATE venues SET logo_url = NULLIF(trim(p_updates->>'logo_url'), '') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'logo_url');
  END IF;
  IF p_updates ? 'primary_colour' THEN
    UPDATE venues SET primary_colour = NULLIF(trim(p_updates->>'primary_colour'), '') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'primary_colour');
  END IF;
  IF p_updates ? 'secondary_colour' THEN
    UPDATE venues SET secondary_colour = NULLIF(trim(p_updates->>'secondary_colour'), '') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'secondary_colour');
  END IF;
  IF p_updates ? 'contact_email' THEN
    UPDATE venues SET contact_email = NULLIF(trim(p_updates->>'contact_email'), '') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'contact_email');
  END IF;
  IF p_updates ? 'contact_phone' THEN
    UPDATE venues SET contact_phone = NULLIF(trim(p_updates->>'contact_phone'), '') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'contact_phone');
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RAISE EXCEPTION 'no_recognised_keys' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_updated', 'venue', v_venue_id,
          jsonb_build_object('venue_id', v_venue_id, 'changed_keys', v_changed, 'updates', p_updates));

  PERFORM public.notify_venue_change(v_venue_id, 'venue_updated');

  RETURN jsonb_build_object('ok', true, 'changed_keys', v_changed);
END;
$function$;

REVOKE ALL    ON FUNCTION public.venue_update_details(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.venue_update_details(text, jsonb) TO anon, authenticated;

-- ===========================================================================
-- 2. venue_update_hours — replace the venue-level weekly opening hours.
--    Venue hours are the outer bound a customer sees; distinct from each pitch's
--    booking_windows (Decision #6). Full-replace of the weekly array.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.venue_update_hours(
  p_venue_token text,
  p_hours       jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_elem     jsonb;
  v_dow      int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  -- NULL clears; otherwise must be an array of {day_of_week 0-6, ...}.
  IF p_hours IS NOT NULL THEN
    IF jsonb_typeof(p_hours) <> 'array' THEN
      RAISE EXCEPTION 'hours_must_be_array' USING ERRCODE = 'P0001';
    END IF;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_hours) LOOP
      IF jsonb_typeof(v_elem) <> 'object' OR NOT (v_elem ? 'day_of_week') THEN
        RAISE EXCEPTION 'hours_element_invalid' USING ERRCODE = 'P0001';
      END IF;
      v_dow := (v_elem->>'day_of_week')::int;
      IF v_dow < 0 OR v_dow > 6 THEN
        RAISE EXCEPTION 'day_of_week_out_of_range' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  UPDATE venues SET opening_hours = p_hours WHERE id = v_venue_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_hours_updated', 'venue', v_venue_id,
          jsonb_build_object('venue_id', v_venue_id, 'hours', p_hours));

  PERFORM public.notify_venue_change(v_venue_id, 'venue_updated');

  RETURN jsonb_build_object('ok', true, 'opening_hours', p_hours);
END;
$function$;

REVOKE ALL    ON FUNCTION public.venue_update_hours(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.venue_update_hours(text, jsonb) TO anon, authenticated;

-- ===========================================================================
-- 3. venue_set_setup_dismissed — add/remove a step id from the dismissal set.
--    A DISMISSAL store only (Decision #2): "skip for now" persists across
--    sessions; completion stays derived. Idempotent.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.venue_set_setup_dismissed(
  p_venue_token text,
  p_step_id     text,
  p_dismissed   boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_current  jsonb;
  v_next     jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(trim(p_step_id), '') IS NULL THEN
    RAISE EXCEPTION 'step_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_dismissed IS NULL THEN
    RAISE EXCEPTION 'dismissed_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(setup_dismissed_steps, '[]'::jsonb) INTO v_current
    FROM venues WHERE id = v_venue_id;

  IF p_dismissed THEN
    -- add if absent (dedup)
    IF v_current @> to_jsonb(ARRAY[p_step_id]) THEN
      v_next := v_current;
    ELSE
      v_next := v_current || to_jsonb(p_step_id);
    END IF;
  ELSE
    -- remove all occurrences
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_next
      FROM jsonb_array_elements(v_current) e
      WHERE e <> to_jsonb(p_step_id);
  END IF;

  UPDATE venues SET setup_dismissed_steps = v_next WHERE id = v_venue_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_setup_step_dismissed', 'venue', v_venue_id,
          jsonb_build_object('venue_id', v_venue_id, 'step_id', p_step_id, 'dismissed', p_dismissed));

  RETURN jsonb_build_object('ok', true, 'setup_dismissed_steps', v_next);
END;
$function$;

REVOKE ALL    ON FUNCTION public.venue_set_setup_dismissed(text, text, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION public.venue_set_setup_dismissed(text, text, boolean) TO anon, authenticated;
