-- Down migration 576 — drop get_team_payment_reliability
-- The Payment Reliability card reverts to reading the flat players.pay_count
-- column (the pre-fix behaviour). No other consumer.

DROP FUNCTION IF EXISTS public.get_team_payment_reliability(text, text);
