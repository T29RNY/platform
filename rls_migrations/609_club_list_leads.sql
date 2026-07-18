-- 609_club_list_leads.sql
-- P5 of the DF trial-booking epic (docs/epics/df-trial-booking.md).
--
-- The OWNER-facing READ surface for the trial enquiries captured by club_capture_lead
-- (mig 596). Decision 2026-07-18: the club OWNER reads leads. Without this RPC a captured
-- lead lands in club_leads with no way for anyone to see it — the exact blocker P3 flagged
-- ("a parent drops out at S1, the row lands, Danny is never told and has no screen to look
-- at"). This closes it: the mobile operator People screen gets a "Trial enquiries" tab that
-- reads through this function.
--
-- Auth idiom copied verbatim from venue_get_club_page / venue_list_all_members
-- (mig 515 / 603): resolve_venue_caller(p_venue_token) → require a venue → require the
-- manage_memberships cap (leads are family PII — parent contact + a child's first name and
-- school year — so they take the same cap that gates member PII in venue_list_all_members) →
-- scope to clubs LINKED to the caller's venue via club_venues (the exact club-scoping
-- venue_list_all_members uses on this same screen). Token-only, like venue_list_all_members:
-- the mobile OperatorPeople screen passes its venueId as the token, and an auth'd venue_admin
-- resolves via resolve_venue_caller's auth.uid() path.
--
-- club_leads is RLS-on-with-no-policies and has DML revoked from anon+authenticated (mig 596),
-- so this MUST be SECURITY DEFINER. It is READ-ONLY (no writes, no audit row needed).

BEGIN;

CREATE OR REPLACE FUNCTION public.club_list_leads(p_venue_token text)
RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_leads    jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  -- Family PII → same cap that unlocks member PII in venue_list_all_members.
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id',                l.id,
             'club_id',           l.club_id,
             'parent_name',       l.parent_name,
             'parent_email',      l.parent_email,
             'parent_phone',      l.parent_phone,
             'child_first_name',  l.child_first_name,
             'child_school_year', l.child_school_year,
             'status',            l.status,
             'source',            l.source,
             'created_at',        l.created_at
           ) ORDER BY l.created_at DESC
         ), '[]'::jsonb)
    INTO v_leads
    FROM public.club_leads l
   WHERE l.club_id IN (
           SELECT cv.club_id FROM public.club_venues cv WHERE cv.venue_id = v_venue_id
         );

  RETURN jsonb_build_object('ok', true, 'leads', v_leads);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_list_leads(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list_leads(text) TO anon, authenticated;

COMMIT;
