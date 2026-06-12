-- 272_member_pass_token.sql
--
-- Phase 5 (backend floor) — the member-facing PASS.
-- Each membership gets a stable, opaque `pass_token` (the secret in the member's
-- `/m/<token>` PWA link + QR). A public read RPC `get_member_pass(token)` returns
-- the pass payload (tier, perks, status, renewal, venue brand) keyed ONLY by that
-- secret — same trust model as the `/p/<player_token>` pages (anon-readable, but
-- you must hold the token). `venue_list_members` gains `pass_token` so venue ops
-- can copy/share the pass link.
--
-- Token is opaque + random for v1; designed so signed-rotation is a later config
-- flip, not a schema change. Wallet (PassKit) + reception check-in build on top.

-- 1. pass_token on memberships (UNIQUE, auto-filled by default for every row)
ALTER TABLE public.venue_memberships
  ADD COLUMN IF NOT EXISTS pass_token text NOT NULL
  DEFAULT ('m_' || replace(gen_random_uuid()::text, '-', ''));
CREATE UNIQUE INDEX IF NOT EXISTS venue_memberships_pass_token ON public.venue_memberships (pass_token);

-- 2. get_member_pass(token) — PUBLIC read (anon), keyed by the secret pass_token.
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

-- 3. venue_list_members — add pass_token (supersedes the mig-271 return shape so
--    venue ops can copy/share the member's pass link).
CREATE OR REPLACE FUNCTION public.venue_list_members(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'membership_id', m.id, 'status', m.status, 'period', m.period, 'amount_pence', m.amount_pence,
            'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until, 'cancel_at', m.cancel_at,
            'due_soon', (m.status='active' AND m.renews_at <= current_date + 7),
            'pass_token', m.pass_token,
            'customer_id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'email', c.email,
            'tier_id', t.id, 'tier_name', t.name
          ) ORDER BY m.status, c.first_name), '[]'::jsonb)
    INTO v_rows
    FROM public.venue_memberships m
    JOIN public.venue_customers c ON c.id = m.customer_id
    JOIN public.venue_membership_tiers t ON t.id = m.tier_id
   WHERE m.venue_id = v_venue_id AND m.status <> 'cancelled';
  RETURN jsonb_build_object('ok', true, 'members', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_members(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_members(text) TO anon, authenticated;
