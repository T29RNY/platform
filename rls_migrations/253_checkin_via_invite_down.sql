-- 253 down — remove checkin_via_invite; restore resolve_invite_link fixture
-- branch to the lean mig-248 version (fixture_id only).

DROP FUNCTION IF EXISTS public.checkin_via_invite(text, text);

CREATE OR REPLACE FUNCTION public.resolve_invite_link(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link        invite_links%ROWTYPE;
  v_status      text;
  v_destination jsonb;
BEGIN
  IF p_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found');
  END IF;

  SELECT * INTO v_link FROM invite_links WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found', 'code', p_code);
  END IF;

  v_status :=
    CASE
      WHEN NOT v_link.active                                                THEN 'inactive'
      WHEN v_link.expires_at IS NOT NULL AND v_link.expires_at < now()      THEN 'expired'
      WHEN v_link.max_uses   IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN 'exhausted'
      ELSE 'ok'
    END;

  IF v_link.entity_type = 'team' THEN
    SELECT jsonb_build_object('team_id', t.id, 'team_name', t.name)
      INTO v_destination FROM teams t WHERE t.id = v_link.entity_id;
  ELSIF v_link.entity_type = 'venue' THEN
    SELECT jsonb_build_object(
             'venue_id', v.id, 'venue_name', v.name, 'logo_url', v.logo_url,
             'primary_colour', v.primary_colour, 'secondary_colour', v.secondary_colour)
      INTO v_destination FROM venues v WHERE v.id = v_link.entity_id;
  ELSIF v_link.entity_type = 'fixture' THEN
    v_destination := jsonb_build_object('fixture_id', v_link.entity_id);
  END IF;

  IF v_destination IS NULL THEN
    v_status := 'not_found';
  END IF;

  RETURN jsonb_build_object(
    'ok',          v_status = 'ok',
    'status',      v_status,
    'code',        v_link.code,
    'action',      v_link.action,
    'entity_type', v_link.entity_type,
    'entity_id',   v_link.entity_id,
    'destination', v_destination
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_invite_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_invite_link(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
