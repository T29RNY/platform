-- 237_venue_staff_logins_core.sql
--
-- Venue staff logins — Phase 1 (data + auth core). Design: DECISIONS.md
-- "VENUE LOGIN CREDENTIALS → Session 78" + memory project_venue_staff_logins.
--
-- Additive + safe: the existing shared-token path is untouched; the new
-- authenticated stage in resolve_venue_caller only fires for a logged-in user
-- who is an active venue_admins member — of which there are none until invites
-- ship (Phase 3). The two demo venues are seeded an Owner invite (operator
-- email) so the demo is claimable on first sign-in.
--
-- Ships: venue_admins table; _venue_has_cap helper; resolve_venue_caller gains
-- role + caps in its return + an authenticated stage; venue_whoami (read);
-- venue_claim_memberships (write, email-matched on the VERIFIED auth email).
-- Phases 2-5 (login UI, invites, per-RPC gating, attribution) come later.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. venue_admins — per-person venue accounts (copies team_admins mig 002,
--    + email/status for the invite flow + caps_grant/deny for per-person
--    overrides). 5 gated capabilities; everything else is open to any member.
--    Supersedes an unused 5-column venue_admins stub (id/venue_id/user_id/role/
--    created_at — 0 rows, no RPC refs, no inbound FKs) left from early Phase 2.
-- ──────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.venue_admins CASCADE;
CREATE TABLE public.venue_admins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    text NOT NULL REFERENCES public.venues(id),
  user_id     uuid REFERENCES auth.users(id),           -- NULL until invite accepted
  email       text NOT NULL,                             -- invite target; matched (lower) on first sign-in
  role        text NOT NULL CHECK (role IN ('owner','manager','staff')),
  caps_grant  text[] NOT NULL DEFAULT '{}',
  caps_deny   text[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','revoked')),
  granted_by  uuid REFERENCES auth.users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- caps must be a subset of the known gated set
  CONSTRAINT venue_admins_caps_known CHECK (
    caps_grant <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins']::text[]
    AND caps_deny <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins']::text[]
  )
);

-- one active membership per (venue, email); fast lookups by user + venue
CREATE UNIQUE INDEX IF NOT EXISTS venue_admins_uniq_active
  ON public.venue_admins (venue_id, lower(email)) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS venue_admins_by_user
  ON public.venue_admins (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS venue_admins_by_venue
  ON public.venue_admins (venue_id) WHERE revoked_at IS NULL;

ALTER TABLE public.venue_admins ENABLE ROW LEVEL SECURITY;
-- No direct policies: all access via SECURITY DEFINER RPCs (matches team_admins).

-- ──────────────────────────────────────────────────────────────────────────
-- 2. _venue_has_cap — effective capability for a (role, grants, denies, cap).
--    owner = everything; manager = all 5 gated caps by default; staff = none.
--    Per-person deny removes, grant adds. (Owner-only structural actions are
--    gated on role='owner' directly, not via a capability.)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._venue_has_cap(p_role text, p_grant text[], p_deny text[], p_cap text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_role = 'owner'                          THEN true
    WHEN p_cap = ANY(COALESCE(p_deny, '{}'::text[])) THEN false
    WHEN p_cap = ANY(COALESCE(p_grant,'{}'::text[])) THEN true
    WHEN p_role = 'manager'                        THEN true
    ELSE false
  END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. resolve_venue_caller — return shape gains role + caps_grant + caps_deny,
--    and a Stage 1b for a logged-in venue staff member. DROP+CREATE because
--    adding OUT columns changes the result type (CREATE OR REPLACE can't).
--    Shared-token + platform-admin stages keep full power (role 'owner').
-- ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.resolve_venue_caller(text);
CREATE FUNCTION public.resolve_venue_caller(p_token text)
 RETURNS TABLE(venue_id text, actor_type text, actor_ident text, role text, caps_grant text[], caps_deny text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Stage 1: shared venue_admin_token (legacy master key / dev-demo backdoor)
  IF p_token IS NOT NULL THEN
    RETURN QUERY
      SELECT v.id::text,
             'venue_admin'::text,
             ('venue_admin_token:' || md5(p_token))::text,
             'owner'::text, '{}'::text[], '{}'::text[]
      FROM venues v
      WHERE v.venue_admin_token = p_token
        AND v.active = true
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Stage 1b: a logged-in venue staff member acting on their venue.
  -- For logins the client passes the venue_id in the same slot the shared
  -- token used (venue ids never collide with the long random tokens).
  IF v_uid IS NOT NULL AND p_token IS NOT NULL THEN
    RETURN QUERY
      SELECT va.venue_id,
             'venue_admin'::text,
             ('user_id:' || v_uid::text)::text,
             va.role, va.caps_grant, va.caps_deny
      FROM public.venue_admins va
      WHERE va.user_id = v_uid
        AND va.venue_id = p_token
        AND va.status = 'active'
        AND va.revoked_at IS NULL
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Stage 2: platform admin override (operator-led onboarding)
  IF v_uid IS NOT NULL AND public.is_platform_admin() THEN
    RETURN QUERY
      SELECT NULL::text,
             'platform_admin'::text,
             ('user_id:' || v_uid::text)::text,
             'owner'::text, '{}'::text[], '{}'::text[];
    RETURN;
  END IF;
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. venue_whoami — the app's post-login "which venues am I, and as what role".
--    Mirrors company_admin_whoami. Read-only.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_whoami()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text;
  v_venues jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('signed_in', false);
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'venue_id',   va.venue_id,
           'name',       v.name,
           'role',       va.role,
           'caps_grant', va.caps_grant,
           'caps_deny',  va.caps_deny
         ) ORDER BY v.name), '[]'::jsonb)
    INTO v_venues
  FROM public.venue_admins va
  JOIN public.venues v ON v.id = va.venue_id
  WHERE va.user_id = v_uid AND va.status = 'active' AND va.revoked_at IS NULL;

  RETURN jsonb_build_object(
    'signed_in', true,
    'user_id',   v_uid,
    'email',     v_email,
    'venues',    v_venues
  );
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. venue_claim_memberships — on first sign-in, bind any 'invited' rows for
--    this user's VERIFIED auth email to their user_id + activate them. Email
--    is read server-side from auth.users (never client-passed) so it can't be
--    spoofed — Supabase has already verified ownership via OTP/OAuth.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_claim_memberships()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text;
  v_claimed int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN jsonb_build_object('ok', true, 'claimed', 0); END IF;

  WITH upd AS (
    UPDATE public.venue_admins
       SET user_id = v_uid, status = 'active'
     WHERE status = 'invited' AND user_id IS NULL
       AND revoked_at IS NULL
       AND lower(email) = lower(v_email)
    RETURNING id, venue_id, role
  )
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  SELECT upd.venue_id, v_uid, 'venue_admin', 'user_id:' || v_uid::text,
         'venue_membership_claimed', 'venue_admin', upd.id::text,
         jsonb_build_object('venue_id', upd.venue_id, 'role', upd.role)
  FROM upd;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'claimed', v_claimed);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_whoami() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_whoami() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_claim_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_claim_memberships() TO authenticated;
-- _venue_has_cap is an internal helper for SECDEF RPCs; no client grant needed.
REVOKE ALL ON FUNCTION public._venue_has_cap(text, text[], text[], text) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Seed the two demo venues an Owner invite (operator email). Claimed to an
--    active Owner the first time the operator signs into the venue app.
--    Real venues need no seed — their first Owner is the first onboarding invite.
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_admins (venue_id, email, role, status)
SELECT v.id, 'tarnysingh@gmail.com', 'owner', 'invited'
FROM public.venues v
WHERE v.id IN ('demo_venue', 'venue_demo_south')
ON CONFLICT DO NOTHING;
