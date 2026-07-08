-- 502: Smart Teams Balancer PR #4 — fitness-in-balancing consent (ships DARK)
--
-- Fitness-in-balancing is a NEW processing purpose distinct from the mig-457 display consent
-- (players.share_match_fitness). The signed DPIA (2026-07-07) §5 states match fitness is "never
-- used to rank a player against anyone outside their squad" — but balancing IS a ranking op, so
-- this needs its OWN default-OFF consent AND a DPIA addendum re-sign (new Purpose 3, R5
-- re-assessment). This migration + PR ship DARK: they CAPTURE the consent while the DPIA is being
-- re-signed; NOTHING reads use_fitness_for_balancing yet (PR #5 adds the reader, gated on this
-- flag + NOT _health_is_under_18). Do NOT apply until the operator confirms the DPIA re-sign.
--
-- Mirrors mig 457's global-consent pattern exactly (one switch across all the caller's player
-- rows, bool_or read-back, audited setter per Hard Rule #9). Authenticated-only; no anon.
--
--   • players.use_fitness_for_balancing boolean NOT NULL DEFAULT false  (new consent column)
--   • get_my_use_fitness_for_balancing()      — { ok, use_fitness_for_balancing } (bool_or)
--   • set_use_fitness_for_balancing(p_value)   — sets ALL caller rows; audits; { ok, ... }

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Consent column — default OFF, no NULLs.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS use_fitness_for_balancing boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_my_use_fitness_for_balancing — read-back for the toggle's current state
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_use_fitness_for_balancing()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_value   boolean;
BEGIN
  IF v_user_id IS NULL THEN
    -- Token-only / unauthenticated caller: report consent OFF so the toggle self-defaults safely.
    RETURN jsonb_build_object('ok', true, 'use_fitness_for_balancing', false);
  END IF;

  SELECT COALESCE(bool_or(use_fitness_for_balancing), false)
    INTO v_value
    FROM players
   WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'use_fitness_for_balancing', COALESCE(v_value, false));
END;
$function$;

REVOKE ALL ON FUNCTION get_my_use_fitness_for_balancing() FROM anon, public;
GRANT EXECUTE ON FUNCTION get_my_use_fitness_for_balancing() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. set_use_fitness_for_balancing — global consent write (all the caller's player rows)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_use_fitness_for_balancing(p_value boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_rows    int;
  v_team_id text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_value IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  UPDATE players
     SET use_fitness_for_balancing = p_value
   WHERE user_id = v_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Audit (Hard Rule #9). audit_events.team_id is NOT NULL text with no FK; use one of the caller's
  -- teams where known, else the literal 'health'. One summary row (consent is a per-user global flag).
  SELECT tp.team_id INTO v_team_id
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
   WHERE p.user_id = v_user_id
   LIMIT 1;
  v_team_id := COALESCE(v_team_id, 'health');

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', v_user_id, 'auth_uid:' || v_user_id::text,
    'fitness_balancing_consent_set', 'player_consent', v_user_id::text,
    jsonb_build_object('use_fitness_for_balancing', p_value, 'rows_updated', v_rows)
  );

  RETURN jsonb_build_object('ok', true, 'use_fitness_for_balancing', p_value, 'rows_updated', v_rows);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION set_use_fitness_for_balancing(boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION set_use_fitness_for_balancing(boolean) TO authenticated;

-- Refresh PostgREST so the two new RPCs resolve immediately (avoids the 404 cache trap).
SELECT pg_notify('pgrst', 'reload schema');
