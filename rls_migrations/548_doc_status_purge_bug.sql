-- 548: doc-status readers — a retention-purged APPROVED proof-of-age must read "done",
-- not "due", for the coach + operator boards.
--
-- The retention flow (mig 431) deletes the ID *file* via the Storage API and stamps
-- `member_id_documents.purged_at`, KEEPING the `status='approved'` row (the verification
-- record). The guardian reader (mig 431) correctly shows such a member as done. But the coach
-- reader (mig 538/542) and the operator reader (mig 539) both looked up the ID status/detail
-- WHERE `d.purged_at IS NULL` — so once the file was purged they found no row → `CASE NULL …
-- ELSE 'due'`. Net effect: a fully-verified junior flipped to "proof of age due" on the coach
-- board and the operator SafeguardingBoard, inflating `with_outstanding` and the worst-first
-- sort — while the guardian's app correctly showed done. (Bug reproduced via EV: purged+approved
-- → coach reader returned 'due'.)
--
-- Fix: drop `AND d.purged_at IS NULL` from the ID *status* + *detail* lookups so the latest ID
-- doc by uploaded_at drives the status regardless of purge (approved→done, pending→submitted,
-- rejected/none→due — all still correct). The `purged_at` filter only ever belonged where the
-- FILE/storage_path is exposed; neither lookup returns storage_path (status flags + metadata
-- only), so no PII/file is surfaced. Aggregate status semantics otherwise byte-unchanged.
--
-- Consumers (Hard Rule #14): apps/inorout TeamManagerDocs.jsx (coach board) +
-- apps/venue SafeguardingBoard.jsx "Player documents" (operator).

-- ─── Coach reader (mig 538/542) — drop purged_at from the id status + detail lookups ───
CREATE OR REPLACE FUNCTION public.club_manager_get_team_doc_status(p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid; v_team_name text; v_club_id text; v_club_name text;
  v_id_mandate boolean; v_req_count int; v_members jsonb; v_total int; v_clear int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM club_team_managers WHERE team_id = p_team_id AND member_profile_id = v_profile_id AND is_active = true)
  THEN RAISE EXCEPTION 'not_manager' USING ERRCODE='P0001'; END IF;
  SELECT ct.name, ct.club_id INTO v_team_name, v_club_id FROM club_teams ct WHERE ct.id = p_team_id;
  IF v_team_name IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001'; END IF;
  SELECT c.name, COALESCE(c.id_mandate, false) INTO v_club_name, v_id_mandate FROM clubs c WHERE c.id = v_club_id;
  SELECT count(*)::int INTO v_req_count FROM policy_documents pd WHERE pd.club_id = v_club_id AND pd.is_current;

  WITH roster AS (
    SELECT cm.member_profile_id AS pid, NULLIF(btrim(mp.first_name || COALESCE(' ' || mp.last_name, '')), '') AS name
    FROM club_team_members cm JOIN member_profiles mp ON mp.id = cm.member_profile_id
    WHERE cm.team_id = p_team_id AND cm.is_active = true
  ),
  consents AS (
    SELECT r.pid, count(ca.id)::int AS signed
    FROM roster r
    LEFT JOIN policy_documents pd ON pd.club_id = v_club_id AND pd.is_current
    LEFT JOIN consent_acceptances ca ON ca.document_id = pd.id AND ca.member_profile_id = r.pid
    GROUP BY r.pid
  ),
  permbr AS (
    SELECT r.pid, r.name, LEAST(COALESCE(c.signed, 0), v_req_count) AS signed,
      (CASE WHEN v_req_count = 0 THEN 'na' WHEN COALESCE(c.signed,0) >= v_req_count THEN 'done' ELSE 'due' END) AS consent_status,
      (CASE WHEN NOT v_id_mandate THEN 'na'
            ELSE (CASE (SELECT d.status FROM member_id_documents d WHERE d.member_profile_id = r.pid AND d.club_id = v_club_id ORDER BY d.uploaded_at DESC LIMIT 1)
                    WHEN 'approved' THEN 'done' WHEN 'pending' THEN 'submitted' ELSE 'due' END) END) AS id_status,
      (CASE WHEN EXISTS (SELECT 1 FROM member_record_reviews rr WHERE rr.member_profile_id = r.pid AND rr.review_kind = 'medical' AND rr.reviewed_at > now() - interval '12 months') THEN 'done' ELSE 'due' END) AS medical_status
    FROM roster r LEFT JOIN consents c ON c.pid = r.pid
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'member_profile_id', p.pid, 'name', COALESCE(p.name, 'Member'),
      'consents', jsonb_build_object('signed', p.signed, 'required', v_req_count, 'status', p.consent_status,
        'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('title', pd.title, 'version', pd.version, 'signed', (ca.id IS NOT NULL), 'signed_at', ca.accepted_at) ORDER BY (ca.id IS NOT NULL), pd.title), '[]'::jsonb)
                  FROM policy_documents pd LEFT JOIN consent_acceptances ca ON ca.document_id = pd.id AND ca.member_profile_id = p.pid
                  WHERE pd.club_id = v_club_id AND pd.is_current)),
      'id', jsonb_build_object('status', p.id_status,
        'detail', (SELECT jsonb_build_object('document_type', d.document_type, 'status', d.status, 'uploaded_at', d.uploaded_at, 'verified_at', d.verified_at, 'rejection_reason', d.rejection_reason)
                   FROM member_id_documents d WHERE d.member_profile_id = p.pid AND d.club_id = v_club_id ORDER BY d.uploaded_at DESC LIMIT 1)),
      'medical', jsonb_build_object('status', p.medical_status,
        'reviewed_at', (SELECT max(rr.reviewed_at) FROM member_record_reviews rr WHERE rr.member_profile_id = p.pid AND rr.review_kind = 'medical')),
      'outstanding', ((p.consent_status = 'due')::int + (p.id_status = 'due')::int + (p.medical_status = 'due')::int),
      'all_clear', (p.consent_status IN ('done','na') AND p.id_status IN ('done','na') AND p.medical_status = 'done')
    ) ORDER BY
      ((p.consent_status = 'due')::int + (p.id_status = 'due')::int + (p.medical_status = 'due')::int) DESC,
      (p.consent_status IN ('done','na') AND p.id_status IN ('done','na') AND p.medical_status = 'done'), p.name), '[]'::jsonb),
    count(*)::int,
    count(*) FILTER (WHERE p.consent_status IN ('done','na') AND p.id_status IN ('done','na') AND p.medical_status = 'done')::int
  INTO v_members, v_total, v_clear FROM permbr p;

  RETURN jsonb_build_object('ok', true,
    'team', jsonb_build_object('team_id', p_team_id, 'name', v_team_name, 'club_id', v_club_id, 'club_name', v_club_name),
    'requirements', jsonb_build_object('consents_required', v_req_count, 'id_mandate', v_id_mandate),
    'summary', jsonb_build_object('members', v_total, 'all_clear', v_clear, 'with_outstanding', v_total - v_clear),
    'members', v_members);
END;
$function$;

-- ─── Operator reader (mig 539) — drop purged_at from the id status lookup ───
CREATE OR REPLACE FUNCTION public.venue_get_club_doc_status(p_venue_token text, p_club_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue_id text; v_linked boolean; v_club_name text; v_id_mandate boolean;
  v_req_count int; v_members jsonb; v_total int; v_clear int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
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
      (CASE WHEN v_req_count = 0 THEN 'na' WHEN COALESCE(c.signed,0) >= v_req_count THEN 'done' ELSE 'due' END) AS consent_status,
      (CASE WHEN NOT v_id_mandate THEN 'na'
            ELSE (CASE (SELECT d.status FROM member_id_documents d
                        WHERE d.member_profile_id = r.pid AND d.club_id = p_club_id
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
