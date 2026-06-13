-- ── mig 294 DOWN ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.venue_verify_id_document(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.venue_list_id_submissions(text);
DROP FUNCTION IF EXISTS public.member_list_id_documents();
DROP FUNCTION IF EXISTS public.member_submit_id_document(text, text, text);
DROP TABLE IF EXISTS public.member_id_documents;
DROP POLICY IF EXISTS "member_id_docs_insert" ON storage.objects;
DROP POLICY IF EXISTS "member_id_docs_select" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'member-id-docs';
-- member_get_self restored to pre-294 version manually if needed
