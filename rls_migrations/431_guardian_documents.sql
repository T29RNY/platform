-- 431 — Guardian Documents (Phase 1 screen 4): per-child consent / ID / review manifest
--
-- WHY: The Guardian Documents screen (apps/inorout /hub, GuardianDocs.jsx) shows a
-- per-CHILD requirement list — sign (consent), upload (proof-of-age ID), review (confirm
-- medical / emergency contact) — each row done/due, opening a sheet to complete it.
-- Everything lands in the SAME tables the laptop venue dashboard already reads
-- (policy_documents / consent_acceptances / member_id_documents) — no parallel system.
--
-- WHAT ALREADY EXISTS (reused, NOT rebuilt):
--   • SIGN  — member_accept_consent(doc, sig, on_behalf_of, ip, ua) ALREADY supports
--             parent-signs-for-child (member_guardians gate + signed_on_behalf_of).
--   • UPLOAD — member_id_documents + private member-id-docs bucket + venue_verify_id_document.
--
-- GAPS this migration fills:
--   1. member_record_reviews          — new table: an auditable "I confirmed this record is
--                                        current" per child, per kind (repeatable each season,
--                                        which consent_acceptances' UNIQUE(doc,member) blocks).
--   2. member_id_documents.purged_at  — new column: retention marker (set once the ID file is
--                                        removed via the Storage API).
--   3. venue_verify_id_document       — MODIFIED: returns storage_path (additive) so the
--                                        verifier client can remove the file via the Storage
--                                        API. NB direct DELETE FROM storage.objects is blocked
--                                        by Supabase's protect_objects_delete trigger — file
--                                        removal MUST go through the Storage API, not SQL.
--   4. guardian_submit_id_document    — new write: parent uploads a child's proof-of-age.
--                                        member_submit_id_document is self-only; this is the
--                                        guardian-gated mirror. Path under the GUARDIAN's own
--                                        profile prefix (existing storage INSERT RLS allows it);
--                                        row's member_profile_id = the CHILD.
--   5. guardian_confirm_record_review — new write: records the medical/contact confirmation.
--   6. guardian_purge_id_document     — new write: stamps purged_at after the owner removes the
--                                        ID file via the Storage API (retention completion).
--   7. storage policy member_id_docs_delete — lets a member/guardian remove their own-prefix
--                                        ID objects via the Storage API.
--   8. guardian_list_child_documents  — new read: the unified manifest (sign + upload + review)
--                                        for one child, with the medical snapshot inlined and
--                                        upload rows carrying storage_path/purged so the screen
--                                        self-heals (removes verified files + stamps purged_at).
--
-- RETENTION (operator-confirmed: e-sign kept, uploaded ID deleted after verification):
--   The verify RPC cannot delete the file in SQL (protect_objects_delete trigger). Instead the
--   verifier/owner client removes it via the Storage API; the Documents screen self-heals on
--   load — any verified proof-of-age still holding a file is removed + purged_at stamped.
--
-- SECURITY: every guardian path gates on member_guardians(invite_state='accepted'),
-- mirroring migs 426/428/429. audit_events.actor_type uses 'player' (the value the sibling
-- guardian RPC mig 429 uses; 'member' is NOT in the actor_type CHECK).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. member_record_reviews — auditable per-child record confirmations (review kind)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_record_reviews (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_profile_id      uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  review_kind            text        NOT NULL CHECK (review_kind IN ('medical')),
  reviewed_on_behalf_by  uuid        REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  reviewed_by_auth_user  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at            timestamptz NOT NULL DEFAULT now(),
  snapshot               jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS member_record_reviews_by_member
  ON public.member_record_reviews (member_profile_id, review_kind, reviewed_at DESC);

ALTER TABLE public.member_record_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_record_reviews FROM anon, authenticated;
-- No RLS policies — all access via SECURITY DEFINER RPCs.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. member_id_documents.purged_at — retention purge marker
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.member_id_documents
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. venue_verify_id_document — MODIFIED: return storage_path so the verifier client
--    removes the file via the Storage API (SQL cannot delete storage.objects).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_verify_id_document(
  p_venue_token      text,
  p_document_id      uuid,
  p_action           text,
  p_rejection_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_doc      record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_action NOT IN ('approve','reject') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE='P0001';
  END IF;
  IF p_action = 'reject' AND (p_rejection_reason IS NULL OR trim(p_rejection_reason) = '') THEN
    RAISE EXCEPTION 'rejection_reason_required' USING ERRCODE='P0001';
  END IF;

  SELECT d.* INTO v_doc
  FROM member_id_documents d
  JOIN club_venues cv ON cv.club_id = d.club_id AND cv.venue_id = v_venue_id
  WHERE d.id = p_document_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE='P0001';
  END IF;

  UPDATE member_id_documents
  SET status           = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
      rejection_reason = CASE WHEN p_action = 'reject'  THEN p_rejection_reason ELSE NULL END,
      verified_by      = auth.uid(),
      verified_at      = now()
  WHERE id = p_document_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', auth.uid(), 'venue_admin', 'venue_id_verified',
    'member_id_document', p_document_id::text,
    jsonb_build_object('action', p_action, 'venue_id', v_venue_id)
  );

  -- Retention: the verifier client removes v_doc.storage_path via the Storage API,
  -- then stamps purged_at (guardian_purge_id_document, or the operator equivalent).
  RETURN jsonb_build_object('ok', true, 'storage_path', v_doc.storage_path);
END;
$$;

REVOKE ALL ON FUNCTION public.venue_verify_id_document(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_verify_id_document(text, uuid, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. guardian_submit_id_document — parent uploads a child's proof-of-age ID.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardian_submit_id_document(
  p_for_profile_id text,
  p_club_id        text,
  p_document_type  text,
  p_storage_path   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_caller  record;
  v_child   uuid := NULLIF(p_for_profile_id, '')::uuid;
  v_club    record;
  v_doc_id  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_caller FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  IF v_child IS NOT NULL AND v_child <> v_caller.id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
      WHERE guardian_profile_id = v_caller.id
        AND child_profile_id    = v_child
        AND invite_state        = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
  ELSE
    v_child := v_caller.id;
  END IF;

  SELECT * INTO v_club FROM clubs WHERE id = p_club_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT v_club.id_mandate THEN RAISE EXCEPTION 'id_not_required' USING ERRCODE='P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships vm
    WHERE vm.member_profile_id = v_child AND vm.club_id = p_club_id
      AND vm.status IN ('active','paused','ending')
  ) THEN
    RAISE EXCEPTION 'not_member_of_club' USING ERRCODE='P0001';
  END IF;

  IF p_document_type NOT IN ('passport','driving_licence','pass_card','birth_certificate') THEN
    RAISE EXCEPTION 'invalid_document_type' USING ERRCODE='P0001';
  END IF;

  -- Path under the GUARDIAN's own prefix (matches the existing storage INSERT RLS).
  IF NOT starts_with(p_storage_path, v_caller.id::text || '/') THEN
    RAISE EXCEPTION 'invalid_storage_path' USING ERRCODE='P0001';
  END IF;

  INSERT INTO member_id_documents (member_profile_id, club_id, document_type, storage_path, status)
  VALUES (v_child, p_club_id, p_document_type, p_storage_path, 'pending')
  RETURNING id INTO v_doc_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', v_uid, 'player', 'guardian_id_submitted',
    'member_id_document', v_doc_id::text,
    jsonb_build_object('club_id', p_club_id, 'document_type', p_document_type,
                       'member_profile_id', v_child,
                       'submitted_by_profile_id', v_caller.id,
                       'for_child', (v_child <> v_caller.id))
  );

  RETURN jsonb_build_object('ok', true, 'id', v_doc_id);
END;
$$;

REVOKE ALL ON FUNCTION public.guardian_submit_id_document(text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardian_submit_id_document(text, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. guardian_confirm_record_review — record a medical/contact confirmation for a child.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardian_confirm_record_review(
  p_for_profile_id text,
  p_review_kind    text DEFAULT 'medical'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_caller    record;
  v_child     uuid := NULLIF(p_for_profile_id, '')::uuid;
  v_behalf    uuid;
  v_prof      record;
  v_snapshot  jsonb;
  v_review_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF p_review_kind NOT IN ('medical') THEN RAISE EXCEPTION 'invalid_review_kind' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_caller FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  IF v_child IS NOT NULL AND v_child <> v_caller.id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
      WHERE guardian_profile_id = v_caller.id
        AND child_profile_id    = v_child
        AND invite_state        = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_behalf := v_caller.id;
  ELSE
    v_child  := v_caller.id;
    v_behalf := NULL;
  END IF;

  SELECT * INTO v_prof FROM member_profiles WHERE id = v_child;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001'; END IF;

  v_snapshot := jsonb_build_object(
    'ec1_name',                      v_prof.ec1_name,
    'ec1_relationship',              v_prof.ec1_relationship,
    'ec1_phone',                     v_prof.ec1_phone,
    'ec2_name',                      v_prof.ec2_name,
    'ec2_relationship',              v_prof.ec2_relationship,
    'ec2_phone',                     v_prof.ec2_phone,
    'dietary_notes',                 v_prof.dietary_notes,
    'send_notes',                    v_prof.send_notes,
    'consent_emergency_treatment',   v_prof.consent_emergency_treatment,
    'consent_administer_medication', v_prof.consent_administer_medication
  );

  INSERT INTO public.member_record_reviews
    (member_profile_id, review_kind, reviewed_on_behalf_by, reviewed_by_auth_user, snapshot)
  VALUES (v_child, p_review_kind, v_behalf, v_uid, v_snapshot)
  RETURNING id INTO v_review_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', v_uid, 'player', 'guardian_record_reviewed',
    'member_record_review', v_review_id::text,
    jsonb_build_object('member_profile_id', v_child, 'review_kind', p_review_kind,
                       'reviewed_by_profile_id', v_caller.id,
                       'for_child', (v_behalf IS NOT NULL))
  );

  RETURN jsonb_build_object('ok', true, 'review_id', v_review_id);
END;
$$;

REVOKE ALL ON FUNCTION public.guardian_confirm_record_review(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardian_confirm_record_review(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. guardian_purge_id_document — stamp purged_at after the owner removes the ID file
--    via the Storage API (retention completion). Guardian-gated (or self).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardian_purge_id_document(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_caller uuid;
  v_doc    record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_caller FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_doc FROM member_id_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE='P0001'; END IF;

  IF v_doc.member_profile_id <> v_caller AND NOT EXISTS (
    SELECT 1 FROM public.member_guardians
    WHERE guardian_profile_id = v_caller AND child_profile_id = v_doc.member_profile_id
      AND invite_state = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
  END IF;

  IF v_doc.status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'not_verified' USING ERRCODE='P0001';
  END IF;

  UPDATE member_id_documents SET purged_at = now()
  WHERE id = p_document_id AND purged_at IS NULL;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', v_uid, 'player', 'guardian_id_purged',
    'member_id_document', p_document_id::text,
    jsonb_build_object('member_profile_id', v_doc.member_profile_id, 'purged_by_profile_id', v_caller)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.guardian_purge_id_document(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardian_purge_id_document(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. storage DELETE policy — own-prefix removal of ID objects via the Storage API.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "member_id_docs_delete" ON storage.objects;
CREATE POLICY "member_id_docs_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'member-id-docs'
    AND starts_with(name, (
      SELECT id::text FROM public.member_profiles WHERE auth_user_id = auth.uid() LIMIT 1
    ) || '/')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. guardian_list_child_documents — the unified per-child requirement manifest.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardian_list_child_documents(
  p_child_profile_id text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_caller  uuid;
  v_child   uuid := NULLIF(p_child_profile_id, '')::uuid;
  v_prof    record;
  v_sign    jsonb;
  v_upload  jsonb;
  v_review  jsonb;
  v_medical jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF v_child IS NULL THEN RAISE EXCEPTION 'child_required' USING ERRCODE='P0001'; END IF;

  SELECT id INTO v_caller FROM member_profiles WHERE auth_user_id = v_uid;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  IF v_child <> v_caller AND NOT EXISTS (
    SELECT 1 FROM public.member_guardians
    WHERE guardian_profile_id = v_caller
      AND child_profile_id    = v_child
      AND invite_state        = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_prof FROM member_profiles WHERE id = v_child;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001'; END IF;

  -- SIGN: one row per current policy_document for the child's clubs.
  WITH child_clubs AS (
    SELECT DISTINCT vm.club_id
    FROM public.venue_memberships vm
    WHERE vm.member_profile_id = v_child
      AND vm.status IN ('active','paused','ending')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'req_id',     'sign:' || pd.id::text,
    'kind',       'sign',
    'doc_id',     pd.id,
    'club_id',    pd.club_id,
    'club_name',  c.name,
    'title',      pd.title,
    'sub',        c.name || ' · v' || pd.version,
    'body',       pd.body,
    'version',    pd.version,
    'status',     CASE WHEN ca.id IS NOT NULL THEN 'done' ELSE 'due' END,
    'completed_at', ca.accepted_at
  ) ORDER BY (ca.id IS NOT NULL), c.name, pd.title), '[]'::jsonb)
  INTO v_sign
  FROM child_clubs cc
  JOIN public.policy_documents pd ON pd.club_id = cc.club_id AND pd.is_current
  JOIN public.clubs c ON c.id = pd.club_id
  LEFT JOIN public.consent_acceptances ca
    ON ca.document_id = pd.id AND ca.member_profile_id = v_child;

  -- UPLOAD: one row per id_mandate club, with the latest submission's status +
  -- storage_path/purged so the screen can self-heal the retention purge.
  WITH child_clubs AS (
    SELECT DISTINCT vm.club_id
    FROM public.venue_memberships vm
    WHERE vm.member_profile_id = v_child
      AND vm.status IN ('active','paused','ending')
  ),
  latest AS (
    SELECT DISTINCT ON (d.club_id) d.club_id, d.id AS doc_id, d.status, d.uploaded_at, d.verified_at,
           d.rejection_reason, d.document_type, d.storage_path, d.purged_at
    FROM public.member_id_documents d
    WHERE d.member_profile_id = v_child
    ORDER BY d.club_id, d.uploaded_at DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'req_id',     'upload:' || c.id,
    'kind',       'upload',
    'club_id',    c.id,
    'club_name',  c.name,
    'title',      'Proof of age',
    'sub',        'Birth certificate or passport',
    'body',       'League rules require proof of age for every junior player. Upload a clear photo of a birth certificate or passport — used once for verification, then deleted.',
    'doc_id',     l.doc_id,
    'doc_status', COALESCE(l.status, 'none'),
    'rejection_reason', l.rejection_reason,
    'storage_path', CASE WHEN l.purged_at IS NULL THEN l.storage_path ELSE NULL END,
    'purged',     (l.purged_at IS NOT NULL),
    'status',     CASE l.status WHEN 'approved' THEN 'done'
                                WHEN 'pending'  THEN 'submitted'
                                ELSE 'due' END,
    'completed_at', l.verified_at
  ) ORDER BY (l.status = 'approved'), c.name), '[]'::jsonb)
  INTO v_upload
  FROM child_clubs cc
  JOIN public.clubs c ON c.id = cc.club_id AND c.id_mandate = true
  LEFT JOIN latest l ON l.club_id = c.id;

  -- REVIEW: a single medical / emergency-contact confirmation, due if not confirmed in
  -- the last 12 months. Snapshot inlined for the sheet.
  v_medical := jsonb_build_object(
    'ec1_name',                      v_prof.ec1_name,
    'ec1_relationship',              v_prof.ec1_relationship,
    'ec1_phone',                     v_prof.ec1_phone,
    'ec2_name',                      v_prof.ec2_name,
    'ec2_relationship',              v_prof.ec2_relationship,
    'ec2_phone',                     v_prof.ec2_phone,
    'dietary_notes',                 v_prof.dietary_notes,
    'send_notes',                    v_prof.send_notes,
    'consent_emergency_treatment',   v_prof.consent_emergency_treatment,
    'consent_administer_medication', v_prof.consent_administer_medication
  );

  SELECT jsonb_build_object(
    'req_id',  'review:medical',
    'kind',    'review',
    'title',   'Medical & emergency contact',
    'sub',     'Review each season',
    'body',    'Emergency contact, allergies, medical conditions and medication. Please check this is current before the season starts.',
    'status',  CASE WHEN r.reviewed_at IS NOT NULL AND r.reviewed_at > now() - interval '12 months'
                    THEN 'done' ELSE 'due' END,
    'completed_at', r.reviewed_at,
    'medical', v_medical
  )
  INTO v_review
  FROM (SELECT 1) one
  LEFT JOIN LATERAL (
    SELECT reviewed_at FROM public.member_record_reviews
    WHERE member_profile_id = v_child AND review_kind = 'medical'
    ORDER BY reviewed_at DESC LIMIT 1
  ) r ON true;

  RETURN jsonb_build_object(
    'ok',               true,
    'child_profile_id', v_child,
    'caller_profile_id', v_caller,
    'child_name',       NULLIF(btrim(COALESCE(v_prof.first_name,'') || ' ' || COALESCE(v_prof.last_name,'')), ''),
    'sign',             COALESCE(v_sign,   '[]'::jsonb),
    'upload',           COALESCE(v_upload, '[]'::jsonb),
    'review',           v_review,
    'medical',          v_medical
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.guardian_list_child_documents(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.guardian_list_child_documents(text) TO anon, authenticated;
