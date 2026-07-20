-- 612_club_capture_lead_owner_email.sql
-- P5 fast-follow for the DF Sports public trial epic (docs/epics/df-trial-booking.md).
--
-- THE GAP THIS CLOSES. mig 596 made club_capture_lead write a club_leads row + an
-- audit_events row, but told nobody. mig 609 gave the club OWNER a screen to READ leads
-- (the Enquiries tab), but nothing PROMPTS them to look — a parent drops out at S1, the row
-- lands, and Danny only finds it if he happens to open the tab. This adds the missing nudge:
-- when a lead is captured, queue an EMAIL to the club's contact so the owner learns of it,
-- exactly as public_enquire_room_hire (mig 342) queues the venue an enquiry email.
--
-- REUSES THE public_enquire_room_hire IDIOM (mig 342) — with one deliberate correctness
-- deviation, called out because it contradicts the literal brief ("channel='email'"):
--   * The idiom is QUEUE-AND-DRAIN: the RPC inserts an UNSENT notification_log row and
--     apps/inorout/api/cron.js drains it (sends via Resend, then stamps channel='email' +
--     sent_at). So the DELIVERED channel is email, but the row is inserted channel=NULL.
--   * ⚠️ notification_log.sent_at DEFAULTS to now(). The drain selects rows with
--     `sent_at IS NULL AND channel IS NULL`. So a queued row MUST set sent_at = NULL
--     EXPLICITLY or it is born already-"sent" and never drains. (Verified live: 0 of 238
--     rows have sent_at NULL — the mig-342/339 inserts omit sent_at and so never drain;
--     that pre-existing room-hire/class latent bug is filed separately, NOT fixed here.)
--     This RPC sets sent_at = NULL and channel = NULL explicitly so its row actually drains.
--
-- PRIVACY (epic decision #3, DPIA 2026-07-15). notification_log is far more widely readable
-- than club_leads. The queued_payload therefore carries the CLUB NAME ONLY — no child name,
-- no school year, no parent name/email/phone. The email is a bare nudge ("you have a new
-- trial enquiry — open People -> Enquiries"); the owner reads the actual detail through the
-- RLS-scoped club_list_leads (mig 609), never through this row. entity_id is the lead uuid
-- (an opaque key for per-lead drain dedup), which is not PII.
--
-- The recipient is clubs.contact_email. A club with no contact_email queues nothing (the
-- INSERT ... SELECT yields no row) — same shape as the room-hire guard.
--
-- SIGNATURE UNCHANGED (6 args, same types) => CREATE OR REPLACE with no DROP, no new
-- overload, and the existing anon/authenticated grants are preserved (re-asserted below for
-- idempotence). Return shape unchanged ({ok:true}) => no JS wrapper / consumer change.

BEGIN;

CREATE OR REPLACE FUNCTION public.club_capture_lead(
  p_slug             text,
  p_parent_name      text,
  p_parent_email     text,
  p_parent_phone     text DEFAULT NULL,
  p_child_first_name text DEFAULT NULL,
  p_child_dob        date DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_club_id      text;
  v_recent_email int;
  v_lead_id      uuid;
  v_school_year  smallint;
  v_name         text := btrim(COALESCE(p_parent_name, ''));
  v_email        text := btrim(COALESCE(p_parent_email, ''));
  v_child        text := NULLIF(btrim(COALESCE(p_child_first_name, '')), '');
  v_phone        text := NULLIF(btrim(COALESCE(p_parent_phone, '')), '');
BEGIN
  -- Published gate. Same non-enumerating shape as get_club_public: an unknown slug and an
  -- unpublished club are indistinguishable to the caller.
  SELECT cp.club_id INTO v_club_id
    FROM public.club_pages cp
   WHERE cp.slug = p_slug AND COALESCE(cp.published, false) = true;
  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Validation (public_enquire_room_hire idiom).
  IF length(v_name) = 0 THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_email) = 0 OR position('@' IN v_email) = 0 OR length(v_email) > 160 THEN
    RAISE EXCEPTION 'bad_email' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_name) > 120
     OR (v_phone IS NOT NULL AND length(v_phone) > 40)
     OR (v_child IS NOT NULL AND length(v_child) > 120) THEN
    RAISE EXCEPTION 'input_too_long' USING ERRCODE = 'P0001';
  END IF;
  IF p_child_dob IS NOT NULL
     AND (p_child_dob > current_date OR p_child_dob < current_date - INTERVAL '25 years') THEN
    RAISE EXCEPTION 'bad_dob' USING ERRCODE = 'P0001';
  END IF;

  -- Reduce the dob to a school year IMMEDIATELY and never store the dob itself.
  -- Reuses mig 588's 31-Aug-cutoff resolver, so a lead is grouped by the same rule the
  -- booking guard and the register use.
  IF p_child_dob IS NOT NULL THEN
    v_school_year := public._school_year_for_dob(p_child_dob, current_date)::smallint;
  END IF;

  -- Abuse throttle (per email): at most 3 leads for this club from this email in 10 minutes.
  -- This stops a double-tap / accidental resubmit. It does NOT stop a determined attacker —
  -- the email is attacker-supplied and trivially rotated.
  --
  -- ⚠️ THERE IS DELIBERATELY NO PER-CLUB CAP. An earlier draft rejected on "60 leads per club
  -- per hour" as the real anti-flood control. Two independent security reviews refuted it: a
  -- cap on a bucket the attacker SHARES with the victim is a denial-of-service primitive, not
  -- a defence. 60 anon requests with rotating emails would have made every genuine parent get
  -- too_many_requests for the rest of the hour — silently (no one can read audit_events for a
  -- club_id: audit_events' only SELECT policy joins team_admins, which has no club rows), and
  -- indefinitely for ~1,440 requests/day. That suppresses the exact thing this feature exists
  -- to collect, and it is invisible. Pollution, by contrast, is visible and cleanable.
  -- In-DB per-IP throttling is NOT the answer either: the only IP available is
  -- request.headers -> x-forwarded-for, whose client-side entry is attacker-spoofable (and no
  -- RPC in this codebase reads request.headers today). Flood control for an anon endpoint
  -- belongs at the edge (platform rate-limit / WAF) or as a captcha on the P4 screen. That is
  -- filed as an open item on the epic and MUST be settled before the CTA goes live in P5.
  SELECT count(*) INTO v_recent_email
    FROM public.club_leads
   WHERE club_id = v_club_id
     AND lower(parent_email) = lower(v_email)
     AND created_at > now() - INTERVAL '10 minutes';
  IF v_recent_email >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_requests');
  END IF;

  INSERT INTO public.club_leads
    (club_id, parent_name, parent_email, parent_phone, child_first_name, child_school_year, source)
  VALUES
    (v_club_id, v_name, v_email, v_phone, v_child, v_school_year, 'public_trial')
  RETURNING id INTO v_lead_id;

  -- Hard Rule 9: a fire-and-forget write leaves a server-side trace.
  -- metadata deliberately carries NO child name/school year — audit_events is far more widely
  -- readable than club_leads, and a lead's child PII must not leak sideways through it.
  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES
    (v_club_id, NULL, 'system', 'public_trial', 'club_lead_captured', 'club_lead', v_lead_id::text,
     jsonb_build_object('slug', p_slug, 'email', v_email, 'has_child_details', v_child IS NOT NULL));

  -- NEW (mig 612): queue an owner email-on-lead, public_enquire_room_hire idiom.
  -- Queue-and-drain: cron.js clubLeadNotificationsJob drains rows with
  -- channel IS NULL AND sent_at IS NULL AND queued_for <= now(), sends via Resend, then
  -- stamps channel='email' + sent_at. sent_at IS SET TO NULL EXPLICITLY here — the column
  -- defaults to now(), and a row born with sent_at set never drains (see the header note).
  -- Payload is the CLUB NAME ONLY: no child PII, no parent PII — notification_log is broadly
  -- readable, and the owner reads real detail via club_list_leads (mig 609), not this row.
  -- A club with no contact_email queues nothing (the SELECT yields no row).
  INSERT INTO public.notification_log
    (team_id, player_id, type, entity_id, recipient, channel, sent_at, queued_for, queued_payload)
  SELECT v_club_id, NULL, 'club_lead_captured', v_lead_id::text, btrim(c.contact_email),
         NULL, NULL, now(),
         jsonb_build_object('club_name', c.name)
    FROM public.clubs c
   WHERE c.id = v_club_id
     AND btrim(COALESCE(c.contact_email, '')) <> '';

  -- Deliberately no lead id and no echo of input: nothing for an anon caller to correlate.
  -- (Stricter than public_enquire_room_hire, which returns its hire_id.)
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_capture_lead(text, text, text, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_capture_lead(text, text, text, text, text, date)
  TO anon, authenticated;

-- Refresh PostgREST's function-signature cache.
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
