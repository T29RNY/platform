-- 278_hq_membership_rollup.sql
--
-- Phase 6 — HQ rollup of membership health across a company's venues. Mirrors the
-- per-venue `venue_membership_summary` (mig 273) but company-wide: one row per
-- venue + a company total. Same auth model as the other hq_* reads — gated by
-- `resolve_company_caller` (auth.uid → company_admins; regional_admins see only
-- their region; platform_admin sees all). authenticated-only, never anon.

CREATE OR REPLACE FUNCTION public.hq_get_membership_rollup(p_company_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company_id text; v_role text; v_region text;
  v_venues jsonb; v_total jsonb;
BEGIN
  SELECT rc.company_id, rc.role, rc.region
    INTO v_company_id, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH scoped AS (
    SELECT v.id, v.name, v.region FROM venues v
    WHERE v.company_id = p_company_id
      AND (v_role <> 'regional_admin' OR v.region IS NOT DISTINCT FROM v_region)
  ),
  per AS (
    SELECT s.id, s.name, s.region,
      count(m.id) FILTER (WHERE m.status='active')  AS active,
      count(m.id) FILTER (WHERE m.status='paused')  AS paused,
      count(m.id) FILTER (WHERE m.status='ending')  AS ending,
      count(m.id) FILTER (WHERE m.status='active' AND m.renews_at <= current_date + 7) AS due_soon,
      COALESCE(round(sum( (m.amount_pence::numeric) /
        CASE m.period WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'annual' THEN 12 ELSE 1 END)
        FILTER (WHERE m.status IN ('active','ending'))), 0) AS mrr_pence,
      count(m.id) FILTER (WHERE m.status='cancelled' AND m.cancel_at >= current_date - 30) AS cancelled_30d,
      (SELECT count(*) FROM venue_customers vc WHERE vc.venue_id = s.id AND vc.status='pending') AS pending_requests
    FROM scoped s
    LEFT JOIN venue_memberships m ON m.venue_id = s.id
    GROUP BY s.id, s.name, s.region
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'venue_id', id, 'venue_name', name, 'region', region,
      'active', active, 'paused', paused, 'ending', ending, 'due_soon', due_soon,
      'mrr_pence', mrr_pence, 'cancelled_30d', cancelled_30d, 'pending_requests', pending_requests
    ) ORDER BY name), '[]'::jsonb),
    jsonb_build_object(
      'active',           COALESCE(sum(active), 0),
      'paused',           COALESCE(sum(paused), 0),
      'ending',           COALESCE(sum(ending), 0),
      'due_soon',         COALESCE(sum(due_soon), 0),
      'mrr_pence',        COALESCE(sum(mrr_pence), 0),
      'cancelled_30d',    COALESCE(sum(cancelled_30d), 0),
      'pending_requests', COALESCE(sum(pending_requests), 0),
      'venues',           count(*)
    )
  INTO v_venues, v_total FROM per;

  RETURN jsonb_build_object('ok', true, 'venues', v_venues, 'total', v_total);
END;
$fn$;
REVOKE ALL ON FUNCTION public.hq_get_membership_rollup(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hq_get_membership_rollup(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hq_get_membership_rollup(text) TO authenticated;
