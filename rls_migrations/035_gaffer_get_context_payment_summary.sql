-- Migration 035 — gaffer_get_context_payment_summary RPC
-- Spec: GAFFER.md (Surfaces → Payment summary)
--
-- Returns:
--   {
--     team_id, currency_pence_unit: true,
--     outstanding_total_pence: int,
--     outstanding_player_count: int,
--     oldest_debt: { player_id, player_name, amount_pence, age_days } | null,
--     top_owers: [{ player_id, player_name, total_pence }],  -- up to 5
--     last_week_collected_pence: int,
--     last_week_owed_pence: int,
--     always_paid_players: [{ id, name }]   -- players paid every game-fee row
--   }

CREATE OR REPLACE FUNCTION public.gaffer_get_context_payment_summary(
  p_admin_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id text;
  v_outstanding_total int;
  v_outstanding_count int;
  v_oldest jsonb;
  v_top_owers jsonb;
  v_last_week_collected int;
  v_last_week_owed int;
  v_always_paid jsonb;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  -- Outstanding total + count
  SELECT COALESCE(SUM(amount), 0), COUNT(DISTINCT player_id)
    INTO v_outstanding_total, v_outstanding_count
  FROM payment_ledger
  WHERE team_id = v_team_id
    AND status = 'unpaid';

  -- Oldest single unpaid debt
  SELECT jsonb_build_object(
    'player_id', pl.player_id,
    'player_name', p.name,
    'amount_pence', pl.amount,
    'age_days', EXTRACT(DAY FROM (now() - pl.created_at))::int
  )
    INTO v_oldest
  FROM payment_ledger pl
  JOIN players p ON p.id = pl.player_id
  WHERE pl.team_id = v_team_id
    AND pl.status = 'unpaid'
  ORDER BY pl.created_at ASC
  LIMIT 1;

  -- Top 5 owers by total outstanding
  SELECT COALESCE(
    jsonb_agg(row_to_jsonb(t) ORDER BY t.total_pence DESC),
    '[]'::jsonb
  )
    INTO v_top_owers
  FROM (
    SELECT pl.player_id, p.name AS player_name, SUM(pl.amount) AS total_pence
    FROM payment_ledger pl
    JOIN players p ON p.id = pl.player_id
    WHERE pl.team_id = v_team_id
      AND pl.status = 'unpaid'
    GROUP BY pl.player_id, p.name
    ORDER BY SUM(pl.amount) DESC
    LIMIT 5
  ) t;

  -- Last 7 days: collected vs owed
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE status = 'paid' AND paid_at >= (now() - INTERVAL '7 days')), 0),
    COALESCE(SUM(amount) FILTER (WHERE created_at >= (now() - INTERVAL '7 days') AND type = 'game_fee'), 0)
    INTO v_last_week_collected, v_last_week_owed
  FROM payment_ledger
  WHERE team_id = v_team_id;

  -- Always-paid players: have ≥3 game_fee ledger rows in last 90d, all paid
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)), '[]'::jsonb)
    INTO v_always_paid
  FROM players p
  WHERE p.id IN (
    SELECT pl.player_id
    FROM payment_ledger pl
    WHERE pl.team_id = v_team_id
      AND pl.type = 'game_fee'
      AND pl.created_at >= (now() - INTERVAL '90 days')
    GROUP BY pl.player_id
    HAVING COUNT(*) >= 3
       AND COUNT(*) FILTER (WHERE pl.status = 'paid') = COUNT(*)
  );

  RETURN jsonb_build_object(
    'team_id', v_team_id,
    'currency_pence_unit', true,
    'outstanding_total_pence', v_outstanding_total,
    'outstanding_player_count', v_outstanding_count,
    'oldest_debt', v_oldest,
    'top_owers', v_top_owers,
    'last_week_collected_pence', v_last_week_collected,
    'last_week_owed_pence', v_last_week_owed,
    'always_paid_players', v_always_paid,
    'generated_at', to_jsonb(now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gaffer_get_context_payment_summary(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gaffer_get_context_payment_summary(text) TO anon;
