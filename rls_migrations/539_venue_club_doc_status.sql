-- 539_venue_club_doc_status.sql — P10c: venue-token (admin/owner) per-member doc-status reader.
--
-- The venue-token twin of the coach reader club_manager_get_team_doc_status (mig 538): same
-- three compliance checks (consents / ID proof / medical review) aggregated per member, but
-- scoped to the whole CLUB's active membership (venue_memberships) and authed as a VENUE ADMIN
-- (resolve_venue_caller + manage_facility cap + club_venues scope), for the desktop venue
-- club-lens SafeguardingBoard. Owner/manager with manage_facility; a venue that doesn't own
-- the club → club_not_in_venue.
--
-- PRIVACY/DPIA (load-bearing): STATUS FLAGS ONLY — the medical snapshot + all special-category
-- member_profiles fields are NEVER selected; roster selects only name. (Less sensitive than what
-- the admin already sees in CustomerDetailModal.) STABLE SECDEF, search_path pinned, read-only.

CREATE OR REPLACE FUNCTION public.venue_get_club_doc_status(p_venue_token text, p_club_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_linked boolean;
  v_club_name text;
  v_id_mandate boolean;
  v_req_count int;
  v_members jsonb; v_total int; v_clear int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF p_club_id IS NULL THEN RAISE EXCEPTION 'club_id_required' USING ERRCODE='P0001'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.club_venues cv WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id) INTO v_linked;
  IF NOT v_linked THEN RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE='P0001'; END IF;

  SELECT c.name, COALESCE(c.id_mandate, false) INTO v_club_name, v_id_mandate FROM clubs c WHERE c.id = p_club_id;
  SELECT count(*)::int INTO v_req_count FROM policy_documents pd WHERE pd.club_id = p_club_id AND pd.is_current;

  WITH roster AS (
    SELECT DISTINCT vm.member_profile_id AS pid,
           NULLIF(btrim(mp.first_name || COALESCE(' ' || mp.last_name, '')), '') AS name
    FROM venue_memberships vm JOIN member_profiles mp ON mp.id = vm.member_profile_id
    WHERE vm.club_id = p_club_id AND vm.status IN ('active','paused','ending')
  ),
  consents AS (
    SELECT r.pid, count(ca.id)::int AS signed
    FROM roster r
    LEFT JOIN policy_documents pd ON pd.club_id = p_club_id AND pd.is_current
    LEFT JOIN consent_acceptances ca ON ca.document_id = pd.id AND ca.member_profile_id = r.pid
    GROUP BY r.pid
  ),
  permbr AS (
    SELECT r.pid, r.name,
      LEAST(COALESCE(c.signed, 0), v_req_count) AS signed,
      (CASE WHEN v_req_count = 0 THEN 'na'
            WHEN COALESCE(c.signed,0) >= v_req_count THEN 'done'
            ELSE 'due' END) AS consent_status,
      (CASE WHEN NOT v_id_mandate THEN 'na'
            ELSE (CASE (SELECT d.status FROM member_id_documents d
                        WHERE d.member_profile_id = r.pid AND d.club_id = p_club_id AND d.purged_at IS NULL
                        ORDER BY d.uploaded_at DESC LIMIT 1)
                    WHEN 'approved' THEN 'done' WHEN 'pending' THEN 'submitted' ELSE 'due' END) END) AS id_status,
      (CASE WHEN EXISTS (SELECT 1 FROM member_record_reviews rr
                         WHERE rr.member_profile_id = r.pid AND rr.review_kind = 'medical'
                           AND rr.reviewed_at > now() - interval '12 months')
            THEN 'done' ELSE 'due' END) AS medical_status
    FROM roster r LEFT JOIN consents c ON c.pid = r.pid
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'member_profile_id', p.pid, 'name', COALESCE(p.name, 'Member'),
      'consents', jsonb_build_object('signed', p.signed, 'required', v_req_count, 'status', p.consent_status),
      'id', jsonb_build_object('status', p.id_status),
      'medical', jsonb_build_object('status', p.medical_status),
      'outstanding', ((p.consent_status = 'due')::int + (p.id_status = 'due')::int + (p.medical_status = 'due')::int),
      'all_clear', (p.consent_status IN ('done','na') AND p.id_status IN ('done','na') AND p.medical_status = 'done')
    ) ORDER BY
      ((p.consent_status = 'due')::int + (p.id_status = 'due')::int + (p.medical_status = 'due')::int) DESC,
      (p.consent_status IN ('done','na') AND p.id_status IN ('done','na') AND p.medical_status = 'done'),
      p.name), '[]'::jsonb),
    count(*)::int,
    count(*) FILTER (WHERE p.consent_status IN ('done','na') AND p.id_status IN ('done','na') AND p.medical_status = 'done')::int
  INTO v_members, v_total, v_clear
  FROM permbr p;

  RETURN jsonb_build_object('ok', true,
    'club', jsonb_build_object('club_id', p_club_id, 'name', v_club_name),
    'requirements', jsonb_build_object('consents_required', v_req_count, 'id_mandate', v_id_mandate),
    'summary', jsonb_build_object('members', v_total, 'all_clear', v_clear, 'with_outstanding', v_total - v_clear),
    'members', v_members);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_get_club_doc_status(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_get_club_doc_status(text, text) TO anon, authenticated, service_role;
