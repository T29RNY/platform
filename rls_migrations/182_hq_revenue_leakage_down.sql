-- DOWN for migration 182 — HQ-I Phase 2 (Revenue & Leakage).
-- Restores the pre-182 live bodies (captured via pg_get_functiondef before apply):
--   _hq_health_score back to 3 axes (mig 179), and hq_get_company_state /
--   hq_get_analytics to their pre-revenue shapes. Drops the 4-arg helper first.

DROP FUNCTION IF EXISTS public._hq_health_score(numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public._hq_health_score(p_ops numeric, p_util numeric, p_completion numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  w_ops numeric := 0.40; w_util numeric := 0.30; w_comp numeric := 0.30;
  tot numeric := 0; acc numeric := 0;
  weakest text := NULL; weakval numeric := 1e9;
BEGIN
  IF p_ops        IS NOT NULL THEN tot := tot + w_ops;  acc := acc + w_ops  * p_ops;        END IF;
  IF p_util       IS NOT NULL THEN tot := tot + w_util; acc := acc + w_util * p_util;       END IF;
  IF p_completion IS NOT NULL THEN tot := tot + w_comp; acc := acc + w_comp * p_completion; END IF;
  IF tot = 0 THEN RETURN jsonb_build_object('score', NULL, 'weakest', NULL); END IF;

  IF p_ops        IS NOT NULL AND p_ops        < weakval THEN weakval := p_ops;        weakest := 'operations';        END IF;
  IF p_util       IS NOT NULL AND p_util       < weakval THEN weakval := p_util;       weakest := 'utilisation';       END IF;
  IF p_completion IS NOT NULL AND p_completion < weakval THEN weakval := p_completion; weakest := 'fixture_completion'; END IF;

  RETURN jsonb_build_object('score', round(acc / tot), 'weakest', weakest);
END;
$function$;

REVOKE ALL ON FUNCTION public._hq_health_score(numeric, numeric, numeric) FROM PUBLIC;

-- NOTE: to fully revert hq_get_company_state and hq_get_analytics, re-apply the
-- pre-182 bodies from mig 179 (company_state) and mig 173 (analytics). They are
-- additive-only changes (a new 'revenue' key + health revenue axis), so leaving
-- them in place is harmless even with the 3-arg helper restored — the 4-arg call
-- site would break, hence in practice revert all three together by restoring the
-- mig 179 / mig 173 function bodies. Kept minimal here; full bodies live in those
-- migrations and were captured in the session-64 audit.
