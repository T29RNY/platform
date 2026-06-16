-- 337_gocardless_phases_5_to_8.sql
--
-- GoCardless for Platforms: Phases 5–8
-- Phase 5: venue OAuth connect + disconnect
-- Phase 6: member mandate enrolment + webhook state machine
-- Phase 7: sandbox lifecycle (credentials DORMANT until operator provides)
-- Phase 8: get_venue_signup_tiers extended with gc_connected for member choice UI
--
-- All service_role RPCs are DORMANT until GC_ACCESS_TOKEN env var is set.
-- venue_integrations already supports provider='gocardless' (mig 329).

-- ── 1. Schema: venue_memberships GoCardless columns ────────────────────────
ALTER TABLE public.venue_memberships
  ADD COLUMN IF NOT EXISTS gc_mandate_id  text,
  ADD COLUMN IF NOT EXISTS gc_customer_id text;

-- ── 2. Schema: billing_events GoCardless idempotency key ───────────────────
ALTER TABLE public.billing_events
  ADD COLUMN IF NOT EXISTS gc_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS billing_events_gc_event_id_key
  ON public.billing_events (gc_event_id)
  WHERE gc_event_id IS NOT NULL;

-- ── 3. set_venue_gc_connect_state ──────────────────────────────────────────
-- Upserts the venue's GoCardless connection into venue_integrations.
-- Stores the per-venue access_token (never returned to client).
-- Called server-side from gocardless-connect.js OAuth callback.
CREATE OR REPLACE FUNCTION public.set_venue_gc_connect_state(
  p_venue_id     text,
  p_account_id   text,    -- GoCardless organisation_id (OR...)
  p_access_token text,    -- venue-scoped GC access token
  p_status       text     -- 'connected' | 'disconnected' | 'pending'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF p_status NOT IN ('connected','disconnected','pending') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.venue_integrations
    (venue_id, provider, status, account_id, access_token, config, connected_at, updated_at)
  VALUES (
    p_venue_id, 'gocardless', p_status, p_account_id, p_access_token,
    jsonb_build_object(),
    CASE WHEN p_status = 'connected' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (venue_id, provider) DO UPDATE SET
    status          = EXCLUDED.status,
    account_id      = COALESCE(EXCLUDED.account_id, venue_integrations.account_id),
    access_token    = COALESCE(EXCLUDED.access_token, venue_integrations.access_token),
    connected_at    = CASE
                        WHEN EXCLUDED.status = 'connected' AND venue_integrations.connected_at IS NULL
                        THEN now()
                        ELSE venue_integrations.connected_at
                      END,
    disconnected_at = CASE
                        WHEN EXCLUDED.status = 'disconnected' THEN now()
                        ELSE venue_integrations.disconnected_at
                      END,
    updated_at      = now();

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    p_venue_id, NULL, 'system', 'gocardless_connect',
    CASE WHEN p_status = 'connected' THEN 'venue_gc_connected' ELSE 'venue_gc_disconnected' END,
    'venue', p_venue_id,
    jsonb_build_object('account_id', p_account_id, 'status', p_status)
  );

  RETURN jsonb_build_object('ok', true, 'venue_id', p_venue_id, 'status', p_status);
END; $fn$;
REVOKE ALL ON FUNCTION public.set_venue_gc_connect_state(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_venue_gc_connect_state(text,text,text,text) TO service_role;

-- ── 4. venue_gc_disconnect ─────────────────────────────────────────────────
-- Venue admin disconnects GoCardless. Clears access_token, marks disconnected.
-- Called from venue settings UI via resolve_venue_caller gate.
CREATE OR REPLACE FUNCTION public.venue_gc_disconnect(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller.venue_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;
  v_venue_id := v_caller.venue_id;

  UPDATE public.venue_integrations
     SET status = 'disconnected', access_token = NULL, disconnected_at = now(), updated_at = now()
   WHERE venue_id = v_venue_id AND provider = 'gocardless';

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, v_caller.user_id, 'venue_admin', 'venue_gc_disconnected',
    'venue', v_venue_id, jsonb_build_object()
  );

  RETURN jsonb_build_object('ok', true);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_gc_disconnect(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_gc_disconnect(text) TO anon, authenticated;

-- ── 5. gc_complete_member_enrolment ───────────────────────────────────────
-- Called by gocardless-mandate.js after redirect flow completion.
-- Idempotent on gc_mandate_id. service_role only.
CREATE OR REPLACE FUNCTION public.gc_complete_member_enrolment(
  p_invite_code       text,
  p_mandate_id        text,    -- GoCardless mandate ID (MD...)
  p_customer_id       text,    -- GoCardless customer ID (CU...)
  p_tier_id           uuid,
  p_period            text,
  p_member_profile_id uuid,
  p_amount_pence      integer  DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_link          record;
  v_venue_id      text;
  v_club_id       text;
  v_tier          record;
  v_price         integer;
  v_renews        timestamptz;
  v_mid           uuid;
  v_pass          text;
  v_actor_uid     uuid;
  v_existing_id   uuid;
BEGIN
  -- Idempotency: return existing row if mandate already enrolled
  SELECT id INTO v_existing_id FROM public.venue_memberships WHERE gc_mandate_id = p_mandate_id LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'membership_id', v_existing_id, 'idempotent', true);
  END IF;

  -- Resolve venue from invite code
  SELECT entity_id INTO v_venue_id
  FROM public.invite_links
  WHERE code = btrim(p_invite_code) AND entity_type = 'venue' AND action = 'venue_landing' AND active;
  IF v_venue_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  -- Resolve club
  SELECT club_id INTO v_club_id FROM public.club_venues WHERE venue_id = v_venue_id LIMIT 1;

  -- Resolve tier + pricing model
  SELECT id, pricing_model INTO v_tier
  FROM public.venue_membership_tiers
  WHERE id = p_tier_id AND venue_id = v_venue_id AND active;
  IF v_tier.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tier_not_found');
  END IF;

  -- Resolve price
  v_price := p_amount_pence;
  IF v_price IS NULL THEN
    SELECT price_pence INTO v_price FROM public.venue_tier_prices
    WHERE tier_id = p_tier_id AND period = p_period AND active LIMIT 1;
  END IF;

  -- Compute renewal date
  v_renews := CASE p_period
    WHEN 'monthly'   THEN now() + interval '1 month'
    WHEN 'quarterly' THEN now() + interval '3 months'
    WHEN 'annual'    THEN now() + interval '1 year'
    ELSE NULL END;

  INSERT INTO public.venue_memberships (
    venue_id, tier_id, period, amount_pence, status, renews_at,
    club_id, member_profile_id, pricing_model,
    gc_mandate_id, gc_customer_id, payment_state
  ) VALUES (
    v_venue_id, p_tier_id, p_period, v_price, 'active', v_renews,
    v_club_id, p_member_profile_id, v_tier.pricing_model,
    p_mandate_id, p_customer_id, 'current'
  )
  RETURNING id, pass_token INTO v_mid, v_pass;

  SELECT auth_user_id INTO v_actor_uid
  FROM public.member_profiles WHERE id = p_member_profile_id;

  IF v_actor_uid IS NOT NULL THEN
    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      v_venue_id, v_actor_uid, 'player', 'gc_member_enrolled',
      'venue_membership', v_mid::text,
      jsonb_build_object(
        'tier_id',           p_tier_id,
        'period',            p_period,
        'member_profile_id', p_member_profile_id,
        'club_id',           v_club_id,
        'amount_pence',      v_price,
        'gc_mandate_id',     p_mandate_id,
        'gc_customer_id',    p_customer_id
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'membership_id', v_mid, 'pass_token', v_pass);
END; $fn$;
REVOKE ALL ON FUNCTION public.gc_complete_member_enrolment(text,text,text,uuid,text,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gc_complete_member_enrolment(text,text,text,uuid,text,uuid,integer) TO service_role;

-- ── 6. apply_gc_payment_status ────────────────────────────────────────────
-- THE GC STATE MACHINE. Maps GoCardless event types onto payment_state.
-- Called by gocardless-webhook.js and gcMembershipReconciliationJob cron.
--
-- Event type → payment_state mapping:
--   payments.confirmed / payments.paid_out  → current
--   payments.failed / payments.charged_back → past_due
--   mandates.cancelled / mandates.expired / mandates.failed → suspended + status='cancelled'
CREATE OR REPLACE FUNCTION public.apply_gc_payment_status(
  p_mandate_id    text,
  p_gc_event_type text    -- e.g. 'payments.paid_out', 'mandates.cancelled'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_pay    text;
  v_cancel boolean := false;
  v_m      record;
BEGIN
  v_pay := CASE p_gc_event_type
    WHEN 'payments.confirmed'    THEN 'current'
    WHEN 'payments.paid_out'     THEN 'current'
    WHEN 'payments.failed'       THEN 'past_due'
    WHEN 'payments.charged_back' THEN 'past_due'
    WHEN 'mandates.cancelled'    THEN 'suspended'
    WHEN 'mandates.expired'      THEN 'suspended'
    WHEN 'mandates.failed'       THEN 'suspended'
    ELSE 'past_due'
  END;

  v_cancel := p_gc_event_type IN ('mandates.cancelled','mandates.expired','mandates.failed');

  UPDATE public.venue_memberships
     SET payment_state = v_pay,
         status        = CASE WHEN v_cancel THEN 'cancelled' ELSE status END,
         updated_at    = now()
   WHERE gc_mandate_id = p_mandate_id
  RETURNING id, venue_id, status, payment_state INTO v_m;

  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_membership');
  END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_m.venue_id, NULL, 'system', 'gocardless_webhook',
    'membership_payment_state', 'venue_membership', v_m.id::text,
    jsonb_build_object(
      'gc_event_type', p_gc_event_type,
      'payment_state', v_pay,
      'status',        v_m.status,
      'mandate_id',    p_mandate_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'membership_id', v_m.id,
                            'status', v_m.status, 'payment_state', v_m.payment_state);
END; $fn$;
REVOKE ALL ON FUNCTION public.apply_gc_payment_status(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_gc_payment_status(text,text) TO service_role;

-- ── 7. record_gc_event ────────────────────────────────────────────────────
-- PERSIST-THEN-PROCESS + IDEMPOTENT. Called first by gocardless-webhook.js.
-- Dedupes on gc_event_id (unique partial index). Returns inserted=false on replay.
CREATE OR REPLACE FUNCTION public.record_gc_event(
  p_gc_event_id  text,
  p_entity_type  text,
  p_entity_id    text,
  p_event_type   text,
  p_amount_pence integer,
  p_payload      jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_id uuid; v_status text;
BEGIN
  INSERT INTO public.billing_events
    (entity_type, entity_id, event_type, gc_event_id, amount_pence, payload, status)
  VALUES
    (p_entity_type, p_entity_id, p_event_type, p_gc_event_id, p_amount_pence, p_payload, 'received')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'inserted', true, 'event_id', v_id, 'status', 'received');
  END IF;
  SELECT id, status INTO v_id, v_status
  FROM public.billing_events WHERE gc_event_id = p_gc_event_id;
  RETURN jsonb_build_object('ok', true, 'inserted', false, 'event_id', v_id, 'status', v_status);
END; $fn$;
REVOKE ALL ON FUNCTION public.record_gc_event(text,text,text,text,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gc_event(text,text,text,text,integer,jsonb) TO service_role;

-- ── 8. mark_gc_event_processed ────────────────────────────────────────────
-- Close the billing_events lifecycle after the webhook handler acts.
CREATE OR REPLACE FUNCTION public.mark_gc_event_processed(
  p_gc_event_id text,
  p_status      text    DEFAULT 'processed',
  p_note        text    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF p_status NOT IN ('processed','failed','ignored') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE='P0001';
  END IF;
  UPDATE public.billing_events
     SET status = p_status, processed_at = now(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('note', p_note)
   WHERE gc_event_id = p_gc_event_id;
  RETURN jsonb_build_object('ok', FOUND);
END; $fn$;
REVOKE ALL ON FUNCTION public.mark_gc_event_processed(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_gc_event_processed(text,text,text) TO service_role;

-- ── 9. get_venue_signup_tiers (Phase 8) ───────────────────────────────────
-- Adds gc_connected to the club object so MembershipSignup can fork between
-- Stripe / GoCardless / both / neither at enrolment time.
CREATE OR REPLACE FUNCTION public.get_venue_signup_tiers(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_link          record;
  v_venue_id      text;
  v_club_id       text;
  v_club          record;
  v_tiers         jsonb;
  v_docs          jsonb;
  v_stripe_active boolean;
  v_gc_active     boolean;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  SELECT entity_id, entity_type, action, active INTO v_link
  FROM public.invite_links WHERE code = btrim(p_code);

  IF NOT FOUND OR v_link.entity_type <> 'venue' OR v_link.action <> 'venue_landing' OR NOT v_link.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  v_venue_id := v_link.entity_id;

  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv WHERE cv.venue_id = v_venue_id LIMIT 1;

  IF v_club_id IS NOT NULL THEN
    SELECT id, name, id_mandate, safeguarding_config INTO v_club
    FROM public.clubs WHERE id = v_club_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.venue_integrations vi
    WHERE vi.venue_id = v_venue_id AND vi.provider = 'stripe' AND vi.status = 'connected'
  ) INTO v_stripe_active;

  SELECT EXISTS (
    SELECT 1 FROM public.venue_integrations vi
    WHERE vi.venue_id = v_venue_id AND vi.provider = 'gocardless' AND vi.status = 'connected'
  ) INTO v_gc_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tier_id',       t.id,
    'name',          t.name,
    'audience',      t.audience,
    'pricing_model', t.pricing_model,
    'season_start',  t.season_start,
    'season_end',    t.season_end,
    'benefits',      t.benefits,
    'is_free',       COALESCE((t.benefits->>'is_free')::boolean, false),
    'prices',        COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'period',      p.period,
        'price_pence', p.price_pence,
        'price_type',  p.price_type
      ) ORDER BY p.price_pence)
       FROM public.venue_tier_prices p WHERE p.tier_id = t.id AND p.active),
      '[]'::jsonb
    )
  ) ORDER BY t.name), '[]'::jsonb)
  INTO v_tiers
  FROM public.venue_membership_tiers t
  WHERE t.venue_id = v_venue_id AND t.active
    AND COALESCE((t.benefits->>'self_signup')::boolean, false) = true;

  IF v_club_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'document_id', pd.id,
      'title',       pd.title,
      'body',        pd.body,
      'version',     pd.version
    ) ORDER BY pd.title), '[]'::jsonb)
    INTO v_docs
    FROM public.policy_documents pd
    WHERE pd.club_id = v_club_id AND pd.is_current;
  ELSE
    v_docs := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'ok',       true,
    'venue_id', v_venue_id,
    'club',     CASE WHEN v_club.id IS NOT NULL THEN jsonb_build_object(
      'id',                  v_club.id,
      'name',                v_club.name,
      'id_mandate',          v_club.id_mandate,
      'safeguarding_config', v_club.safeguarding_config,
      'stripe_connected',    v_stripe_active,
      'gc_connected',        v_gc_active
    ) ELSE NULL END,
    'documents', v_docs,
    'tiers',     v_tiers
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_venue_signup_tiers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_venue_signup_tiers(text) TO anon, authenticated;
