-- Down migration for 296 — Phase 7 self-enrolment
-- Reverts: customer_id NOT NULL, drops member_self_create_profile,
--          restores get_venue_signup_tiers to mig-280 body, drops member_enrol_membership.

-- ─── 1. Restore customer_id NOT NULL ─────────────────────────────────────────
-- Only safe if no rows have NULL customer_id (v2 memberships exist only in dev).
-- Add a USING clause to coerce any accidental NULLs to a sentinel uuid.
ALTER TABLE public.venue_memberships
  ALTER COLUMN customer_id SET NOT NULL;

-- ─── 2. Drop member_self_create_profile ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.member_self_create_profile(text,text,text,date,text);

-- ─── 3. Restore get_venue_signup_tiers to mig-280 body ───────────────────────
CREATE OR REPLACE FUNCTION public.get_venue_signup_tiers(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_link record; v_venue_id text; v_rows jsonb;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  SELECT entity_id, entity_type, action, active INTO v_link FROM public.invite_links WHERE code = btrim(p_code);
  IF NOT FOUND OR v_link.entity_type <> 'venue' OR v_link.action <> 'venue_landing' OR NOT v_link.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  v_venue_id := v_link.entity_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'tier_id', t.id, 'name', t.name, 'benefits', t.benefits,
            'is_free', COALESCE((t.benefits->>'is_free')::boolean, false),
            'prices', COALESCE((SELECT jsonb_agg(jsonb_build_object('period', p.period, 'price_pence', p.price_pence) ORDER BY p.price_pence)
                                  FROM public.venue_tier_prices p WHERE p.tier_id=t.id AND p.active), '[]'::jsonb)
          ) ORDER BY COALESCE((t.benefits->>'is_free')::boolean, false) DESC, t.name), '[]'::jsonb)
    INTO v_rows
    FROM public.venue_membership_tiers t
   WHERE t.venue_id = v_venue_id AND t.active
     AND COALESCE((t.benefits->>'self_signup')::boolean, false) = true;

  RETURN jsonb_build_object('ok', true, 'tiers', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.get_venue_signup_tiers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_venue_signup_tiers(text) TO anon, authenticated;

-- ─── 4. Drop member_enrol_membership ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.member_enrol_membership(text,uuid,text,uuid);
