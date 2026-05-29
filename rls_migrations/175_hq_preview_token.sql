-- 175_hq_preview_token.sql
-- League Mode Phase 6 Cycle 6.5 — HQ preview token (scope 6D, the commercial hook).
--
-- A company super_admin generates a 7-day, no-login link (/hq/preview/TOKEN) that shows a
-- READ-ONLY, watermarked subset of the HQ dashboard (company name + venue health grid +
-- summary) — "show your HQ what's possible". hq_preview_tokens already exists (mig 055).
--
-- hq_generate_preview_token (WRITE) — super_admin (or platform_admin) only; regional_admin/
--   analyst rejected (sharing company-wide data externally is privileged). Audits.
-- get_hq_preview_state (READ, anon-callable — the token IS the secret) — validates +
--   expiry, stamps accessed_at on first open, returns the read-only snapshot. No drill-down,
--   no incident detail, no tokens. "Notify the generator on open" is DEFERRED (no company-admin
--   push/email channel wired yet); accessed_at is the visible signal until then.
--
-- CONSUMERS (hard-rule #14): apps/hq "Share preview" button (generate) + /hq/preview/TOKEN
-- PreviewView (get_hq_preview_state).

-- ──────────────────────────────────────────────────────────────────
-- hq_generate_preview_token (WRITE)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_generate_preview_token(p_company_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_uid uuid := auth.uid();
  v_id uuid; v_token text; v_expires timestamptz;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_role <> 'super_admin' THEN RAISE EXCEPTION 'forbidden_role'; END IF;

  INSERT INTO hq_preview_tokens (company_id, generated_by, expires_at)
  VALUES (p_company_id, v_uid, now() + interval '7 days')
  RETURNING id, token, expires_at INTO v_id, v_token, v_expires;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (p_company_id, v_uid, v_actor, 'user_id:' || COALESCE(v_uid::text,'?'),
          'hq_preview_token_generated', 'hq_preview_token', v_id::text,
          jsonb_build_object('company_id', p_company_id, 'expires_at', v_expires));

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_expires);
END;
$fn$;
REVOKE ALL ON FUNCTION public.hq_generate_preview_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hq_generate_preview_token(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hq_generate_preview_token(text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- get_hq_preview_state (READ — anon; token is the secret)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hq_preview_state(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company_id text; v_expires timestamptz; v_company jsonb; v_venues jsonb; v_summary jsonb;
BEGIN
  IF p_token IS NULL THEN RAISE EXCEPTION 'expired_or_invalid'; END IF;
  SELECT company_id, expires_at INTO v_company_id, v_expires
    FROM hq_preview_tokens WHERE token = p_token;
  IF v_company_id IS NULL OR v_expires < now() THEN RAISE EXCEPTION 'expired_or_invalid'; END IF;

  -- stamp first open
  UPDATE hq_preview_tokens SET accessed_at = now() WHERE token = p_token AND accessed_at IS NULL;

  SELECT to_jsonb(c) INTO v_company FROM (
    SELECT name, logo_url, primary_colour FROM companies WHERE id = v_company_id) c;

  -- whole-company (preview is not role-scoped), read-only health grid
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', v.name, 'region', v.region, 'subscription_status', v.subscription_status,
    'tonight_fixtures', (SELECT count(*) FROM fixtures f
       JOIN competitions cp ON cp.id=f.competition_id JOIN seasons se ON se.id=cp.season_id
       JOIN leagues l ON l.id=se.league_id
       WHERE l.venue_id=v.id AND f.scheduled_date=current_date AND f.status IN ('scheduled','allocated','in_progress')),
    'open_incidents', (SELECT count(*) FROM incidents i WHERE i.venue_id=v.id AND i.resolved_at IS NULL),
    'health', CASE
      WHEN EXISTS(SELECT 1 FROM incidents i WHERE i.venue_id=v.id AND i.resolved_at IS NULL AND i.severity='critical')
        OR v.subscription_status IN ('past_due','cancelled') THEN 'red'
      WHEN (SELECT count(*) FROM incidents i WHERE i.venue_id=v.id AND i.resolved_at IS NULL) > 0 THEN 'amber'
      ELSE 'green' END
  ) ORDER BY v.name), '[]'::jsonb) INTO v_venues
  FROM venues v WHERE v.company_id = v_company_id;

  WITH lg AS (SELECT id FROM leagues WHERE venue_id IN (SELECT id FROM venues WHERE company_id=v_company_id)),
       se AS (SELECT id FROM seasons WHERE league_id IN (SELECT id FROM lg)),
       cp AS (SELECT id FROM competitions WHERE season_id IN (SELECT id FROM se))
  SELECT jsonb_build_object(
    'venue_count',       (SELECT count(*) FROM venues WHERE company_id=v_company_id),
    'active_leagues',    (SELECT count(*) FROM leagues l WHERE l.id IN (SELECT id FROM lg) AND l.active),
    'registered_teams',  (SELECT count(DISTINCT team_id) FROM competition_teams WHERE competition_id IN (SELECT id FROM cp)),
    'fixtures_completed',(SELECT count(*) FROM fixtures WHERE competition_id IN (SELECT id FROM cp) AND status='completed')
  ) INTO v_summary;

  RETURN jsonb_build_object(
    'preview', true,
    'company', v_company,
    'venues', v_venues,
    'summary', v_summary,
    'expires_at', v_expires
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_hq_preview_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_hq_preview_state(text) TO anon, authenticated;
