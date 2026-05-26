-- 107_phase2_venue_add_ref.sql
--
-- Phase 2 (League Mode) — Cycle 2.6 match_officials (referee/umpire/
-- judge) CRUD — create.
--
--   venue_add_ref(p_venue_token, p_ref jsonb)
--     Creates a new match_officials row owned by the caller's venue.
--
-- p_ref shape:
--   {
--     "name":              "Joe Smith",        -- required, max 120 chars
--     "phone":             "+447...",          -- optional
--     "email":             "joe@example.com",  -- optional
--     "whatsapp_number":   "+447...",          -- optional
--     "preferred_channel": "whatsapp",         -- optional, default 'push',
--                                                 must be whatsapp|sms|email|push
--     "employment_type":   "freelance",        -- optional, default 'freelance',
--                                                 must be freelance|in_house
--     "overall_rating":    4.5                 -- optional numeric
--   }
--
-- Validation:
--   - Caller resolves to venue
--   - name required
--   - preferred_channel + employment_type pass through table CHECK
--     constraints (mig 055 + mig 083 respectively)
--
-- Audit + venue broadcast 'ref_added'.
--
-- Returns: { "ok": true, "ref_id": "<uuid>", "venue_id": "..." }

CREATE OR REPLACE FUNCTION public.venue_add_ref(
  p_venue_token text,
  p_ref         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_name text;
  v_ref_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  v_name := NULLIF(trim(p_ref->>'name'), '');
  IF v_name IS NULL OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'ref_name_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO match_officials (
    venue_id, name, phone, email, whatsapp_number,
    preferred_channel, active, employment_type, overall_rating
  )
  VALUES (
    v_venue_id, v_name,
    NULLIF(p_ref->>'phone', ''),
    NULLIF(p_ref->>'email', ''),
    NULLIF(p_ref->>'whatsapp_number', ''),
    COALESCE(NULLIF(p_ref->>'preferred_channel', ''), 'push'),
    true,
    COALESCE(NULLIF(p_ref->>'employment_type', ''), 'freelance'),
    NULLIF(p_ref->>'overall_rating', '')::numeric
  )
  RETURNING id INTO v_ref_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'ref_added', 'match_official', v_ref_id::text,
    jsonb_build_object('name', v_name, 'venue_id', v_venue_id)
  );

  PERFORM public.notify_venue_change(v_venue_id, 'ref_added');

  RETURN jsonb_build_object('ok', true, 'ref_id', v_ref_id, 'venue_id', v_venue_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_add_ref(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_add_ref(text, jsonb) TO anon, authenticated;
