-- 457: Match Workout Tracking PR #4 — consent toggle read/write RPCs
--
-- mig 456 added players.share_match_fitness (teammate-sharing consent, default false). This adds the
-- two authenticated-only SECURITY DEFINER RPCs the player-profile toggle needs (Hard Rule #2: no
-- direct client writes). Consent is GLOBAL: the profile toggle is a single switch, so the setter
-- writes ALL of the caller's player rows (one consent across every squad they're in). The reader
-- collapses those rows with bool_or so the toggle shows ON if consent is set anywhere.
--
-- Tier-3 (RLS + new write RPC): drafted + ephemeral-verified with rollback, APPLIED ONLY after
-- operator sign-off. The toggle is harmless until display exists (decision #2 defers the teammate
-- display), but the consent must be capturable now (decision #6).
--
--   • get_my_share_match_fitness()        — { ok, share_match_fitness } (bool_or across the caller's rows)
--   • set_share_match_fitness(p_value)     — sets ALL the caller's player rows; audits (HR#9); { ok, share_match_fitness }

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_my_share_match_fitness — read-back for the toggle's current state
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_share_match_fitness()
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
    RETURN jsonb_build_object('ok', true, 'share_match_fitness', false);
  END IF;

  SELECT COALESCE(bool_or(share_match_fitness), false)
    INTO v_value
    FROM players
   WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'share_match_fitness', COALESCE(v_value, false));
END;
$function$;

REVOKE ALL ON FUNCTION get_my_share_match_fitness() FROM anon, public;
GRANT EXECUTE ON FUNCTION get_my_share_match_fitness() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. set_share_match_fitness — global consent write (all the caller's player rows)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_share_match_fitness(p_value boolean)
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
     SET share_match_fitness = p_value
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
    'match_fitness_consent_set', 'player_consent', v_user_id::text,
    jsonb_build_object('share_match_fitness', p_value, 'rows_updated', v_rows)
  );

  RETURN jsonb_build_object('ok', true, 'share_match_fitness', p_value, 'rows_updated', v_rows);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION set_share_match_fitness(boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION set_share_match_fitness(boolean) TO authenticated;

-- Refresh PostgREST so the two new RPCs resolve immediately (avoids the 404 cache trap).
SELECT pg_notify('pgrst', 'reload schema');
