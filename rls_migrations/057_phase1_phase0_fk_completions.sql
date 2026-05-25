-- Migration 057 — Phase 1 finisher: add the deferred Phase-0 FK constraints
-- and extend get_company_by_domain to JOIN companies.
--
-- Phase 0 (migrations 050, 054) created league_config and company_domains
-- with text NULL FK columns but NO FK constraint because the parent tables
-- (leagues, companies) didn't exist yet. Migration 055 created those
-- parents. This migration adds the constraints retroactively.
--
-- Pre-check (run separately via execute_sql before applying): zero orphans.
--   league_config.league_id   non-null rows: 0
--   company_domains.company_id non-null rows: 0
-- All existing rows have NULL in their FK column, so the constraint adds
-- cleanly without failures.
--
-- Also: extends get_company_by_domain to JOIN companies and return
-- company_name alongside company_id. Phase 0 ships only company_id; Phase 1
-- adds the name now that companies exists. Backward-compatible:
-- AuthCallback.jsx only reads result?.company_id, so adding company_name to
-- the response shape doesn't break anything.

-- ─── 1) league_config.league_id → leagues(id) ────────────────────────────

ALTER TABLE public.league_config
  DROP CONSTRAINT IF EXISTS league_config_league_id_fkey;

ALTER TABLE public.league_config
  ADD CONSTRAINT league_config_league_id_fkey
  FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;

-- ─── 2) company_domains.company_id → companies(id) ───────────────────────

ALTER TABLE public.company_domains
  DROP CONSTRAINT IF EXISTS company_domains_company_id_fkey;

ALTER TABLE public.company_domains
  ADD CONSTRAINT company_domains_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

-- ─── 3) get_company_by_domain: JOIN companies for company_name ───────────

DROP FUNCTION IF EXISTS public.get_company_by_domain(text);

CREATE OR REPLACE FUNCTION public.get_company_by_domain(p_domain text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_company_id   text;
  v_company_name text;
BEGIN
  IF p_domain IS NULL OR trim(p_domain) = '' THEN
    RETURN NULL;
  END IF;

  SELECT cd.company_id, c.name
    INTO v_company_id, v_company_name
  FROM public.company_domains cd
  LEFT JOIN public.companies c ON c.id = cd.company_id
  WHERE cd.domain = lower(trim(p_domain))
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'company_id',   v_company_id,
    'company_name', v_company_name,    -- may be NULL if FK row exists but company doesn't (shouldn't happen post-057)
    'domain',       lower(trim(p_domain))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_by_domain(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_company_by_domain(text) TO authenticated;
