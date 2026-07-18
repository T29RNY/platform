-- 596_club_leads_and_anon_trial_plumbing.sql
-- P3 of the DF Sports public enrol / free-trial epic (docs/epics/df-trial-booking.md).
--
-- SHIPS DARK ON MERGE. Be precise about what that does and does not mean (an adversarial
-- review refuted the loose version of this claim, so it is stated honestly here):
--   * MERGING is inert: no app code calls either RPC, and no CI applies migrations.
--   * APPLYING makes club_capture_lead a live, internet-reachable anon WRITE immediately —
--     PostgREST exposes every anon-granted function at /rest/v1/rpc/<name>, and the
--     publishable key ships in the client bundle by design. P4 is NOT required for reach.
--     "DF's page is published=false" gates nothing here: the gate is per-slug, and
--     pa-sports / finbars-fc / demo-boxing are published TODAY. Applying this accepts a
--     bounded anon write against those slugs.
--   * The READ is inert today only by DATA COINCIDENCE — no published club currently ticks
--     first_session_free + members_only=false. Those are operator checkboxes, not a gate.
--
-- WHAT THIS ADDS:
--   1. club_leads               — anon-write-only prospective-parent intake.
--   2. club_capture_lead        — anon RPC, the ONLY new anon write.
--   3. club_list_trial_sessions — anon read of trial-shaped sessions for a published club.
--
-- WHAT IS REUSED (no new RPC, deliberately):
--   S1 parent signup -> member_self_create_profile()   (authenticated)
--   S2 add child     -> member_register_child()        (authenticated; already takes p_dob,
--                       and already writes member_guardians invite_state='accepted', which is
--                       exactly what guardian_book_class_session's not_guardian gate needs)
--   S4 book trial    -> guardian_book_class_session()  (authenticated; ALREADY enforces mig
--                       588's _class_age_eligibility)
--   Epic decision #3 ("do not re-litigate") records that the flow performs "a public signup"
--   calling member_self_create_profile, so the parent is AUTHENTICATED before booking. An
--   anon booking RPC would be a THIRD copy of the booking body (340 -> 399 -> 429) with 588's
--   age guard re-implemented by hand — the copy-paste trap that already cost this epic two
--   silent no-ops. There is no anon booking RPC and there must not be.
--
-- club_list_trial_sessions is genuinely new (not a duplicate of
-- guardian_list_child_class_options): that one scopes sessions through
-- club_team_members -> club_teams -> club_leagues, so a TRIAL PROSPECT — who is in no team —
-- gets []. It cannot serve the very child this epic exists for.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. club_leads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           text NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  parent_name       text NOT NULL,
  parent_email      text NOT NULL,
  parent_phone      text,
  -- Optional: a parent may drop out at S1 before ever naming a child.
  child_first_name  text,
  -- DELIBERATELY the school year, NOT the child's date of birth. The dob is accepted by
  -- club_capture_lead (the P4 screen collects it to suggest a group) and immediately reduced
  -- via mig 588's _school_year_for_dob — it is never stored. Rationale: mig 588's age guard
  -- reads member_profiles.dob at booking time, NOT this row, so a dob here enforces nothing;
  -- it would be an exact, re-identifiable date about a child, typed by an unverified stranger
  -- who may have no relationship with that child. The school year is precisely what the club
  -- actually needs ("what year group is this child, so groups stay balanced") at a fraction of
  -- the sensitivity. When the parent converts, member_register_child captures the real dob
  -- under a real account. Reception = 0, pre-school negative (588's convention).
  child_school_year smallint,
  source            text NOT NULL DEFAULT 'public_trial',
  status            text NOT NULL DEFAULT 'new',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_leads_status_chk CHECK (status IN ('new','contacted','converted','closed'))
);

COMMENT ON TABLE public.club_leads IS
  'Anon-captured prospective-parent leads from the public club trial flow. WRITE-ONLY to anon '
  'via club_capture_lead. NEVER an identity source (epic decision #3): an unverified typed '
  'claim, deliberately carrying no link to any auth user or member_profile. Stores a child''s '
  'school year, never a date of birth. NOTE: no retention/purge rule exists yet — see the '
  'epic manifest''s open items before this carries real families'' data.';

-- Serves the per-email throttle probe in club_capture_lead.
CREATE INDEX IF NOT EXISTS club_leads_club_email_created_idx
  ON public.club_leads (club_id, lower(parent_email), created_at DESC);

ALTER TABLE public.club_leads ENABLE ROW LEVEL SECURITY;

-- No policies, by design: every access path is a SECURITY DEFINER RPC.
-- Revoke from the NAMED roles. Supabase's default privileges grant anon/authenticated
-- arwdDxtm on new postgres-owned public tables directly, so REVOKE ... FROM PUBLIC alone
-- would leave children's names readable over PostgREST. This is load-bearing, not belt-and-
-- braces — it was verified against pg_default_acl.
REVOKE ALL ON public.club_leads FROM PUBLIC;
REVOKE ALL ON public.club_leads FROM anon;
REVOKE ALL ON public.club_leads FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2. club_capture_lead — anon write-only intake
-- ---------------------------------------------------------------------------
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

  -- Deliberately no lead id and no echo of input: nothing for an anon caller to correlate.
  -- (Stricter than public_enquire_room_hire, which returns its hire_id.)
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_capture_lead(text, text, text, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_capture_lead(text, text, text, text, text, date)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. club_list_trial_sessions — anon read of trial-shaped sessions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_list_trial_sessions(p_slug text)
RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_club_id  text;
  v_sessions jsonb;
BEGIN
  SELECT cp.club_id INTO v_club_id
    FROM public.club_pages cp
   WHERE cp.slug = p_slug AND COALESCE(cp.published, false) = true;
  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- ⚠️ CLUB ATTRIBUTION. venue_class_types belongs to a VENUE, and club_venues is
  -- MANY-TO-MANY — a class type carries no club at all. So "this club's sessions" is not
  -- directly expressible. Scoping naively by the club's venues LEAKS ACROSS CLUBS: demo_venue
  -- is shared by finbars-fc, demo-boxing and demo-martial-arts, so a naive
  -- club_list_trial_sessions('finbars-fc') would advertise the boxing club's sessions as
  -- Finbar's. DF's venue happens to be DF-exclusive, which is precisely why that bug would
  -- have shipped unnoticed — and a shared school hall is the NORM in this domain.
  -- Until a class type can name its club, only a venue this club does NOT share is safely
  -- attributable. A shared venue therefore yields nothing rather than someone else's classes:
  -- an empty list is a visible, debuggable failure; another club's children's classes on your
  -- page is not. See the epic's open items — giving venue_class_types a club is the real fix.
  WITH club_exclusive_venues AS (
    SELECT cv.venue_id
      FROM public.club_venues cv
     WHERE cv.club_id = v_club_id
       AND NOT EXISTS (
         SELECT 1 FROM public.club_venues cv2
          WHERE cv2.venue_id = cv.venue_id AND cv2.club_id <> v_club_id)
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'starts_at')), '[]'::jsonb)
    INTO v_sessions
    FROM (
      SELECT jsonb_build_object(
        'session_id',      s.id,
        'class_type_id',   ctp.id,
        'class_name',      ctp.name,
        'description',     ctp.description,
        'starts_at',       s.starts_at,
        'ends_at',         s.ends_at,
        -- The band, so the client can suggest/filter. mig 588's guard is the ENFORCER at
        -- booking time; this is presentation only and is never trusted for admission.
        'school_year_min', ctp.school_year_min,
        'school_year_max', ctp.school_year_max,
        'min_age',         ctp.min_age,
        'max_age',         ctp.max_age,
        'capacity',        s.capacity,
        'spots_left',      GREATEST(s.capacity - (
                             SELECT count(*) FROM public.venue_class_bookings b
                              WHERE b.session_id = s.id
                                AND (b.status = 'confirmed'
                                     OR (b.status = 'offered' AND b.offer_expires_at > now()))
                           ), 0)
      ) AS x
      FROM public.venue_class_sessions s
      JOIN public.venue_class_types ctp ON ctp.id = s.class_type_id
      WHERE s.venue_id IN (SELECT venue_id FROM club_exclusive_venues)
        AND s.status = 'scheduled'
        AND s.starts_at > now()
        -- Bound the anon-readable payload. DF alone has 107 future sessions (a whole academic
        -- year); a trial prospect is choosing a session to come and try, not browsing a year.
        AND s.starts_at < now() + INTERVAL '8 weeks'
        AND COALESCE(ctp.is_active, true) = true
        -- Trial-shaped only: free first session, open to non-members, not aimed at one team.
        AND COALESCE(ctp.first_session_free, false) = true
        AND COALESCE(ctp.members_only, true) = false
        AND COALESCE(ctp.audience, 'all') = 'all'
        -- A camp is block-booked (booking_mode='block') and carries pickup/dietary/date-range
        -- semantics this payload does not express. Listing its days as independent "trials"
        -- would let a parent book one day of a block. Camps are not trials.
        AND COALESCE(ctp.is_camp, false) = false
        -- Match guardian_book_class_session's own gate, or we would advertise sessions that
        -- throw feature_disabled on booking.
        AND public._venue_club_feature_enabled(s.venue_id, 'coaching')
      ORDER BY s.starts_at
      LIMIT 60
    ) q;

  -- No instructor identity and no booker PII: a public, anon-readable payload.
  RETURN jsonb_build_object('found', true, 'sessions', v_sessions);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_list_trial_sessions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list_trial_sessions(text) TO anon, authenticated;

COMMIT;
