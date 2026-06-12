-- 272_member_pass_token_down.sql — reverse of 272.
-- Restores the mig-271 venue_list_members (without pass_token), drops the pass RPC
-- and the column.

DROP FUNCTION IF EXISTS public.get_member_pass(text);

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

DROP INDEX IF EXISTS public.venue_memberships_pass_token;
ALTER TABLE public.venue_memberships DROP COLUMN IF EXISTS pass_token;
