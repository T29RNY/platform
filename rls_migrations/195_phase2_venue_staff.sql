-- 195_phase2_venue_staff.sql
--
-- Venue staff directory — all venue staff, not just match officials.
-- Reception, managers, admins, groundstaff, coaches. Match officials
-- stay in match_officials (refs); this is everyone else who works the
-- venue. Token-scoped CRUD mirroring the venue_add_ref pattern (mig 107).
--
--   venue_list_staff(p_venue_token)              -> { ok, staff: [...] }
--   venue_add_staff(p_venue_token, p_staff)      -> { ok, staff_id, venue_id }
--   venue_update_staff(p_venue_token, p_id, p_updates) -> { ok }
--
-- Verified end-to-end via ephemeral-verify (add/list/update/audit + 4
-- error paths), leak-check clean.

CREATE TABLE IF NOT EXISTS public.venue_staff (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name              text NOT NULL,
  role              text NOT NULL DEFAULT 'reception'
                      CHECK (role IN ('reception','manager','admin','groundstaff','coach','other')),
  email             text,
  phone             text,
  whatsapp_number   text,
  preferred_channel text NOT NULL DEFAULT 'email'
                      CHECK (preferred_channel IN ('whatsapp','sms','email','push')),
  notes             text,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_staff_venue ON public.venue_staff (venue_id);

-- RLS on, no permissive policies — all access via SECURITY DEFINER RPCs.
ALTER TABLE public.venue_staff ENABLE ROW LEVEL SECURITY;

-- ── Read ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_staff(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_staff jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(s ORDER BY s.active DESC, lower(s.name)), '[]'::jsonb)
  INTO v_staff
  FROM (
    SELECT id, name, role, email, phone, whatsapp_number,
           preferred_channel, notes, active, created_at
    FROM public.venue_staff
    WHERE venue_id = v_venue_id
  ) s;

  RETURN jsonb_build_object('ok', true, 'staff', v_staff);
END;
$function$;

-- ── Create ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_add_staff(
  p_venue_token text,
  p_staff       jsonb
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
  v_role text;
  v_staff_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  v_name := NULLIF(trim(p_staff->>'name'), '');
  IF v_name IS NULL OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'staff_name_required' USING ERRCODE = 'P0001';
  END IF;

  v_role := COALESCE(NULLIF(p_staff->>'role', ''), 'reception');
  IF v_role NOT IN ('reception','manager','admin','groundstaff','coach','other') THEN
    RAISE EXCEPTION 'staff_role_invalid' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.venue_staff (
    venue_id, name, role, email, phone, whatsapp_number, preferred_channel, notes, active
  )
  VALUES (
    v_venue_id, v_name, v_role,
    NULLIF(p_staff->>'email', ''),
    NULLIF(p_staff->>'phone', ''),
    NULLIF(p_staff->>'whatsapp_number', ''),
    COALESCE(NULLIF(p_staff->>'preferred_channel', ''), 'email'),
    NULLIF(p_staff->>'notes', ''),
    true
  )
  RETURNING id INTO v_staff_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'staff_added', 'venue_staff', v_staff_id::text,
    jsonb_build_object('name', v_name, 'role', v_role, 'venue_id', v_venue_id)
  );

  PERFORM public.notify_venue_change(v_venue_id, 'staff_added');

  RETURN jsonb_build_object('ok', true, 'staff_id', v_staff_id, 'venue_id', v_venue_id);
END;
$function$;

-- ── Update ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_update_staff(
  p_venue_token text,
  p_staff_id    uuid,
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
  v_owner text;
  v_role text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT venue_id INTO v_owner FROM public.venue_staff WHERE id = p_staff_id;
  IF v_owner IS NULL OR v_owner <> v_venue_id THEN
    RAISE EXCEPTION 'staff_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_updates ? 'role' THEN
    v_role := COALESCE(NULLIF(p_updates->>'role', ''), 'reception');
    IF v_role NOT IN ('reception','manager','admin','groundstaff','coach','other') THEN
      RAISE EXCEPTION 'staff_role_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.venue_staff SET
    name              = COALESCE(NULLIF(trim(p_updates->>'name'), ''), name),
    role              = CASE WHEN p_updates ? 'role' THEN v_role ELSE role END,
    email             = CASE WHEN p_updates ? 'email' THEN NULLIF(p_updates->>'email','') ELSE email END,
    phone             = CASE WHEN p_updates ? 'phone' THEN NULLIF(p_updates->>'phone','') ELSE phone END,
    whatsapp_number   = CASE WHEN p_updates ? 'whatsapp_number' THEN NULLIF(p_updates->>'whatsapp_number','') ELSE whatsapp_number END,
    preferred_channel = COALESCE(NULLIF(p_updates->>'preferred_channel',''), preferred_channel),
    notes             = CASE WHEN p_updates ? 'notes' THEN NULLIF(p_updates->>'notes','') ELSE notes END,
    active            = COALESCE((p_updates->>'active')::boolean, active)
  WHERE id = p_staff_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'staff_updated', 'venue_staff', p_staff_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_updates) k))
  );

  PERFORM public.notify_venue_change(v_venue_id, 'staff_updated');

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_list_staff(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venue_add_staff(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venue_update_staff(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_staff(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_add_staff(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_update_staff(text, uuid, jsonb) TO anon, authenticated;
