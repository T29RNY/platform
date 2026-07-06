-- 484_self_serve_create_venue.sql
--
-- Self-Serve Multi-Vertical epic — PR3, the OWNERSHIP FOUNDATION.
--
-- The one piece of backend that all of venue/club/gym self-serve reuse: a
-- de-gated create RPC that mints a venue SHELL and, in the same transaction,
-- grants the authenticated creator its first venue_admins(role='owner') row.
-- That owner row is the whole unlock — it satisfies resolve_venue_caller
-- (mig 237) Stage 1b and club_create's (mig 286) "must already be a venue
-- admin" precondition, so the entire already-built downstream chain
-- (club_create -> cohort -> team, venue_set_club_discipline, class scheduling)
-- works unchanged with no further backend.
--
-- This is superadmin_create_venue (mig 085) MINUS the is_platform_admin()
-- gate, PLUS the venue_admins owner insert that mig 085 never did (mig 085
-- relies on the shared venue_admin_token master key instead).
--
-- SECURITY — the load-bearing rules:
--   * SECURITY DEFINER, search_path pinned, authenticated-only, anon REVOKEd
--     BY NAME (Supabase default-privileges auto-grant anon; REVOKE FROM PUBLIC
--     does not strip it — see feedback_default_privileges_revoke).
--   * Ownership derives from auth.uid() server-side. p_contact_email is contact
--     METADATA only (mirrors mig 085 p_operator_email), never a trust signal.
--   * NEVER returns venue_admin_token. A self-serve owner gets ONLY the scoped
--     venue_admins row; the master token (which bypasses per-person caps) is
--     never handed to a self-serve client (epic Decision #5).
--   * verification_status='pending' on every self-created venue — created and
--     configurable immediately, but going publicly live / taking money stays
--     gated on it. Stripe Connect Express KYC/AML is the real money gate
--     (Decision #10, the L2278 "year 2" override for the trial shell only).
--   * Abuse cap: a de-gated create RPC is a spam surface, so a user may hold at
--     most 3 self-serve venues still in verification_status='pending'.
--   * Audit uses the canonical audit_events columns + actor_type='venue_admin'
--     (a value in the audit_events_actor_type_check list, mig 171) — sidesteps
--     the F1 (dead columns) / F2 (invalid actor_type) latent bugs in mig 286.
--
-- Second consumer (HR#14): the same owner-row shape is the intended write path
-- for the scoped-but-unbuilt client-onboarding import tool
-- (CLIENT_ONBOARDING_IMPORT_HANDOFF.md). That tool will get its own thin
-- superadmin wrapper later that inserts the identical shape — this RPC stays
-- self-only (auth.uid()) with no "create on behalf of" param, to keep the
-- de-gated surface minimal.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Additive columns on venues (safe defaults — existing rows untouched)
-- ─────────────────────────────────────────────────────────────────────────
-- verification_status defaults to 'verified' so every EXISTING (operator-led)
-- venue is unaffected; only the self-serve RPC writes 'pending'.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'verified'
    CHECK (verification_status IN ('verified','pending','rejected'));

-- origin defaults to 'superadmin' so existing rows read as operator-created;
-- only the self-serve RPC writes 'self_serve'.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'superadmin'
    CHECK (origin IN ('superadmin','self_serve'));

-- created_by_user records the self-serve creator (redundant with the
-- venue_admins owner row, but cheap and useful for filtering/reporting and the
-- future import tool). NULL on every existing row.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS created_by_user uuid REFERENCES auth.users(id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. The self-serve create RPC
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.self_serve_create_venue(
  p_name          text,
  p_contact_email text,
  p_sport         text DEFAULT 'football'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_email       text;
  v_sport       text;
  v_venue_id    text;
  v_owned_count int;
BEGIN
  -- Auth gate — authenticated only. anon is REVOKEd below, but defend in depth.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  -- Input validation
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'venue_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(trim(p_name)) > 120 THEN
    RAISE EXCEPTION 'venue_name_too_long' USING ERRCODE = 'P0001';
  END IF;
  IF p_contact_email IS NULL OR p_contact_email !~* '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'contact_email_invalid' USING ERRCODE = 'P0001';
  END IF;
  v_email := lower(trim(p_contact_email));
  v_sport := COALESCE(NULLIF(trim(p_sport), ''), 'football');

  -- Abuse cap — at most 3 self-serve venues per user still awaiting
  -- verification. Keeps a de-gated create RPC from being a spam surface.
  SELECT count(*) INTO v_owned_count
  FROM public.venue_admins va
  JOIN public.venues v ON v.id = va.venue_id
  WHERE va.user_id = v_uid
    AND va.role = 'owner'
    AND v.origin = 'self_serve'
    AND v.verification_status = 'pending';
  IF v_owned_count >= 3 THEN
    RAISE EXCEPTION 'self_serve_venue_cap_reached' USING ERRCODE = 'P0001';
  END IF;

  -- Create the venue shell — trial + pending + self_serve.
  v_venue_id := 'v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  INSERT INTO public.venues (
    id, name, sport, contact_email, active,
    subscription_status, verification_status, origin, created_by_user
  )
  VALUES (
    v_venue_id, trim(p_name), v_sport, v_email, true,
    'trial', 'pending', 'self_serve', v_uid
  );

  -- Grant the creator the first owner row — the whole point of this RPC.
  INSERT INTO public.venue_admins (
    venue_id, user_id, email, role, status, granted_by, granted_at
  )
  VALUES (
    v_venue_id, v_uid, v_email, 'owner', 'active', v_uid, now()
  );

  -- Audit — canonical columns; actor_type from the CHECK-valid set.
  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, v_uid, 'venue_admin', 'user_id:' || v_uid::text,
    'venue_self_serve_created', 'venue', v_venue_id,
    jsonb_build_object(
      'venue_name', trim(p_name),
      'sport', v_sport,
      'origin', 'self_serve',
      'verification_status', 'pending'
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'venue_created');

  -- Return the scoped id only. NEVER the venue_admin_token.
  RETURN jsonb_build_object(
    'ok', true,
    'venue_id', v_venue_id,
    'verification_status', 'pending',
    'origin', 'self_serve'
  );
END;
$function$;

-- Grants: authenticated-only. Strip PUBLIC and the auto-granted anon explicitly.
REVOKE ALL ON FUNCTION public.self_serve_create_venue(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_create_venue(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_create_venue(text, text, text) TO authenticated;
