-- =============================================================================
-- Migration 018: Demo RPC
-- =============================================================================
-- Provides update_demo_interaction for the /demoadmin demo flow.
-- Callable by anon + authenticated (no auth required — demo is public).
-- No audit event, no broadcast, no admin token.
--
-- Upsert pattern: UPDATE first; INSERT ON CONFLICT if row missing.
-- p_session_id defaults to 'main' for backward compatibility.
-- =============================================================================

CREATE OR REPLACE FUNCTION update_demo_interaction(
  p_session_id text DEFAULT 'main'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid text := COALESCE(NULLIF(p_session_id, ''), 'main');
BEGIN
  -- Optimistic UPDATE path (row already exists)
  UPDATE demo_sessions
  SET    last_interaction = now()
  WHERE  id = v_sid;

  -- INSERT path if row was missing (ON CONFLICT handles race)
  IF NOT FOUND THEN
    INSERT INTO demo_sessions (id, last_interaction)
    VALUES (v_sid, now())
    ON CONFLICT (id) DO UPDATE
      SET last_interaction = now();
  END IF;

  RETURN jsonb_build_object('ok', true, 'session_id', v_sid);

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

GRANT  EXECUTE ON FUNCTION update_demo_interaction(text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION update_demo_interaction(text) FROM PUBLIC;
