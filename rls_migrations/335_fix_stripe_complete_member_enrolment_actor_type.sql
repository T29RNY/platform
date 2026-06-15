-- Fix actor_type='member' → 'player' in stripe_complete_member_enrolment audit INSERT.
-- 'member' violates audit_events_actor_type_check constraint (same pattern fixed in
-- mig 295/296 for other member RPCs in session 99).

CREATE OR REPLACE FUNCTION public.stripe_complete_member_enrolment(p_invite_code text, p_subscription_id text, p_stripe_customer_id text, p_stripe_price_id text, p_tier_id uuid, p_period text, p_member_profile_id uuid, p_amount_pence integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_link      record;
  v_venue_id  text;
  v_club_id   text;
  v_tier      record;
  v_price     int;
  v_renews    date;
  v_mid       uuid;
  v_pass      text;
  v_actor_uid uuid;
BEGIN
  IF p_subscription_id IS NOT NULL THEN
    SELECT id, pass_token INTO v_mid, v_pass
    FROM public.venue_memberships
    WHERE stripe_subscription_id = p_subscription_id;
    IF v_mid IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'membership_id', v_mid,
                                'pass_token', v_pass, 'already_enrolled', true);
    END IF;
  END IF;

  SELECT entity_id, active INTO v_link
  FROM public.invite_links
  WHERE code = btrim(p_invite_code)
    AND entity_type = 'venue'
    AND action = 'venue_landing';
  IF NOT FOUND OR NOT v_link.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  v_venue_id := v_link.entity_id;

  IF p_period NOT IN ('monthly','quarterly','annual','season') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_period');
  END IF;

  SELECT id, season_end, pricing_model INTO v_tier
  FROM public.venue_membership_tiers
  WHERE id = p_tier_id AND venue_id = v_venue_id AND active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tier_not_found');
  END IF;

  IF p_amount_pence IS NOT NULL THEN
    v_price := p_amount_pence;
  ELSE
    SELECT price_pence INTO v_price
    FROM public.venue_tier_prices
    WHERE tier_id = p_tier_id AND period = p_period AND active;
  END IF;

  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv WHERE cv.venue_id = v_venue_id LIMIT 1;

  IF p_period = 'season' THEN
    v_renews := COALESCE(v_tier.season_end, '9999-12-31'::date);
  ELSE
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  INSERT INTO public.venue_memberships (
    venue_id, tier_id, period, amount_pence, status, renews_at,
    club_id, member_profile_id, pricing_model,
    stripe_subscription_id, stripe_customer_id, stripe_price_id, payment_state
  ) VALUES (
    v_venue_id, p_tier_id, p_period, v_price, 'active', v_renews,
    v_club_id, p_member_profile_id, v_tier.pricing_model,
    p_subscription_id, p_stripe_customer_id, p_stripe_price_id, 'current'
  )
  RETURNING id, pass_token INTO v_mid, v_pass;

  SELECT auth_user_id INTO v_actor_uid
  FROM public.member_profiles WHERE id = p_member_profile_id;

  IF v_actor_uid IS NOT NULL THEN
    INSERT INTO public.audit_events (
      team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
    ) VALUES (
      v_venue_id, v_actor_uid, 'player', 'stripe_member_enrolled',
      'venue_membership', v_mid::text,
      jsonb_build_object(
        'tier_id',                p_tier_id,
        'period',                 p_period,
        'member_profile_id',      p_member_profile_id,
        'club_id',                v_club_id,
        'amount_pence',           v_price,
        'stripe_subscription_id', p_subscription_id,
        'stripe_customer_id',     p_stripe_customer_id
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'membership_id', v_mid, 'pass_token', v_pass);
END;
$function$;
