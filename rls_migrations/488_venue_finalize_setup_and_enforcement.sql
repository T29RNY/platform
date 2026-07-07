-- Migration 488: Venue Setup Wizard PR-W5 — go-live auto-flip + public-listing
-- enforcement + new-signup alert surface + superadmin takedown.
--
-- This is the LAST, tier-3 piece: it makes going-live REAL and self-driving
-- (Decision #5 — an objective AUTO-FLIP, NOT a manual approval gate). Four objects:
--
--   1. venue_finalize_setup(p_venue_token)          — the owner-driven flip
--   2. search_bookable_venues(p_query)              — public-listing ENFORCEMENT
--   3. superadmin_set_venue_verification(id,status) — the rejected TAKEDOWN override
--   4. superadmin_list_venues()                     — the new-signup ALERT surface
--
-- SECURITY — the load-bearing rules:
--   * The flip is SERVER-OWNED: venue_finalize_setup re-checks the required set
--     (details present + >=1 pitch/space) server-side and only then flips
--     verification_status pending -> verified. The owner CANNOT set 'verified'
--     arbitrarily — there is no p_status param and no path to it — so this is not a
--     self-approval trust bypass. The predicate mirrors the JS isComplete() in
--     packages/core/setup/setupRegistry.js (address non-empty; playing_areas +
--     venue_spaces >= 1) so client and server agree on "ready".
--   * A 'rejected' venue (a superadmin takedown) can NOT self-reverse via
--     venue_finalize_setup — only superadmin_set_venue_verification can lift it.
--   * The two superadmin_* RPCs are is_platform_admin()-gated (mig 045), anon
--     REVOKEd by name (Supabase default-privileges auto-grant anon; REVOKE FROM
--     PUBLIC does not strip it — feedback_default_privileges_revoke).
--   * All writes audited (HR#9) with canonical audit_events columns; the
--     venue_self_serve_created row (mig 484) remains the durable new-signup record
--     that superadmin_list_venues surfaces (trust-but-monitor, not a gate).
--
-- Taking money stays SEPARATELY gated by Stripe Express KYC (charges_enabled),
-- independent of verification_status (Decision #5/#10).

-- ===========================================================================
-- 1. venue_finalize_setup — objective, server-checked go-live flip.
--    Owner-callable (venue token / Stage-1b JWT). Re-checks the required set;
--    flips pending -> verified iff satisfied. Idempotent when already verified;
--    refuses when rejected or incomplete.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.venue_finalize_setup(
  p_venue_token text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       record;
  v_venue_id     text;
  v_venue        record;
  v_bookable_cnt int;
  v_has_details  boolean;
  v_rows         int;
  v_final        text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, name, slug, address, verification_status
    INTO v_venue
    FROM venues WHERE id = v_venue_id;

  -- Already live — idempotent no-op (the hub may call this on a completed venue).
  IF v_venue.verification_status = 'verified' THEN
    RETURN jsonb_build_object('ok', true, 'verification_status', 'verified',
                              'already_live', true, 'slug', v_venue.slug);
  END IF;

  -- A platform takedown can only be lifted by a superadmin — never self-reversed.
  IF v_venue.verification_status = 'rejected' THEN
    RAISE EXCEPTION 'venue_rejected' USING ERRCODE = 'P0001';
  END IF;

  -- ── Server-side required-set re-check (mirrors setupRegistry isComplete) ──
  -- Details: an address is the honest deliberate-config signal (W3 predicate).
  v_has_details := (NULLIF(trim(COALESCE(v_venue.address, '')), '') IS NOT NULL);

  -- >=1 bookable: a pitch (playing_areas) OR a bookable space (venue_spaces).
  SELECT
    (SELECT count(*) FROM playing_areas pa WHERE pa.venue_id = v_venue_id)
  + (SELECT count(*) FROM venue_spaces vs WHERE vs.venue_id = v_venue_id)
    INTO v_bookable_cnt;

  IF NOT v_has_details OR v_bookable_cnt < 1 THEN
    RAISE EXCEPTION 'setup_incomplete' USING ERRCODE = 'P0001',
      DETAIL = format('details=%s bookable=%s', v_has_details, v_bookable_cnt);
  END IF;

  -- Flip. Guard the WHERE on 'pending' so a concurrent flip can't double-fire.
  UPDATE venues
     SET verification_status = 'verified'
   WHERE id = v_venue_id AND verification_status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- If a concurrent superadmin takedown flipped the row between the read above and
  -- this UPDATE, 0 rows change — do NOT emit a false 'went_live' audit/notify.
  -- Re-read and return the true current status instead.
  IF v_rows <> 1 THEN
    SELECT verification_status INTO v_final FROM venues WHERE id = v_venue_id;
    RETURN jsonb_build_object('ok', false, 'verification_status', v_final,
                              'flipped', false, 'slug', v_venue.slug);
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_went_live', 'venue', v_venue_id,
          jsonb_build_object('venue_id', v_venue_id, 'bookable_count', v_bookable_cnt));

  PERFORM public.notify_venue_change(v_venue_id, 'venue_went_live');

  RETURN jsonb_build_object('ok', true, 'verification_status', 'verified',
                            'slug', v_venue.slug);
END;
$function$;

REVOKE ALL    ON FUNCTION public.venue_finalize_setup(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.venue_finalize_setup(text) TO anon, authenticated;

-- ===========================================================================
-- 2. search_bookable_venues — ENFORCE verification_status='verified'.
--    Body verbatim from mig 149; the ONLY change is the added AND on line ~ WHERE
--    (marked SW488). A pending/rejected venue is now genuinely absent from public
--    discovery until it goes live. Existing (operator-led) venues default
--    'verified' (mig 484) so they are unaffected.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.search_bookable_venues(p_query text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'venue_id', s.id, 'name', s.name, 'slug', s.slug, 'city', s.city,
           'cancellation_policy', s.cancellation_policy)
         ORDER BY s.name), '[]'::jsonb)
  FROM (
    SELECT v.id, v.name, v.slug, v.city, v.cancellation_policy
    FROM venues v
    WHERE v.bookings_enabled = true AND v.active = true
      AND v.verification_status = 'verified'                    -- SW488 enforcement
      AND (
        p_query IS NULL OR length(trim(p_query)) = 0
        OR v.name ILIKE '%' || trim(p_query) || '%'
        OR v.slug ILIKE '%' || trim(p_query) || '%'
        OR v.city ILIKE '%' || trim(p_query) || '%'
      )
    ORDER BY v.name
    LIMIT 20
  ) s;
$function$;
REVOKE ALL ON FUNCTION public.search_bookable_venues(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_bookable_venues(text) TO anon, authenticated;

-- ===========================================================================
-- 3. superadmin_set_venue_verification — the rejected TAKEDOWN override.
--    is_platform_admin()-gated (mig 045). Post-hoc removal (-> 'rejected') or
--    restore (-> 'verified'/'pending'). The ONLY path that can set 'rejected' or
--    lift it. Never trusts a client identity — auth.uid() via is_platform_admin().
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.superadmin_set_venue_verification(
  p_venue_id text,
  p_status   text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prev text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin' USING ERRCODE = 'P0001';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('verified', 'pending', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  SELECT verification_status INTO v_prev FROM venues WHERE id = p_venue_id;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE venues SET verification_status = p_status WHERE id = p_venue_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (p_venue_id, auth.uid(), 'platform_admin', 'user_id:' || COALESCE(auth.uid()::text, ''),
          'venue_verification_set_by_admin', 'venue', p_venue_id,
          jsonb_build_object('venue_id', p_venue_id, 'from', v_prev, 'to', p_status));

  PERFORM public.notify_venue_change(p_venue_id, 'venue_verification_changed');

  RETURN jsonb_build_object('ok', true, 'venue_id', p_venue_id,
                            'from', v_prev, 'verification_status', p_status);
END;
$function$;

REVOKE ALL    ON FUNCTION public.superadmin_set_venue_verification(text, text) FROM public;
REVOKE ALL    ON FUNCTION public.superadmin_set_venue_verification(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.superadmin_set_venue_verification(text, text) TO authenticated;

-- ===========================================================================
-- 4. superadmin_list_venues — the new-signup ALERT surface.
--    is_platform_admin()-gated read. Surfaces recent venues (self-serve first for
--    monitoring) with origin + verification_status + bookable counts so the
--    platform sees new sign-ups (trust-but-monitor, Decision #5). The durable
--    signal is the venue_self_serve_created audit row (mig 484); this is the
--    queryable view of it + the list the takedown UI acts on.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.superadmin_list_venues()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      v.id                  AS venue_id,
      v.name,
      v.city,
      v.origin,
      v.verification_status,
      v.subscription_status,
      v.contact_email,
      v.created_at,
      (SELECT count(*) FROM playing_areas pa WHERE pa.venue_id = v.id)
        + (SELECT count(*) FROM venue_spaces vs WHERE vs.venue_id = v.id) AS bookable_count
    FROM venues v
    ORDER BY v.created_at DESC NULLS LAST
    LIMIT 200
  ) t;

  RETURN v_result;
END;
$function$;

REVOKE ALL    ON FUNCTION public.superadmin_list_venues() FROM public;
REVOKE ALL    ON FUNCTION public.superadmin_list_venues() FROM anon;
GRANT  EXECUTE ON FUNCTION public.superadmin_list_venues() TO authenticated;
