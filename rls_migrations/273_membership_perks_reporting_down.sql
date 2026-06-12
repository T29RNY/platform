-- 273_membership_perks_reporting_down.sql — reverse of 273.
-- Restores the mig-272 get_member_pass (without offers), drops the perks/reporting
-- RPCs and tables.

DROP FUNCTION IF EXISTS public.venue_membership_summary(text);
DROP FUNCTION IF EXISTS public.redeem_member_offer(text,uuid);
DROP FUNCTION IF EXISTS public.venue_list_partners(text);
DROP FUNCTION IF EXISTS public.venue_set_offer_active(text,uuid,boolean);
DROP FUNCTION IF EXISTS public.venue_create_offer(text,uuid,text,text,text,uuid[]);
DROP FUNCTION IF EXISTS public.venue_create_partner(text,text,text);

DROP TABLE IF EXISTS public.partner_redemptions;
DROP TABLE IF EXISTS public.partner_offers;
DROP TABLE IF EXISTS public.venue_partners;

-- restore mig-272 get_member_pass (no offers block)
CREATE OR REPLACE FUNCTION public.get_member_pass(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT jsonb_build_object(
    'ok', true,
    'first_name', c.first_name, 'last_name', c.last_name,
    'tier_name', t.name, 'benefits', t.benefits,
    'period', m.period, 'amount_pence', m.amount_pence,
    'status', m.status, 'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until,
    'venue_name', vn.name, 'venue_logo', vn.logo_url,
    'primary_colour', vn.primary_colour, 'secondary_colour', vn.secondary_colour,
    'check_in_code', m.pass_token
  ) INTO v
  FROM public.venue_memberships m
  JOIN public.venue_customers c        ON c.id = m.customer_id
  JOIN public.venue_membership_tiers t ON t.id = m.tier_id
  JOIN public.venues vn                ON vn.id = m.venue_id
  WHERE m.pass_token = p_token AND m.status <> 'cancelled';
  IF v IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN v;
END; $fn$;
REVOKE ALL ON FUNCTION public.get_member_pass(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_pass(text) TO anon, authenticated;
