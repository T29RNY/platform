-- 274_member_checkin.sql
--
-- Phase 5 (continuation) — RECEPTION CHECK-IN.
-- A member's pass QR (mig 272) encodes their `/m/<pass_token>` URL. The reception
-- display scans it and calls `member_check_in(display_token, pass_token)`:
--   • resolves the display's venue from `venues.display_token`,
--   • resolves the membership from its `pass_token`,
--   • asserts the pass belongs to THIS venue (a pass from another venue is rejected),
--   • logs an attendance row (de-duped within a 4h window so a re-scan is idempotent),
--   • returns a greeting payload (name, tier, status, all-time visit count) so the
--     display can welcome the member by name.
--
-- Trust model: the display token is the venue's low-privilege public token (mig 164),
-- already on the TV URL and PIN-gated for staff. The write is anon-callable (the
-- display runs unauthenticated) but is bound to the display's own venue server-side —
-- a scanned pass can never check in against a venue it doesn't belong to. Audited
-- (Hard Rule #9) as actor_type 'system' (unattended kiosk).

-- 1. Attendance table — RLS-walled, definer-only (matches the mig 270/271 pattern).
CREATE TABLE IF NOT EXISTS public.venue_member_checkins (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      text        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  membership_id uuid        NOT NULL REFERENCES public.venue_memberships(id) ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.venue_customers(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  source        text        NOT NULL DEFAULT 'display_qr',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_member_checkins_by_venue
  ON public.venue_member_checkins (venue_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS venue_member_checkins_by_membership
  ON public.venue_member_checkins (membership_id, checked_in_at DESC);

ALTER TABLE public.venue_member_checkins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_member_checkins FROM anon, authenticated;

-- 2. member_check_in(display_token, pass_token) — anon-callable, venue-bound write.
CREATE OR REPLACE FUNCTION public.member_check_in(p_display_token text, p_pass_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_venue_id   text;
  v_m          record;
  v_recent     timestamptz;
  v_count      int;
  v_already    boolean := false;
BEGIN
  IF p_display_token IS NULL OR btrim(p_display_token) = '' THEN
    RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001';
  END IF;

  -- The scanned value may be the full pass URL (".../m/<token>") or the bare token.
  p_pass_token := regexp_replace(COALESCE(p_pass_token, ''), '^.*/m/', '');
  p_pass_token := split_part(p_pass_token, '?', 1);
  p_pass_token := btrim(p_pass_token);
  IF p_pass_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_token');
  END IF;

  SELECT id INTO v_venue_id FROM public.venues WHERE display_token = p_display_token LIMIT 1;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.id, m.venue_id, m.customer_id, m.status,
         c.first_name, c.last_name, t.name AS tier_name
    INTO v_m
    FROM public.venue_memberships m
    JOIN public.venue_customers c        ON c.id = m.customer_id
    JOIN public.venue_membership_tiers t ON t.id = m.tier_id
   WHERE m.pass_token = p_pass_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pass_not_found');
  END IF;

  IF v_m.venue_id <> v_venue_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_venue');
  END IF;
  IF v_m.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cancelled', 'first_name', v_m.first_name);
  END IF;

  -- De-dupe: a scan within the last 4h is the same physical visit (re-scan/double-tap).
  SELECT max(checked_in_at) INTO v_recent
    FROM public.venue_member_checkins
   WHERE membership_id = v_m.id AND checked_in_at > now() - interval '4 hours';
  IF v_recent IS NOT NULL THEN
    v_already := true;
  ELSE
    INSERT INTO public.venue_member_checkins (venue_id, membership_id, customer_id, source)
    VALUES (v_venue_id, v_m.id, v_m.customer_id, 'display_qr');
  END IF;

  SELECT count(*) INTO v_count
    FROM public.venue_member_checkins WHERE membership_id = v_m.id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, NULL, 'system', 'display_token:' || md5(p_display_token),
          'member_checkin', 'venue_membership', v_m.id::text,
          jsonb_build_object('via', 'display_qr', 'already_checked_in', v_already,
                             'status', v_m.status, 'visit_count', v_count));

  RETURN jsonb_build_object(
    'ok',                true,
    'first_name',        v_m.first_name,
    'last_name',         v_m.last_name,
    'tier_name',         v_m.tier_name,
    'status',            v_m.status,
    'frozen',            (v_m.status = 'paused'),
    'visit_count',       v_count,
    'already_checked_in', v_already
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_check_in(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_check_in(text,text) TO anon, authenticated;
