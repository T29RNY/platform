-- 572_member_id_docs_select_scope_down.sql — reverse of 572.
-- Restores the prior (wide-open) SELECT policy and drops the helper.
-- NOTE: this re-opens read of every member-id-docs object to any authenticated
-- user; provided only to satisfy the paired-migration convention.

DROP POLICY IF EXISTS member_id_docs_select ON storage.objects;
CREATE POLICY member_id_docs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'member-id-docs');

DROP FUNCTION IF EXISTS public._can_read_member_id_object(text);
