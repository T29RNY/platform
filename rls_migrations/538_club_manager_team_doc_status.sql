-- 538_club_manager_team_doc_status.sql — P10a: coach/manager per-player doc-status reader.
--
-- A coach (club_team_manager) needs to see, for their squad, WHO has outstanding compliance
-- docs — the same three checks the guardian /hub Documents screen computes for one child
-- (mig 431), aggregated per active team member:
--   • consents  — of the club's CURRENT policy_documents, how many has the member accepted
--                 (consent_acceptances); status done|due|na (na = the club has no policies).
--   • id proof  — for an id_mandate club, the member's latest member_id_documents status:
--                 approved→done, pending→submitted (awaiting admin verification), rejected/none→due;
--                 na when the club doesn't mandate ID.
--   • medical   — latest member_record_reviews(kind='medical') within 12 months → done else due.
--
-- PRIVACY / DPIA (load-bearing): this returns STATUS FLAGS ONLY — never the medical content
-- (allergies/conditions/medication/emergency contacts). The coach sees COMPLETENESS, not
-- special-category data; the medical detail stays guardian-only (mig 431). Full member NAMES
-- are coach-facing-internal (same as club_manager_get_team_ratings_table, mig 517), NOT the
-- anonymised public page.
--
-- AUTH: auth.uid → member_profiles → club_team_managers(is_active) for p_team_id (mig-517
-- pattern verbatim). not_authenticated / not_authorised / not_manager / team_not_found.
-- STABLE SECDEF, search_path pinned, authenticated-only (anon REVOKEd — coach-facing). Read-only.

CREATE OR REPLACE FUNCTION public.club_manager_get_team_doc_status(p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_team_name text;
  v_club_id text;
  v_club_name text;
  v_id_mandate boolean;
  v_req_count int;
  v_members jsonb;
  v_total int;
  v_clear int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM club_team_managers
      WHERE team_id = p_team_id AND member_profile_id = v_profile_id AND is_active = true)
  THEN RAISE EXCEPTION 'not_manager' USING ERRCODE='P0001'; END IF;
  SELECT ct.name, ct.club_id INTO v_team_name, v_club_id FROM club_teams ct WHERE ct.id = p_team_id;
  IF v_team_name IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001'; END IF;
  SELECT c.name, COALESCE(c.id_mandate, false) INTO v_club_name, v_id_mandate FROM clubs c WHERE c.id = v_club_id;
  SELECT count(*)::int INTO v_req_count FROM policy_documents pd WHERE pd.club_id = v_club_id AND pd.is_current;

  WITH roster AS (
    SELECT cm.member_profile_id AS pid,
           NULLIF(btrim(mp.first_name || COALESCE(' ' || mp.last_name, '')), '') AS name
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
    SELECT
      r.pid, r.name,
      LEAST(COALESCE(c.signed, 0), v_req_count) AS signed,
      -- consent status
      (CASE WHEN v_req_count = 0 THEN 'na'
            WHEN COALESCE(c.signed,0) >= v_req_count THEN 'done'
            ELSE 'due' END) AS consent_status,
      -- id status (latest non-purged doc for this club)
      (CASE WHEN NOT v_id_mandate THEN 'na'
            ELSE (CASE (SELECT d.status FROM member_id_documents d
                        WHERE d.member_profile_id = r.pid AND d.club_id = v_club_id AND d.purged_at IS NULL
                        ORDER BY d.uploaded_at DESC LIMIT 1)
                    WHEN 'approved' THEN 'done'
                    WHEN 'pending'  THEN 'submitted'
                    ELSE 'due' END) END) AS id_status,
      -- medical review status (latest, within 12 months)
      (CASE WHEN EXISTS (SELECT 1 FROM member_record_reviews rr
                         WHERE rr.member_profile_id = r.pid AND rr.review_kind = 'medical'
                           AND rr.reviewed_at > now() - interval '12 months')
            THEN 'done' ELSE 'due' END) AS medical_status
    FROM roster r LEFT JOIN consents c ON c.pid = r.pid
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'member_profile_id', p.pid,
      'name', COALESCE(p.name, 'Member'),
      'consents', jsonb_build_object('signed', p.signed, 'required', v_req_count, 'status', p.consent_status),
      'id', jsonb_build_object('status', p.id_status),
      'medical', jsonb_build_object('status', p.medical_status),
      -- family-action-needed count (a 'submitted' ID is awaiting admin, not counted here)
      'outstanding', ((p.consent_status = 'due')::int + (p.id_status = 'due')::int + (p.medical_status = 'due')::int),
      -- fully compliant: nothing due AND nothing awaiting verification
      'all_clear', (p.consent_status IN ('done','na') AND p.id_status IN ('done','na') AND p.medical_status = 'done')
    ) ORDER BY
      -- worst-first: most family-outstanding, then not-clear, then name
      ((p.consent_status = 'due')::int + (p.id_status = 'due')::int + (p.medical_status = 'due')::int) DESC,
      (p.consent_status IN ('done','na') AND p.id_status IN ('done','na') AND p.medical_status = 'done'),
      p.name), '[]'::jsonb),
    count(*)::int,
    count(*) FILTER (WHERE p.consent_status IN ('done','na') AND p.id_status IN ('done','na') AND p.medical_status = 'done')::int
  INTO v_members, v_total, v_clear
  FROM permbr p;

  RETURN jsonb_build_object('ok', true,
    'team', jsonb_build_object('team_id', p_team_id, 'name', v_team_name, 'club_id', v_club_id, 'club_name', v_club_name),
    'requirements', jsonb_build_object('consents_required', v_req_count, 'id_mandate', v_id_mandate),
    'summary', jsonb_build_object('members', v_total, 'all_clear', v_clear, 'with_outstanding', v_total - v_clear),
    'members', v_members);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_manager_get_team_doc_status(uuid) FROM public;
REVOKE ALL ON FUNCTION public.club_manager_get_team_doc_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_manager_get_team_doc_status(uuid) TO authenticated;
