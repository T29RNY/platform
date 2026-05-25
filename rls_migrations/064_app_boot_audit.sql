-- ════════════════════════════════════════════════════════════════════════════
-- 064 — log_app_boot RPC for PWA boot telemetry
-- ════════════════════════════════════════════════════════════════════════════
-- Writes one audit_events row per app boot. Captures:
--   - route_type (player / admin / demoadmin / join / create / unknown)
--   - display_mode (standalone PWA / browser)
--   - session_present_client (true if client's getSession() returned a user)
--   - actor_user_id (auth.uid()) — automatically set by the INSERT
--
-- The comparison of session_present_client vs actor_user_id IS NOT NULL
-- surfaces "client thinks authed but JWT not attached" mismatches, which
-- is the smoking gun for iOS PWA storage partition issues.
--
-- Best-effort token resolution: tries player_token first, falls back to
-- admin_token. If neither resolves to a team, the call returns silently
-- without writing a row (e.g. /create page before team exists).
--
-- Pure additive RPC. No existing function modified.
-- All exceptions swallowed — telemetry must never break the app boot.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_app_boot(
  p_token            text,
  p_route_type       text,
  p_display_mode     text,
  p_session_present  boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
BEGIN
  IF p_token IS NOT NULL THEN
    SELECT p.id, tp.team_id
      INTO v_player_id, v_team_id
      FROM players p
      JOIN team_players tp ON tp.player_id = p.id
     WHERE p.token = p_token
     ORDER BY tp.created_at ASC
     LIMIT 1;

    IF v_team_id IS NULL THEN
      SELECT id INTO v_team_id FROM teams WHERE admin_token = p_token;
    END IF;
  END IF;

  IF v_team_id IS NULL THEN RETURN; END IF;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    CASE WHEN p_token IS NOT NULL THEN 'player_token:' || md5(p_token) ELSE NULL END,
    'app_boot', 'player', COALESCE(v_player_id, 'unknown'),
    jsonb_build_object(
      'route_type',             COALESCE(p_route_type, 'unknown'),
      'display_mode',           COALESCE(p_display_mode, 'unknown'),
      'session_present_client', COALESCE(p_session_present, false)
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_app_boot(text, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.log_app_boot(text, text, text, boolean) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
