-- 039_player_self_profile_reads.sql
-- Session A (PROFILE_SCOPE step A4).
-- Two SECURITY DEFINER reads authed by player token:
--   get_my_payment_history(p_token, p_limit) → jsonb[]
--   get_my_injuries(p_token)                  → jsonb[]
-- Both derive (player_id, team_id) from the players.token + team_players
-- join — same pattern as set_player_injured. Granted to anon + authenticated
-- because /p/TOKEN PWA flow runs unauthenticated.

CREATE OR REPLACE FUNCTION public.get_my_payment_history(
  p_token text,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_ledger    jsonb;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',         pl.id,
      'team_id',    pl.team_id,
      'player_id',  pl.player_id,
      'match_id',   pl.match_id,
      'amount',     pl.amount,
      'type',       pl.type,
      'status',     pl.status,
      'method',     pl.method,
      'paid_by',    pl.paid_by,
      'paid_at',    pl.paid_at,
      'note',       pl.note,
      'created_at', pl.created_at,
      'updated_at', pl.updated_at
    ) ORDER BY pl.created_at DESC
  ) INTO v_ledger
  FROM (
    SELECT * FROM payment_ledger
    WHERE player_id = v_player_id
      AND team_id   = v_team_id
    ORDER BY created_at DESC
    LIMIT p_limit
  ) pl;

  RETURN COALESCE(v_ledger, '[]'::jsonb);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_payment_history(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_payment_history(text, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_injuries(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_rows      jsonb;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',          pi.id,
      'player_id',   pi.player_id,
      'team_id',     pi.team_id,
      'injured_at',  pi.injured_at,
      'cleared_at',  pi.cleared_at,
      'marked_by',   pi.marked_by
    ) ORDER BY pi.injured_at DESC
  ) INTO v_rows
  FROM player_injuries pi
  WHERE pi.player_id = v_player_id
    AND pi.team_id   = v_team_id;

  RETURN COALESCE(v_rows, '[]'::jsonb);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_injuries(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_injuries(text) TO anon, authenticated;
