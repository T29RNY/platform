-- 620_venue_live_on_signup.sql
--
-- Venue Setup Wizard W5, revised: a self-serve venue goes PUBLICLY LIVE the moment
-- signup completes — no "finalize" step, no requirement to add pitches / classes /
-- other setup fields first (operator decision 2026-07-24). This removes the mig-488
-- friction where a self-serve venue was created `pending` and only flipped to
-- `verified` (and thus into search_bookable_venues) after the owner added ≥1 pitch and
-- tapped go-live.
--
-- Change is limited to self_serve_create_venue (CREATE OR REPLACE), two lines of intent:
--   1. Create the venue `verified` (was `pending`) → live + listed on signup.
--   2. Re-base the anti-abuse cap: it counted `pending` self-serve venues per owner
--      (which now would always be 0 → cap never fires). Count non-`rejected` self-serve
--      venues instead, so the ≤3-per-owner limit still holds.
--
-- Everything else (mig 488) stays and stays useful: search_bookable_venues still
-- enforces `verified` + not-`rejected`, the superadmin `rejected` takedown override
-- still works, superadmin_list_venues is still the new-signup alert. venue_finalize_setup
-- becomes a harmless no-op for new venues (it already returns "already verified").
--
-- NOTE: the 1 existing `pending` self-serve venue (v_ffff5528a0 "DF Sports Coaching")
-- is deliberately NOT flipped here — it is a live pilot (a coaching academy with no
-- pitches) and whether it belongs in bookable-venues search is an operator call. Flip
-- it manually if wanted:  UPDATE public.venues SET verification_status='verified'
-- WHERE id='v_ffff5528a0' AND verification_status='pending';

CREATE OR REPLACE FUNCTION public.self_serve_create_venue(
  p_name          text,
  p_contact_email text,
  p_sport         text DEFAULT 'football'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_email       text;
  v_sport       text;
  v_venue_id    text;
  v_owned_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

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

  -- Anti-abuse cap: ≤3 self-serve venues per owner. Count non-rejected self-serve
  -- venues (venues are now `verified` at birth, so the old `= 'pending'` predicate
  -- would count 0 and never fire).
  SELECT count(*) INTO v_owned_count
  FROM public.venue_admins va
  JOIN public.venues v ON v.id = va.venue_id
  WHERE va.user_id = v_uid
    AND va.role = 'owner'
    AND v.origin = 'self_serve'
    AND v.verification_status <> 'rejected'
    AND v.is_personal_host = false;
  IF v_owned_count >= 3 THEN
    RAISE EXCEPTION 'self_serve_venue_cap_reached' USING ERRCODE = 'P0001';
  END IF;

  v_venue_id := 'v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  -- Live on signup: `verified` (was `pending`) → immediately public + bookable-listed.
  INSERT INTO public.venues (
    id, name, sport, contact_email, active,
    subscription_status, verification_status, origin, created_by_user
  )
  VALUES (
    v_venue_id, trim(p_name), v_sport, v_email, true,
    'trial', 'verified', 'self_serve', v_uid
  );

  INSERT INTO public.venue_admins (
    venue_id, user_id, email, role, status, granted_by, granted_at
  )
  VALUES (
    v_venue_id, v_uid, v_email, 'owner', 'active', v_uid, now()
  );

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
      'verification_status', 'verified'
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'venue_created');

  RETURN jsonb_build_object(
    'ok', true,
    'venue_id', v_venue_id,
    'verification_status', 'verified',
    'origin', 'self_serve'
  );
END;
$function$;
