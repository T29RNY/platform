-- =============================================================================
-- MIG 309 — Club Merchandise (Phase 9)
-- Two new tables (club_merchandise, club_purchases),
-- extend venue_charges source_type check,
-- 8 new RPCs (5 venue-side, 3 member-side).
-- =============================================================================

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE public.club_merchandise (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     text        NOT NULL REFERENCES public.clubs(id),
  venue_id    text        NOT NULL REFERENCES public.venues(id),
  name        text        NOT NULL,
  description text,
  category    text        NOT NULL
    CHECK (category IN ('kit','accessories','equipment','other')),
  price_pence int         NOT NULL CHECK (price_pence >= 0),
  stock_qty   int         CHECK (stock_qty > 0),
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.club_merchandise ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_merchandise FROM anon, authenticated;

CREATE TABLE public.club_purchases (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                  text        NOT NULL REFERENCES public.clubs(id),
  venue_id                 text        NOT NULL REFERENCES public.venues(id),
  member_profile_id        uuid        NOT NULL REFERENCES public.member_profiles(id),
  item_id                  uuid        NOT NULL REFERENCES public.club_merchandise(id),
  quantity                 int         NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_pence         int         NOT NULL,
  status                   text        NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','pending','fulfilled','cancelled')),
  stripe_payment_intent_id text,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.club_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_purchases FROM anon, authenticated;

-- ─── Extend venue_charges source_type ────────────────────────────────────────

ALTER TABLE public.venue_charges
  DROP CONSTRAINT venue_charges_source_type_check;
ALTER TABLE public.venue_charges
  ADD CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'booking','fixture','equipment','fee','membership','merchandise'
  ]));

-- ─── venue_upsert_merchandise ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_upsert_merchandise(
  p_venue_token text,
  p_club_id     text,
  p_name        text,
  p_category    text,
  p_price_pence int,
  p_id          uuid    DEFAULT NULL,
  p_description text    DEFAULT NULL,
  p_stock_qty   int     DEFAULT NULL,
  p_active      boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_item_id  uuid;
  v_is_new   boolean;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE='P0001';
  END IF;
  IF p_category NOT IN ('kit','accessories','equipment','other') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE='P0001';
  END IF;
  IF p_price_pence < 0 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  v_is_new := p_id IS NULL;

  IF v_is_new THEN
    INSERT INTO public.club_merchandise (club_id, venue_id, name, description, category, price_pence, stock_qty, active)
    VALUES (p_club_id, v_venue_id, btrim(p_name), p_description, p_category, p_price_pence, p_stock_qty, p_active)
    RETURNING id INTO v_item_id;
  ELSE
    UPDATE public.club_merchandise SET
      name        = btrim(p_name),
      description = p_description,
      category    = p_category,
      price_pence = p_price_pence,
      stock_qty   = p_stock_qty,
      active      = p_active
    WHERE id = p_id AND venue_id = v_venue_id
    RETURNING id INTO v_item_id;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE='P0001';
    END IF;
  END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    CASE WHEN v_is_new THEN 'merchandise_created' ELSE 'merchandise_updated' END,
    'club_merchandise', v_item_id::text,
    jsonb_build_object('club_id', p_club_id, 'name', btrim(p_name), 'category', p_category, 'price_pence', p_price_pence)
  );

  RETURN jsonb_build_object('ok', true, 'item_id', v_item_id, 'is_new', v_is_new);
END;
$$;
REVOKE ALL ON FUNCTION public.venue_upsert_merchandise FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_upsert_merchandise TO anon, authenticated;

-- ─── venue_list_merchandise ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_list_merchandise(
  p_venue_token text,
  p_club_id     text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  RETURN jsonb_build_object('items', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',              sub.id,
        'name',            sub.name,
        'description',     sub.description,
        'category',        sub.category,
        'price_pence',     sub.price_pence,
        'stock_qty',       sub.stock_qty,
        'active',          sub.active,
        'created_at',      sub.created_at,
        'purchases_count', sub.purchases_count,
        'pending_count',   sub.pending_count
      ) ORDER BY sub.created_at DESC
    )
    FROM (
      SELECT m.id, m.name, m.description, m.category,
             m.price_pence, m.stock_qty, m.active, m.created_at,
             COUNT(p.id) FILTER (WHERE p.status <> 'cancelled')                          AS purchases_count,
             COUNT(p.id) FILTER (WHERE p.status IN ('pending_payment','pending'))         AS pending_count
      FROM public.club_merchandise m
      LEFT JOIN public.club_purchases p ON p.item_id = m.id
      WHERE m.club_id  = p_club_id
        AND m.venue_id = v_venue_id
      GROUP BY m.id, m.name, m.description, m.category,
               m.price_pence, m.stock_qty, m.active, m.created_at
    ) sub
  ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.venue_list_merchandise FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_merchandise TO anon, authenticated;

-- ─── venue_list_purchases ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_list_purchases(
  p_venue_token text,
  p_club_id     text,
  p_status      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  RETURN jsonb_build_object('purchases', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',                        cp.id,
        'item_id',                   cp.item_id,
        'item_name',                 m.name,
        'item_category',             m.category,
        'member_name',               mp.first_name || ' ' || mp.last_name,
        'member_profile_id',         cp.member_profile_id,
        'quantity',                  cp.quantity,
        'unit_price_pence',          cp.unit_price_pence,
        'total_pence',               cp.quantity * cp.unit_price_pence,
        'status',                    cp.status,
        'notes',                     cp.notes,
        'created_at',                cp.created_at,
        'stripe_payment_intent_id',  cp.stripe_payment_intent_id
      ) ORDER BY cp.created_at DESC
    )
    FROM public.club_purchases cp
    JOIN public.club_merchandise m  ON m.id  = cp.item_id
    JOIN public.member_profiles  mp ON mp.id = cp.member_profile_id
    WHERE cp.club_id  = p_club_id
      AND cp.venue_id = v_venue_id
      AND (p_status IS NULL OR cp.status = p_status)
  ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.venue_list_purchases FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_purchases TO anon, authenticated;

-- ─── venue_fulfil_purchase ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_fulfil_purchase(
  p_venue_token text,
  p_purchase_id uuid,
  p_notes       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_purchase record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_purchase FROM public.club_purchases
  WHERE id = p_purchase_id AND venue_id = v_venue_id;
  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'purchase_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_purchase.status NOT IN ('pending_payment','pending') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='P0001';
  END IF;

  UPDATE public.club_purchases
  SET status = 'fulfilled', notes = COALESCE(p_notes, notes)
  WHERE id = p_purchase_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'merchandise_fulfilled', 'club_purchase', p_purchase_id::text,
    jsonb_build_object('club_id', v_purchase.club_id, 'item_id', v_purchase.item_id, 'quantity', v_purchase.quantity)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.venue_fulfil_purchase FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_fulfil_purchase TO anon, authenticated;

-- ─── venue_cancel_purchase ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_cancel_purchase(
  p_venue_token text,
  p_purchase_id uuid,
  p_reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_purchase record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_purchase FROM public.club_purchases
  WHERE id = p_purchase_id AND venue_id = v_venue_id;
  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'purchase_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_purchase.status = 'fulfilled' THEN
    RAISE EXCEPTION 'already_fulfilled' USING ERRCODE='P0001';
  END IF;
  IF v_purchase.status = 'cancelled' THEN
    RAISE EXCEPTION 'already_cancelled' USING ERRCODE='P0001';
  END IF;

  UPDATE public.club_purchases
  SET status = 'cancelled', notes = COALESCE(p_reason, notes)
  WHERE id = p_purchase_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'merchandise_cancelled', 'club_purchase', p_purchase_id::text,
    jsonb_build_object('club_id', v_purchase.club_id, 'item_id', v_purchase.item_id, 'reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.venue_cancel_purchase FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_purchase TO anon, authenticated;

-- ─── member_get_merchandise ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_get_merchandise(
  p_club_id text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships
    WHERE member_profile_id = v_profile_id
      AND club_id = p_club_id
      AND status IN ('active','ending')
  ) THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE='P0001';
  END IF;

  RETURN jsonb_build_object('items', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',          m.id,
        'name',        m.name,
        'description', m.description,
        'category',    m.category,
        'price_pence', m.price_pence,
        'stock_qty',   m.stock_qty
      ) ORDER BY m.category, m.name
    )
    FROM public.club_merchandise m
    WHERE m.club_id  = p_club_id
      AND m.active   = true
      AND (m.stock_qty IS NULL OR m.stock_qty > 0)
  ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.member_get_merchandise FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_get_merchandise FROM anon;
GRANT EXECUTE ON FUNCTION public.member_get_merchandise TO authenticated;

-- ─── member_purchase_merchandise ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_purchase_merchandise(
  p_item_id uuid,
  p_qty     int  DEFAULT 1,
  p_notes   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile_id  uuid;
  v_item        record;
  v_purchase_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF COALESCE(p_qty, 0) < 1 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE='P0001'; END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_item FROM public.club_merchandise WHERE id = p_item_id AND active = true FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE='P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships
    WHERE member_profile_id = v_profile_id
      AND club_id = v_item.club_id
      AND status IN ('active','ending')
  ) THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE='P0001';
  END IF;

  IF v_item.stock_qty IS NOT NULL AND v_item.stock_qty < p_qty THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0001';
  END IF;

  IF v_item.stock_qty IS NOT NULL THEN
    UPDATE public.club_merchandise SET stock_qty = stock_qty - p_qty WHERE id = p_item_id;
  END IF;

  INSERT INTO public.club_purchases (
    club_id, venue_id, member_profile_id, item_id,
    quantity, unit_price_pence, status, notes
  ) VALUES (
    v_item.club_id, v_item.venue_id, v_profile_id, p_item_id,
    p_qty, v_item.price_pence, 'pending_payment', p_notes
  ) RETURNING id INTO v_purchase_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    v_item.venue_id, v_uid, 'player',
    'merchandise_purchased', 'club_purchase', v_purchase_id::text,
    jsonb_build_object(
      'item_id',          p_item_id,
      'item_name',        v_item.name,
      'quantity',         p_qty,
      'unit_price_pence', v_item.price_pence,
      'club_id',          v_item.club_id
    )
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'purchase_id', v_purchase_id,
    'item_name',   v_item.name,
    'total_pence', p_qty * v_item.price_pence
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_purchase_merchandise FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_purchase_merchandise FROM anon;
GRANT EXECUTE ON FUNCTION public.member_purchase_merchandise TO authenticated;

-- ─── member_list_my_purchases ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_list_my_purchases(
  p_club_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001'; END IF;

  RETURN jsonb_build_object('purchases', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',               cp.id,
        'item_id',          cp.item_id,
        'item_name',        m.name,
        'item_category',    m.category,
        'club_id',          cp.club_id,
        'quantity',         cp.quantity,
        'unit_price_pence', cp.unit_price_pence,
        'total_pence',      cp.quantity * cp.unit_price_pence,
        'status',           cp.status,
        'created_at',       cp.created_at
      ) ORDER BY cp.created_at DESC
    )
    FROM public.club_purchases cp
    JOIN public.club_merchandise m ON m.id = cp.item_id
    WHERE cp.member_profile_id = v_profile_id
      AND (p_club_id IS NULL OR cp.club_id = p_club_id)
      AND cp.status <> 'cancelled'
  ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.member_list_my_purchases FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_list_my_purchases FROM anon;
GRANT EXECUTE ON FUNCTION public.member_list_my_purchases TO authenticated;
