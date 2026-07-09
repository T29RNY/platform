-- 521_venue_list_club_committee.sql
--
-- Club Console Consolidation — PR #6b follow-up: the venue-token committee reader.
--
-- THE GAP: club_list_committee (mig 449) authorises via auth.uid() ->
-- member_profiles -> club_team_managers (the COACH identity). A club admin on the
-- native /hub signs in on the VENUE-TOKEN path (a venue_admins row, not a coach
-- row), so they can't call it — the club-admin People screen therefore omits the
-- committee "who's who". This is the missing venue-token twin.
--
-- THE FIX: venue_list_club_committee(p_token, p_club_id) — a read-only reader that
-- authorises EXACTLY like venue_list_club_staff (mig 305): resolve_venue_caller ->
-- confirm the club is linked to the caller's venue via club_venues -> return the
-- club_committee rows. Same auth surface as every other club-admin console read;
-- exposes no new data (committee name/role/email is already public via
-- get_club_public and editable on the desktop console).
--
-- SECURITY: SECURITY DEFINER, search_path pinned, single overload, venue-token is
-- the credential (resolve_venue_caller validates it), REVOKE FROM PUBLIC then GRANT
-- to anon+authenticated — identical to venue_list_club_staff. Read-only (no writes,
-- no audit_events needed).

CREATE OR REPLACE FUNCTION public.venue_list_club_committee(
  p_token   text,
  p_club_id text
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  -- Confirm the club is linked to this caller's venue (same gate as club-staff).
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'committee_id',  cc.id,
        'role',          cc.role,
        'name',          cc.name,
        'email',         cc.email,
        'is_welfare',    cc.is_welfare,
        'display_order', cc.display_order
      ) ORDER BY cc.display_order, cc.role, cc.name
    )
    FROM public.club_committee cc
    WHERE cc.club_id = p_club_id
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_list_club_committee(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_list_club_committee(text, text) TO anon, authenticated;
