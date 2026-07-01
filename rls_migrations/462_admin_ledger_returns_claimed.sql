-- 462: admin_get_player_ledger returns claimed_at / claimed_by.
--
-- Fix: PR #5's per-row Confirm/Reject buttons (and the CLAIMED pill) key off the
-- ledger row's claimed_at, but admin_get_player_ledger — the RPC behind the admin
-- Payments expanded ledger AND the admin view of a player's Profile history — never
-- returned claimed_at/claimed_by. So a week a player CLAIMED showed as plain UNPAID to
-- the admin, with no way to confirm it per-week. Additive return-shape fix; dbToLedger
-- already maps these fields (mig 459), so no JS change is needed.

CREATE OR REPLACE FUNCTION public.admin_get_player_ledger(p_admin_token text, p_player_id text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id text;
  v_ledger  jsonb;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
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
      'claimed_at', pl.claimed_at,
      'claimed_by', pl.claimed_by,
      'note',       pl.note,
      'created_at', pl.created_at,
      'updated_at', pl.updated_at
    ) ORDER BY pl.created_at DESC
  ) INTO v_ledger
  FROM (
    SELECT * FROM payment_ledger
    WHERE player_id = p_player_id
      AND team_id   = v_team_id
    ORDER BY created_at DESC
    LIMIT p_limit
  ) pl;

  RETURN COALESCE(v_ledger, '[]'::jsonb);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='internal_error';
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
