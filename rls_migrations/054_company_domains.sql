-- Migration 054 — company_domains table + get_company_by_domain RPC
-- Phase 0F of venue_league_hq_SCOPE.md.
--
-- Single-source-of-truth for "what company does this email domain belong to?".
-- Used by AuthCallback.jsx on Google OAuth return to auto-route HQ admins to
-- their company. Phase 6 (HQ dashboard) consumes this — Phase 0F only ships
-- the infra so the lookup is wired and silent until then.
--
-- FK forward-reference: `company_id` is text NULL with NO FK constraint
-- because the `companies` table doesn't exist yet (Phase 1). The FK
-- `FOREIGN KEY (company_id) REFERENCES companies(id)` will be added in
-- the Phase 1 migration that creates `companies`. Until then, the table
-- can be populated (e.g. seed an HQ admin's domain) but the RPC returns
-- just the raw company_id; Phase 1 will extend the RPC to JOIN to
-- companies for company_name.
--
-- RLS: enabled, no public policies. Reads via SECURITY DEFINER RPC only
-- (must be callable by anon — OAuth callback runs before auth completes
-- on first sign-in). Writes happen via future HQ admin RPC (Phase 6) or
-- service role.

CREATE TABLE IF NOT EXISTS public.company_domains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NULL,
  domain      text UNIQUE NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- (UNIQUE constraint above already provides the lookup index on domain.)

ALTER TABLE public.company_domains ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.company_domains FROM anon;
REVOKE ALL ON public.company_domains FROM authenticated;

DROP FUNCTION IF EXISTS public.get_company_by_domain(text);

CREATE OR REPLACE FUNCTION public.get_company_by_domain(p_domain text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_company_id text;
BEGIN
  IF p_domain IS NULL OR trim(p_domain) = '' THEN
    RETURN NULL;
  END IF;

  SELECT company_id INTO v_company_id
  FROM public.company_domains
  WHERE domain = lower(trim(p_domain))
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Phase 1 will extend this to JOIN companies and include company_name.
  RETURN jsonb_build_object(
    'company_id', v_company_id,
    'domain',     lower(trim(p_domain))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_by_domain(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_company_by_domain(text) TO authenticated;
