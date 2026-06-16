-- 343_class_qr_checkin.sql
--
-- Classes Booking + Room Hire — Phase 6: QR check-in.
--
-- An instructor (or venue manager) scans a member's pass QR as they arrive at a
-- class session. The pass QR encodes the member's `/m/<pass_token>` URL — the same
-- token the reception display already scans (mig 274). Here we resolve that token
-- to the member's profile and stamp their booking for THIS session as attended.
--
-- Resolution bridge: the pass `pass_token` lives on `venue_memberships`, which also
-- carries `member_profile_id` + `venue_id`. Class bookings key on
-- `member_profiles.id`. So: scanned URL → bare token → `venue_memberships` row →
-- `member_profile_id` → `venue_class_bookings(session_id, member_profile_id)`.
--
-- Closes the mig-339 Phase-6 consumer contract (Hard Rule #14): this RPC stamps
-- `venue_class_bookings.checked_in_at`, which `venue_mark_class_completed`'s no-show
-- probe already keys on (`AND b.checked_in_at IS NULL`). The column is forward-
-- referenced there via an `information_schema` probe and is added here additively —
-- the no-show flip begins excluding checked-in attendees the instant this lands.
--
-- Decisions (documented in RPCS.md / memory):
--   • Attendance is BOOKING-ROW-ONLY — we stamp `checked_in_at`, we do NOT also
--     write `venue_member_checkins` (that table is reception arrival, customer-
--     scoped, 4h-deduped; conflating would double-count). The booking row IS the
--     no-show contract.
--   • A scanned member is ground-truth present: any non-cancelled booking
--     (confirmed / waitlist / offered) is promoted to 'confirmed' and stamped.
--     Capacity is not re-checked (the instructor admitted them) and NO charge is
--     created or changed (door payment is physical; prepay was charged at booking —
--     mirrors reception check-in, which also never charges).
--   • Gating: the session's assigned instructor OR a venue manager
--     (`_venue_has_cap(..., 'manage_facility')` — owner/manager auto-true, or a
--     staff member explicitly granted the cap), OR a platform admin.
--   • Graceful {ok:false,reason} per-scan (mirrors mig 274 greet()): no_token,
--     pass_not_found, wrong_venue, not_booked, booking_cancelled; {ok:true,
--     already_checked_in} on re-scan. RAISE for operator/authz errors:
--     invalid_venue_token, session_not_found, session_cancelled, session_completed,
--     not_instructor.
-- Audited per Hard Rule #9.

-- ── 1. checked_in_at column (additive; activates the mig-339 no-show probe) ───

ALTER TABLE public.venue_class_bookings
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

-- ── 2. venue_class_checkin(token, session_id, pass_token) ────────────────────

CREATE OR REPLACE FUNCTION public.venue_class_checkin(
  p_venue_token text,
  p_session_id  uuid,
  p_pass_token  text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller     record;
  v_sess       public.venue_class_sessions;
  v_is_manager boolean;
  v_admin_id   uuid;
  v_token      text;
  v_mp_id      uuid;
  v_mp_venue   text;
  v_member_nm  text;
  v_bk         public.venue_class_bookings;
  v_promoted   boolean := false;
BEGIN
  -- caller
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  -- session (must belong to caller's venue, must be live)
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_sess.status = 'cancelled' THEN RAISE EXCEPTION 'session_cancelled' USING ERRCODE='P0001'; END IF;
  IF v_sess.status = 'completed' THEN RAISE EXCEPTION 'session_completed' USING ERRCODE='P0001'; END IF;

  -- gate: manager (or platform admin) OR the session's assigned instructor
  v_is_manager := v_caller.actor_type = 'platform_admin'
               OR public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility');
  IF NOT v_is_manager THEN
    SELECT id INTO v_admin_id
      FROM public.venue_admins
     WHERE user_id = auth.uid() AND venue_id = v_caller.venue_id
       AND status = 'active' AND revoked_at IS NULL
     LIMIT 1;
    IF v_admin_id IS NULL OR v_admin_id <> v_sess.instructor_id THEN
      RAISE EXCEPTION 'not_instructor' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- normalise the scanned value: full pass URL (".../m/<token>?…") or bare token
  v_token := regexp_replace(COALESCE(p_pass_token, ''), '^.*/m/', '');
  v_token := split_part(v_token, '?', 1);
  v_token := btrim(v_token);
  IF v_token = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_token'); END IF;

  -- resolve the member via the membership pass token
  SELECT member_profile_id, venue_id INTO v_mp_id, v_mp_venue
    FROM public.venue_memberships WHERE pass_token = v_token LIMIT 1;
  IF v_mp_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'pass_not_found'); END IF;
  IF v_mp_venue <> v_caller.venue_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_venue'); END IF;

  SELECT btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) INTO v_member_nm
    FROM public.member_profiles WHERE id = v_mp_id;

  -- find this member's booking for the session
  SELECT * INTO v_bk FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_mp_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_booked', 'member_name', v_member_nm);
  END IF;
  IF v_bk.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_cancelled', 'member_name', v_member_nm);
  END IF;
  IF v_bk.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_checked_in', true,
                              'member_name', v_member_nm, 'status', v_bk.status);
  END IF;

  v_promoted := v_bk.status <> 'confirmed';  -- waitlist / offered / no_show → promoting to attended

  UPDATE public.venue_class_bookings
     SET status = 'confirmed', checked_in_at = now(),
         waitlist_position = NULL, offer_expires_at = NULL
   WHERE id = v_bk.id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_checkin', 'venue_class_booking', v_bk.id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'session_id', p_session_id::text,
                             'member_profile_id', v_mp_id::text, 'promoted', v_promoted, 'via', 'qr'));

  RETURN jsonb_build_object('ok', true, 'already_checked_in', false,
                            'member_name', v_member_nm, 'status', 'confirmed', 'promoted', v_promoted);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_class_checkin(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_class_checkin(text,uuid,text) TO anon, authenticated;
