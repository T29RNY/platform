-- 518_self_serve_create_club.sql
--
-- Club Console Consolidation — PR #4, the venueless-club ownership foundation.
--
-- A club that runs no physical facility is UNREACHABLE in the venue-keyed
-- console: venueWhoami returns venues only, every club RPC takes a venue token,
-- and club-admin auth (mig 286) requires a venue_admins row for a venue. This
-- writer closes that gap the SAME way self_serve_create_venue (mig 484) closes
-- the venueless-operator gap — Decision 3(a): provision a lightweight HOME-VENUE
-- SHELL for the club so it is addressable through the one existing spine, with
-- NO parallel club-token / club-whoami auth family (Decision 3(b), rejected).
--
-- One atomic transaction mints: a shell venues row + the creator's venue_admins
-- (role='owner') row + a clubs row + the club_venues link. If any step fails
-- (e.g. the club id is taken) the WHOLE thing rolls back — no orphan shell.
--
-- Unblocks SELF_SERVE_MULTI_VERTICAL PR5 (club self-serve onboarding), which is
-- this RPC's intended in-app consumer (HR#14). This migration ships the writer +
-- its @platform/core wrapper; the onboarding UI that calls it, and the venue
-- console's auto-activate-lens-on-club-shell, land with PR5 / a follow-on.
--
-- SECURITY — the load-bearing rules (mirrors mig 484 exactly):
--   * SECURITY DEFINER, search_path pinned, authenticated-only, anon REVOKEd
--     BY NAME (Supabase default-privileges auto-grant anon; REVOKE FROM PUBLIC
--     does not strip it — feedback_default_privileges_revoke).
--   * Ownership derives from auth.uid() server-side. The minted owner row is for
--     the CALLER only (user_id = auth.uid()); no "create on behalf of" param.
--   * p_contact_email is contact METADATA only, never a trust signal.
--   * NEVER returns venue_admin_token — a self-serve owner gets ONLY the scoped
--     venue_admins row; the master token is never handed to a self-serve client.
--   * verification_status='pending', origin='self_serve' on the shell venue —
--     created + configurable immediately, but going publicly live / taking money
--     stays gated on verification (Stripe Connect KYC is the real money gate).
--   * Abuse cap: at most 3 self-serve shells still awaiting verification per user
--     (mig-484's exact cap) — keeps a de-gated create RPC off the spam surface.
--   * Audit uses the CANONICAL audit_events columns + actor_type='venue_admin'
--     (a CHECK-valid value, mig 171) — NOT mig 286 club_create's non-canonical
--     actor_id/event_type/payload shape (its F1/F2 latent bugs, flagged in 484).
--
-- Reuses the columns mig 484 already added to venues (verification_status,
-- origin, created_by_user) — no new schema here, just the function.

CREATE OR REPLACE FUNCTION public.self_serve_create_club(
  p_name          text,
  p_contact_email text,
  p_short_name    text DEFAULT NULL,
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
  v_short       text;
  v_venue_id    text;
  v_club_id     text;
  v_owned_count int;
BEGIN
  -- Auth gate — authenticated only. anon is REVOKEd below; defend in depth.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  -- Input validation
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'club_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(trim(p_name)) > 120 THEN
    RAISE EXCEPTION 'club_name_too_long' USING ERRCODE = 'P0001';
  END IF;
  IF p_contact_email IS NULL OR p_contact_email !~* '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'contact_email_invalid' USING ERRCODE = 'P0001';
  END IF;
  v_email := lower(trim(p_contact_email));
  v_sport := COALESCE(NULLIF(trim(p_sport), ''), 'football');
  v_short := NULLIF(trim(COALESCE(p_short_name, '')), '');

  -- Abuse cap — at most 3 self-serve shells per user still awaiting
  -- verification (identical to mig 484's cap; counts the caller's pending
  -- self_serve owner venues, which each self_serve_create_club mints exactly one of).
  SELECT count(*) INTO v_owned_count
  FROM public.venue_admins va
  JOIN public.venues v ON v.id = va.venue_id
  WHERE va.user_id = v_uid
    AND va.role = 'owner'
    AND v.origin = 'self_serve'
    AND v.verification_status = 'pending';
  IF v_owned_count >= 3 THEN
    RAISE EXCEPTION 'self_serve_club_cap_reached' USING ERRCODE = 'P0001';
  END IF;

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
  v_venue_id := 'v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  INSERT INTO public.venues (
    id, name, sport, contact_email, active,
    subscription_status, verification_status, origin, created_by_user
  )
  VALUES (
    v_venue_id, trim(p_name), v_sport, v_email, true,
    'trial', 'pending', 'self_serve', v_uid
  );

  -- 2. The creator's owner row — the whole unlock (satisfies resolve_venue_caller
  --    Stage 1b + club-admin preconditions). Caller only; never a passed user_id.
  INSERT INTO public.venue_admins (
    venue_id, user_id, email, role, status, granted_by, granted_at
  )
  VALUES (
    v_venue_id, v_uid, v_email, 'owner', 'active', v_uid, now()
  );

  -- 3. The club row. discipline is INTENTIONALLY left to default ('football'):
  --    clubs.discipline is a restricted ACTIVITY taxonomy (football/gym/boxing/
  --    martial_arts/yoga/dance/fitness/other) — a DIFFERENT set from venues.sport,
  --    so it must NOT be set from p_sport (a 'cricket' sport is not a valid
  --    discipline). PR5's multi-vertical onboarding sets a non-football discipline
  --    via a future p_discipline param or a follow-up club update.
  INSERT INTO public.clubs (id, name, short_name, contact_email)
  VALUES (v_club_id, trim(p_name), v_short, v_email);

  -- 4. Link the club to its home venue.
  INSERT INTO public.club_venues (club_id, venue_id)
  VALUES (v_club_id, v_venue_id);

  -- Audit — canonical columns; actor_type from the CHECK-valid set.
  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, v_uid, 'venue_admin', 'user_id:' || v_uid::text,
    'club_self_serve_created', 'club', v_club_id,
    jsonb_build_object(
      'club_id', v_club_id,
      'venue_id', v_venue_id,
      'club_name', trim(p_name),
      'sport', v_sport,
      'origin', 'self_serve',
      'verification_status', 'pending'
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'venue_created');

  -- Return the scoped ids only. NEVER the venue_admin_token.
  RETURN jsonb_build_object(
    'ok', true,
    'club_id', v_club_id,
    'venue_id', v_venue_id,
    'verification_status', 'pending',
    'origin', 'self_serve'
  );
END;
$function$;

-- Grants: authenticated-only. Strip PUBLIC and the auto-granted anon explicitly.
REVOKE ALL ON FUNCTION public.self_serve_create_club(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_create_club(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_create_club(text, text, text, text) TO authenticated;
