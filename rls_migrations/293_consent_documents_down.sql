-- 293_consent_documents_down.sql
-- Reverts Phase 5 consent documents. Drops tables (cascades acceptances).
-- Do not run while consent_acceptances rows exist — ON DELETE RESTRICT on document_id
-- means you must truncate consent_acceptances first.

DROP FUNCTION IF EXISTS public.member_list_consents();
DROP FUNCTION IF EXISTS public.member_get_pending_consents();
DROP FUNCTION IF EXISTS public.member_accept_consent(uuid,text,uuid,text,text);
DROP FUNCTION IF EXISTS public.venue_list_policy_documents(text,text,boolean);
DROP FUNCTION IF EXISTS public.venue_publish_policy_version(text,uuid,text,text);
DROP FUNCTION IF EXISTS public.venue_create_policy_document(text,text,text,text);

DROP TABLE IF EXISTS public.consent_acceptances;
DROP TABLE IF EXISTS public.policy_documents;
