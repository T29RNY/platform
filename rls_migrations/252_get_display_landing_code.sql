-- ════════════════════════════════════════════════════════════
-- Migration 252 — get_display_landing_code (QR Onboarding slice 4b)
-- The reception display (read-only, display_token-keyed, anon) fetches the
-- venue's canonical venue_landing /q/<code> ONCE to render a "scan to join"
-- QR panel. Read-only: the display never creates a code — the venue
-- provisions it via the dashboard QR view (venue_ensure_invite_link, mig 251).
-- Kept off the hot get_display_state broadcast payload on purpose (rarely
-- changes; fetched once on mount). Plan: QR_ONBOARDING_SCOPE.md slice 4b.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_display_landing_code(p_display_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue_id text;
  v_code     text;
BEGIN
  IF p_display_token IS NULL THEN RETURN jsonb_build_object('code', NULL); END IF;

  SELECT id INTO v_venue_id FROM venues WHERE display_token = p_display_token;
  IF v_venue_id IS NULL THEN RETURN jsonb_build_object('code', NULL); END IF;

  SELECT code INTO v_code FROM invite_links
   WHERE entity_type = 'venue' AND entity_id = v_venue_id
     AND action = 'venue_landing' AND active = true
   ORDER BY created_at ASC LIMIT 1;

  RETURN jsonb_build_object(
    'code', v_code,
    'url',  CASE WHEN v_code IS NOT NULL THEN 'https://in-or-out.com/q/' || v_code ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_display_landing_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_display_landing_code(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
