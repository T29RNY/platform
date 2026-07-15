-- Migration 576 — get_team_payment_reliability RPC
--
-- FIX: the Casual Player → Stats "Payment Reliability" card read the flat
-- players.pay_count column, which NO server-side RPC ever increments (it was a
-- pre-RLS client-side counter, orphaned when payments moved to payment_ledger).
-- Meanwhile players.total keeps climbing every result-save, so payRate =
-- pay_count / total decayed to 0% on every real team — the card showed
-- "Needs Work" and dropped every player into "Owes money". Proven on the live
-- DB: team_KPaoX8oJYMQ (Footy Tuesdays) has 16 admin-confirmed paid game_fee
-- ledger rows but sum(pay_count) = 0.
--
-- This RPC computes payment reliability from payment_ledger — the same source
-- of truth the money screens and gaffer_get_context_payment_summary (mig 035)
-- already use. Per-player reliability = paid game_fee rows / total game_fee
-- rows, all-time. game_fee rows are only ever created for non-guest attended
-- players on PRICED games (see the result-save cascade, mig 347), so guests,
-- free (no-price) sessions, cancelled games and refunds are naturally excluded.
-- Disabled players are excluded to mirror StatsView's `active` filter.
--
-- "Paid" = admin-confirmed status = 'paid'. A self-pay claim (mig 211) leaves
-- the ledger row 'unpaid' until an admin confirms, so an unconfirmed claim does
-- NOT count as paid — the honest "money actually settled" signal, matching the
-- always_paid_players definition in mig 035.
--
-- Returns ONLY the four aggregates the card renders (no per-player payment data
-- leaves the server). Buckets match the client: >=90 always, 50-89 usually,
-- <50 owes. Accepts either an admin token or a player token so the card works
-- on both the admin and player Stats views (team resolved as in mig 348).
--
-- Consumers (Hard Rule 14): apps/inorout StatsView.jsx Payment Reliability card
-- via packages/core getTeamPaymentReliability.

CREATE OR REPLACE FUNCTION public.get_team_payment_reliability(
  p_admin_token text DEFAULT NULL,
  p_token       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id   text;
  v_player_id text;
  v_result    jsonb;
BEGIN
  -- Resolve team: admin token first (teams.admin_token), else player token
  -- (players.token -> team_players), matching mig 035 / mig 348.
  IF p_admin_token IS NOT NULL THEN
    SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  ELSIF p_token IS NOT NULL THEN
    SELECT id INTO v_player_id FROM players WHERE token = p_token;
    IF v_player_id IS NOT NULL THEN
      SELECT team_id INTO v_team_id FROM team_players
      WHERE player_id = v_player_id ORDER BY created_at ASC LIMIT 1;
    END IF;
  END IF;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  WITH per_player AS (
    SELECT pl.player_id,
           ROUND(100.0 * COUNT(*) FILTER (WHERE pl.status = 'paid') / COUNT(*))::int AS rate
    FROM payment_ledger pl
    JOIN players p ON p.id = pl.player_id
    WHERE pl.team_id = v_team_id
      AND pl.type = 'game_fee'
      AND COALESCE(p.is_guest, false) = false
      AND COALESCE(p.disabled,  false) = false
    GROUP BY pl.player_id
  )
  SELECT jsonb_build_object(
    'team_id',         v_team_id,
    'player_count',    COUNT(*),
    'avg_reliability', COALESCE(ROUND(AVG(rate))::int, 0),
    'always_pays',     COUNT(*) FILTER (WHERE rate >= 90),
    'usually_pays',    COUNT(*) FILTER (WHERE rate >= 50 AND rate < 90),
    'owes_money',      COUNT(*) FILTER (WHERE rate < 50),
    'generated_at',    to_jsonb(now())
  )
  INTO v_result
  FROM per_player;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_payment_reliability(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_payment_reliability(text, text) TO anon, authenticated;
