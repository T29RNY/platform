-- 108_phase2_venue_update_ref.sql
--
-- Phase 2 (League Mode) — Cycle 2.6 match_officials partial-update RPC.
--
--   venue_update_ref(p_venue_token, p_ref_id, p_updates jsonb)
--     Updates ONLY the keys present in p_updates. Other columns
--     stay as-is. Soft-delete via {"active": false} rather than
--     DELETE (fixtures.official_id FK uses ON DELETE SET NULL).
--
-- Updatable keys (all optional):
--   "name"               text, 1..120
--   "phone"              text or null
--   "email"              text or null
--   "whatsapp_number"    text or null
--   "preferred_channel"  whatsapp|sms|email|push
--   "active"             boolean
--   "employment_type"    freelance|in_house
--   "overall_rating"     numeric or null

CREATE OR REPLACE FUNCTION public.venue_update_ref(
  p_venue_token text,
  p_ref_id      uuid,
  p_updates     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_ref record;
  v_changed text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_ref_id IS NULL THEN
    RAISE EXCEPTION 'ref_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object'
     OR p_updates = '{}'::jsonb THEN
    RAISE EXCEPTION 'updates_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, venue_id INTO v_ref FROM match_officials WHERE id = p_ref_id;
  IF v_ref.id IS NULL THEN
    RAISE EXCEPTION 'ref_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_ref.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'ref_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  IF p_updates ? 'name' THEN
    IF NULLIF(trim(p_updates->>'name'), '') IS NULL
       OR length(trim(p_updates->>'name')) > 120 THEN
      RAISE EXCEPTION 'ref_name_invalid' USING ERRCODE = 'P0001';
    END IF;
    UPDATE match_officials SET name = trim(p_updates->>'name') WHERE id = p_ref_id;
    v_changed := array_append(v_changed, 'name');
  END IF;
  IF p_updates ? 'phone' THEN
    UPDATE match_officials SET phone = NULLIF(p_updates->>'phone', '') WHERE id = p_ref_id;
    v_changed := array_append(v_changed, 'phone');
  END IF;
  IF p_updates ? 'email' THEN
    UPDATE match_officials SET email = NULLIF(p_updates->>'email', '') WHERE id = p_ref_id;
    v_changed := array_append(v_changed, 'email');
  END IF;
  IF p_updates ? 'whatsapp_number' THEN
    UPDATE match_officials SET whatsapp_number = NULLIF(p_updates->>'whatsapp_number', '') WHERE id = p_ref_id;
    v_changed := array_append(v_changed, 'whatsapp_number');
  END IF;
  IF p_updates ? 'preferred_channel' THEN
    -- Let the table CHECK constraint enforce the enum
    UPDATE match_officials SET preferred_channel = p_updates->>'preferred_channel' WHERE id = p_ref_id;
    v_changed := array_append(v_changed, 'preferred_channel');
  END IF;
  IF p_updates ? 'active' THEN
    UPDATE match_officials SET active = (p_updates->>'active')::boolean WHERE id = p_ref_id;
    v_changed := array_append(v_changed, 'active');
  END IF;
  IF p_updates ? 'employment_type' THEN
    UPDATE match_officials SET employment_type = p_updates->>'employment_type' WHERE id = p_ref_id;
    v_changed := array_append(v_changed, 'employment_type');
  END IF;
  IF p_updates ? 'overall_rating' THEN
    UPDATE match_officials SET overall_rating = NULLIF(p_updates->>'overall_rating', '')::numeric WHERE id = p_ref_id;
    v_changed := array_append(v_changed, 'overall_rating');
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RAISE EXCEPTION 'no_recognised_keys' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'ref_updated', 'match_official', p_ref_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'changed_keys', v_changed,
                       'updates', p_updates)
  );

  PERFORM public.notify_venue_change(v_venue_id, 'ref_updated');

  RETURN jsonb_build_object('ok', true, 'ref_id', p_ref_id, 'changed_keys', v_changed);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_update_ref(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_ref(text, uuid, jsonb) TO anon, authenticated;
