-- 166_check_display_pin.sql
-- League Mode Phase 4 (Reception Display), STAGE A3 — PIN check (read-only).
--
-- check_display_pin(p_display_token, p_pin) — validates a reception-TV PIN WITHOUT ever
-- shipping the PIN to the client (get_display_state deliberately omits display_pin).
-- Returns {pin_required, ok}:
--   pin_required = false  → venues.display_pin IS NULL (no gate; ok always true)
--   ok           = the supplied PIN matches venues.display_pin
-- READ-ONLY (STABLE) → no audit/broadcast, no ephemeral-verify needed. The
-- 3-strikes / 30-min lockout is enforced CLIENT-side (localStorage) — this RPC just
-- answers "is this PIN right". anon+authenticated (token is the auth signal).
-- Raises invalid_display_token for an unknown token.

CREATE OR REPLACE FUNCTION public.check_display_pin(p_display_token text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pin text;
  v_found boolean;
BEGIN
  IF p_display_token IS NULL OR length(trim(p_display_token)) = 0 THEN
    RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT display_pin, true INTO v_pin, v_found
  FROM public.venues WHERE display_token = p_display_token LIMIT 1;

  IF NOT v_found THEN
    RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001';
  END IF;

  IF v_pin IS NULL OR length(trim(v_pin)) = 0 THEN
    RETURN jsonb_build_object('pin_required', false, 'ok', true);
  END IF;

  RETURN jsonb_build_object('pin_required', true, 'ok', (p_pin IS NOT NULL AND p_pin = v_pin));
END;
$function$;

REVOKE ALL ON FUNCTION public.check_display_pin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_display_pin(text, text) TO anon, authenticated;
