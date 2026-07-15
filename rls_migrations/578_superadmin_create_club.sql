-- 578_superadmin_create_club.sql
--
-- DF Sports Onboarding — PR #1, the OPERATOR-LED venueless-club mint.
--
-- superadmin_create_club is the platform-admin twin of self_serve_create_club
-- (mig 518). Same atomic body — shell venue → owner → club → club_venues link —
-- but provisioned FOR a customer (DF Sports) BY a platform admin, not by the
-- club's own owner. Two deltas make it operator-led:
--
--   1. GATE — is_platform_admin() (mig 085), not authenticated-only. Anon and
--      ordinary authenticated callers are rejected with 'not_platform_admin'.
--   2. OWNER = PENDING INVITE, not the caller. The caller is a platform admin,
--      NOT the club's owner. The owner row is minted as an email-keyed INVITE
--      (user_id NULL, status='invited') exactly like venue_invite_admin (mig 238)
--      — the invitee (Danny) is bound to it on his first verified sign-in by the
--      existing venue_claim_memberships (mig 237), which sets user_id + activates
--      the row; the mig-371 trg_venue_admins_person_id trigger (BEFORE INSERT OR
--      UPDATE OF user_id) then fills person_id. Only after that does get_my_world's
--      venue arm (status='active' + person_id match, mig 520) surface it — and
--      because origin='self_serve' + exactly one club_venues link, nav.js routes
--      him to the CLUB-ADMIN hat, never a full operator hat. That resolution
--      chain is unchanged, live plumbing — this RPC only mints the correct
--      pending-invite shape into it.
--
-- No abuse cap (unlike mig 518): the is_platform_admin() gate IS the abuse control,
-- and a platform admin legitimately mints many clubs (the DF-as-channel vending
-- machine). Mirrors mig 085 superadmin_create_venue, which likewise has no cap.
--
-- MUST stamp origin='self_serve' (the trap, LOCKED DECISION #1): without it,
-- get_my_world/nav.js hand the owner a full operator hat with no club-admin
-- surface. The same one enum value makes an operator-minted club byte-identical
-- to a future self-serve-minted one (zero backfill when PR5 unblocks).
--
-- SECURITY — the load-bearing rules (mirror mig 518 + mig 085):
--   * SECURITY DEFINER, search_path pinned (public, pg_temp).
--   * is_platform_admin() gate; anon REVOKEd BY NAME (Supabase default-privileges
--     auto-grant anon; REVOKE FROM PUBLIC does not strip it —
--     feedback_default_privileges_revoke). Defence in depth vs the SQL gate.
--   * p_owner_email is the OWNER INVITE target + club/venue contact metadata —
--     never a trust signal, never granted access until email-verified sign-in.
--   * NEVER returns venue_admin_token — the master key is never handed out.
--   * verification_status='pending', origin='self_serve' on the shell venue —
--     created + configurable immediately, but going publicly live / taking money
--     stays gated on verification (Stripe Connect KYC is the real money gate).
--   * Audit uses the CANONICAL audit_events columns + actor_type='platform_admin'
--     (a CHECK-valid value, used live by mig 085).
--   * venues.created_by_user records the PROVISIONER (the platform admin) as
--     provenance only — it is NOT an auth signal for venues (auth derives from
--     venue_admins). Verified: created_by_user is auth-load-bearing only in the
--     tournament domain (migs 489/492/495), never for venues.
--
-- Reuses the columns mig 484/518 added to venues (verification_status, origin,
-- created_by_user) — no new schema here, just the function.

CREATE OR REPLACE FUNCTION public.superadmin_create_club(
  p_name        text,
  p_owner_email text,
  p_short_name  text DEFAULT NULL,
  p_sport       text DEFAULT 'football'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_email      text;
  v_sport      text;
  v_short      text;
  v_venue_id   text;
  v_club_id    text;
BEGIN
  -- Auth gate — platform admins only. anon is REVOKEd below; defend in depth.
  IF v_uid IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin' USING ERRCODE = 'P0001';
  END IF;

  -- Input validation
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'club_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(trim(p_name)) > 120 THEN
    RAISE EXCEPTION 'club_name_too_long' USING ERRCODE = 'P0001';
  END IF;
  IF p_owner_email IS NULL OR p_owner_email !~* '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'owner_email_invalid' USING ERRCODE = 'P0001';
  END IF;
  v_email := lower(trim(p_owner_email));
  v_sport := COALESCE(NULLIF(trim(p_sport), ''), 'football');
  v_short := NULLIF(trim(COALESCE(p_short_name, '')), '');

  -- Derive the club's stable text id from its name (mirrors club_create, mig 286).
  v_club_id := 'club_' || lower(regexp_replace(
    regexp_replace(trim(p_name), '[^a-zA-Z0-9\s]', '', 'g'),
    '\s+', '_', 'g'
  ));
  v_club_id := left(v_club_id, 60);
  IF v_club_id IS NULL OR v_club_id = 'club_' THEN
    RAISE EXCEPTION 'club_name_unusable' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clubs WHERE id = v_club_id) THEN
    RAISE EXCEPTION 'club_id_taken' USING ERRCODE = 'P0001';
  END IF;

  -- 1. The shell venue — trial + pending + self_serve (the club's home).
  --    origin='self_serve' is MANDATORY (Decision #1): it is what makes nav.js
  --    route the owner into the club-admin hat rather than a full operator hat.
  --    created_by_user = the provisioning platform admin (provenance only).
  v_venue_id := 'v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  INSERT INTO public.venues (
    id, name, sport, contact_email, active,
    subscription_status, verification_status, origin, created_by_user
  )
  VALUES (
    v_venue_id, trim(p_name), v_sport, v_email, true,
    'trial', 'pending', 'self_serve', v_uid
  );

  -- 2. The owner row — a PENDING INVITE keyed by email (NOT the caller). user_id
  --    stays NULL and status='invited' until the owner signs in with this verified
  --    email; venue_claim_memberships (mig 237) then binds user_id + activates it,
  --    and the mig-371 trigger fills person_id. This is byte-identical in shape to
  --    a venue_invite_admin (mig 238) 'owner' invite, so it inherits that proven
  --    claim → resolve → club-admin-hat chain. granted_by = the platform admin.
  INSERT INTO public.venue_admins (
    venue_id, user_id, email, role, status, granted_by, granted_at
  )
  VALUES (
    v_venue_id, NULL, v_email, 'owner', 'invited', v_uid, now()
  );

  -- 3. The club row. discipline is INTENTIONALLY left to default ('football'):
  --    clubs.discipline is a restricted ACTIVITY taxonomy — a DIFFERENT set from
  --    venues.sport — so it must NOT be set from p_sport. DF Sports is football,
  --    so the default is correct; a non-football club sets discipline via a
  --    follow-up club update.
  INSERT INTO public.clubs (id, name, short_name, contact_email)
  VALUES (v_club_id, trim(p_name), v_short, v_email);

  -- 4. Link the club to its home venue.
  INSERT INTO public.club_venues (club_id, venue_id)
  VALUES (v_club_id, v_venue_id);

  -- Audit — canonical columns; actor_type='platform_admin' (CHECK-valid, mig 085).
  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, v_uid, 'platform_admin', 'user_id:' || v_uid::text,
    'club_superadmin_created', 'club', v_club_id,
    jsonb_build_object(
      'club_id', v_club_id,
      'venue_id', v_venue_id,
      'club_name', trim(p_name),
      'sport', v_sport,
      'owner_email', v_email,
      'owner_status', 'invited',
      'origin', 'self_serve',
      'verification_status', 'pending'
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'venue_created');

  -- Return the scoped ids + the owner-invite state. NEVER the venue_admin_token.
  RETURN jsonb_build_object(
    'ok', true,
    'club_id', v_club_id,
    'venue_id', v_venue_id,
    'owner_email', v_email,
    'owner_status', 'invited',
    'verification_status', 'pending',
    'origin', 'self_serve'
  );
END;
$function$;

-- Grants: authenticated-only surface (the is_platform_admin() gate does the real
-- work inside). Strip PUBLIC and the auto-granted anon explicitly.
REVOKE ALL ON FUNCTION public.superadmin_create_club(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.superadmin_create_club(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.superadmin_create_club(text, text, text, text) TO authenticated;
