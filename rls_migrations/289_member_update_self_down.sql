-- Down migration 289 — drops member_update_self; restores get_member_pass
-- to its mig-273 state (without member_profile_id in the response).

DROP FUNCTION IF EXISTS public.member_update_self(jsonb);

-- Restore get_member_pass without member_profile_id (mig 273 body)
CREATE OR REPLACE FUNCTION public.get_member_pass(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v jsonb; v_m record; v_offers jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT m.id, m.venue_id, m.tier_id INTO v_m
  FROM public.venue_memberships m WHERE m.pass_token=p_token AND m.status<>'cancelled';
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('offer_id', o.id, 'partner_name', pn.name,
            'title', o.title, 'description', o.description, 'code', o.code) ORDER BY o.created_at), '[]'::jsonb)
    INTO v_offers
    FROM public.partner_offers o JOIN public.venue_partners pn ON pn.id=o.partner_id
   WHERE o.venue_id = v_m.venue_id AND o.active AND pn.active
     AND (o.tier_ids IS NULL OR array_length(o.tier_ids,1) IS NULL OR v_m.tier_id = ANY(o.tier_ids));

  SELECT jsonb_build_object(
    'ok', true,
    'first_name', c.first_name, 'last_name', c.last_name,
    'tier_name', t.name, 'benefits', t.benefits,
    'period', m.period, 'amount_pence', m.amount_pence,
    'status', m.status, 'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until,
    'venue_name', vn.name, 'venue_logo', vn.logo_url,
    'primary_colour', vn.primary_colour, 'secondary_colour', vn.secondary_colour,
    'check_in_code', m.pass_token,
    'offers', v_offers
  ) INTO v
  FROM public.venue_memberships m
  JOIN public.venue_customers c        ON c.id = m.customer_id
  JOIN public.venue_membership_tiers t ON t.id = m.tier_id
  JOIN public.venues vn                ON vn.id = m.venue_id
  WHERE m.id = v_m.id;
  RETURN v;
END; $fn$;

REVOKE ALL ON FUNCTION public.get_member_pass(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_pass(text) TO anon, authenticated;
