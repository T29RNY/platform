-- ── mig 294: Phase 6 — ID & document upload ──────────────────────────────────
-- member_id_documents table + private storage bucket + 4 RPCs + member_get_self extension

-- ── 1. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE public.member_id_documents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_profile_id uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  club_id           text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  document_type     text        NOT NULL CHECK (document_type IN ('passport','driving_licence','pass_card','birth_certificate')),
  storage_path      text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason  text,
  verified_by       uuid,
  verified_at       timestamptz,
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_id_documents ENABLE ROW LEVEL SECURITY;
-- No RLS policies — all access via SECURITY DEFINER RPCs

-- ── 2. Storage bucket (private) ───────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('member-id-docs', 'member-id-docs', false,
        ARRAY['image/jpeg','image/png','image/webp','application/pdf'],
        10485760)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: INSERT — member can only upload under their own profile-id prefix
CREATE POLICY "member_id_docs_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'member-id-docs'
    AND (
      SELECT id::text FROM public.member_profiles
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    ) IS NOT NULL
    AND starts_with(name, (
      SELECT id::text FROM public.member_profiles
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    ) || '/')
  );

-- Storage RLS: SELECT — any authenticated user can generate signed URLs
-- (path is UUID-opaque; only venue RPCs reveal paths; URLs are time-limited)
CREATE POLICY "member_id_docs_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'member-id-docs');

-- ── 3. member_submit_id_document ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_submit_id_document(
  p_club_id       text,
  p_document_type text,
  p_storage_path  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_club    record;
  v_doc_id  uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_profile FROM member_profiles WHERE auth_user_id = v_user_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_club FROM clubs WHERE id = p_club_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;
  IF NOT v_club.id_mandate THEN
    RAISE EXCEPTION 'id_not_required' USING ERRCODE='P0001';
  END IF;

  IF p_document_type NOT IN ('passport','driving_licence','pass_card','birth_certificate') THEN
    RAISE EXCEPTION 'invalid_document_type' USING ERRCODE='P0001';
  END IF;

  IF NOT starts_with(p_storage_path, v_profile.id::text || '/') THEN
    RAISE EXCEPTION 'invalid_storage_path' USING ERRCODE='P0001';
  END IF;

  INSERT INTO member_id_documents (member_profile_id, club_id, document_type, storage_path, status)
  VALUES (v_profile.id, p_club_id, p_document_type, p_storage_path, 'pending')
  RETURNING id INTO v_doc_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', v_user_id, 'member', 'member_id_submitted',
    'member_id_document', v_doc_id::text,
    jsonb_build_object('club_id', p_club_id, 'document_type', p_document_type)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_doc_id);
END;
$$;

REVOKE ALL ON FUNCTION public.member_submit_id_document(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_submit_id_document(text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.member_submit_id_document(text, text, text) FROM anon;

-- ── 4. member_list_id_documents ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_list_id_documents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_rows    jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_profile FROM member_profiles WHERE auth_user_id = v_user_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('documents', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',               d.id,
    'club_id',          d.club_id,
    'club_name',        c.name,
    'document_type',    d.document_type,
    'status',           d.status,
    'storage_path',     d.storage_path,
    'uploaded_at',      d.uploaded_at,
    'verified_at',      d.verified_at,
    'rejection_reason', d.rejection_reason
  ) ORDER BY d.uploaded_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM member_id_documents d
  JOIN clubs c ON c.id = d.club_id
  WHERE d.member_profile_id = v_profile.id;

  RETURN jsonb_build_object('documents', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.member_list_id_documents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_list_id_documents() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.member_list_id_documents() FROM anon;

-- ── 5. venue_list_id_submissions ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_id_submissions(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_rows     jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',                d.id,
    'member_profile_id', d.member_profile_id,
    'first_name',        mp.first_name,
    'last_name',         mp.last_name,
    'club_id',           d.club_id,
    'club_name',         c.name,
    'document_type',     d.document_type,
    'status',            d.status,
    'storage_path',      d.storage_path,
    'uploaded_at',       d.uploaded_at,
    'verified_at',       d.verified_at,
    'rejection_reason',  d.rejection_reason
  ) ORDER BY
    CASE d.status WHEN 'pending' THEN 0 ELSE 1 END,
    d.uploaded_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM member_id_documents d
  JOIN member_profiles mp ON mp.id = d.member_profile_id
  JOIN clubs c ON c.id = d.club_id
  JOIN club_venues cv ON cv.club_id = d.club_id AND cv.venue_id = v_venue_id;

  RETURN jsonb_build_object('ok', true, 'submissions', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.venue_list_id_submissions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_id_submissions(text) TO anon, authenticated;

-- ── 6. venue_verify_id_document ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_verify_id_document(
  p_venue_token      text,
  p_document_id      uuid,
  p_action           text,
  p_rejection_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

  -- Load and scope-check: document must belong to a club linked to this venue
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

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.venue_verify_id_document(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_verify_id_document(text, uuid, text, text) TO anon, authenticated;

-- ── 7. Extend member_get_self — add id_mandate_clubs ─────────────────────────
CREATE OR REPLACE FUNCTION public.member_get_self()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_profile          record;
  v_id_mandate_clubs jsonb;
BEGIN
  SELECT * INTO v_profile
  FROM member_profiles
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',   c.id,
    'club_name', c.name
  )), '[]'::jsonb)
  INTO v_id_mandate_clubs
  FROM venue_memberships vm
  JOIN clubs c ON c.id = vm.club_id
  WHERE vm.member_profile_id = v_profile.id
    AND vm.status = 'active'
    AND c.id_mandate = true;

  RETURN jsonb_build_object(
    'found',                          true,
    'id',                             v_profile.id,
    'first_name',                     v_profile.first_name,
    'last_name',                      v_profile.last_name,
    'email',                          v_profile.email,
    'phone',                          v_profile.phone,
    'dob',                            v_profile.dob,
    'gender',                         v_profile.gender,
    'address_line1',                  v_profile.address_line1,
    'address_line2',                  v_profile.address_line2,
    'address_city',                   v_profile.address_city,
    'address_postcode',               v_profile.address_postcode,
    'ec1_name',                       v_profile.ec1_name,
    'ec1_relationship',               v_profile.ec1_relationship,
    'ec1_phone',                      v_profile.ec1_phone,
    'ec2_name',                       v_profile.ec2_name,
    'ec2_relationship',               v_profile.ec2_relationship,
    'ec2_phone',                      v_profile.ec2_phone,
    'send_notes',                     v_profile.send_notes,
    'dietary_notes',                  v_profile.dietary_notes,
    'consent_emergency_treatment',    v_profile.consent_emergency_treatment,
    'consent_administer_medication',  v_profile.consent_administer_medication,
    'may_leave_unaccompanied',        v_profile.may_leave_unaccompanied,
    'authorised_collectors',          v_profile.authorised_collectors,
    'photo_consent',                  v_profile.photo_consent,
    'created_at',                     v_profile.created_at,
    'updated_at',                     v_profile.updated_at,
    'id_mandate_clubs',               v_id_mandate_clubs
  );
END;
$$;
