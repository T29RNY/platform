-- 431 down — Guardian Documents
DROP FUNCTION IF EXISTS public.guardian_list_child_documents(text);
DROP FUNCTION IF EXISTS public.guardian_purge_id_document(uuid);
DROP FUNCTION IF EXISTS public.guardian_confirm_record_review(text, text);
DROP FUNCTION IF EXISTS public.guardian_submit_id_document(text, text, text, text);
DROP POLICY IF EXISTS "member_id_docs_delete" ON storage.objects;

-- Restore venue_verify_id_document to its mig-294 form (return {ok:true} only).
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
  WHERE d.id = p_document_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE='P0001';
  END IF;
  UPDATE member_id_documents
  SET status           = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
      rejection_reason = CASE WHEN p_action = 'reject'  THEN p_rejection_reason ELSE NULL END,
      verified_by      = auth.uid(),
      verified_at      = now()
  WHERE id = p_document_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', auth.uid(), 'venue_admin', 'venue_id_verified', 'member_id_document', p_document_id::text,
    jsonb_build_object('action', p_action, 'venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.venue_verify_id_document(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_verify_id_document(text, uuid, text, text) TO anon, authenticated;

ALTER TABLE public.member_id_documents DROP COLUMN IF EXISTS purged_at;
DROP TABLE IF EXISTS public.member_record_reviews;
