-- 293_consent_documents.sql
-- Phase 5: Consent documents + e-sign.
-- Versioned policy documents (club-scoped) + consent acceptances with full audit
-- trail (typed signature, IP, UA, signed-on-behalf-of for guardian→child).
-- Re-consent prompted when a new version is published (is_current flips to new row).

-- ── 1. Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.policy_documents (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  title      text        NOT NULL CHECK (length(btrim(title)) > 0),
  body       text        NOT NULL CHECK (length(btrim(body)) > 0),
  version    int         NOT NULL DEFAULT 1 CHECK (version > 0),
  is_current boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (club_id, title, version)
);

-- One current version per (club_id, title) — enforced as a partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS policy_documents_current_idx
  ON public.policy_documents (club_id, title) WHERE is_current;

CREATE INDEX IF NOT EXISTS policy_documents_by_club ON public.policy_documents (club_id);

CREATE TABLE IF NOT EXISTS public.consent_acceptances (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid        NOT NULL REFERENCES public.policy_documents(id) ON DELETE RESTRICT,
  member_profile_id   uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  -- NULL = member signed for themselves; non-null = guardian profile that signed on behalf of child
  signed_on_behalf_of uuid        REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  typed_signature     text        NOT NULL CHECK (length(btrim(typed_signature)) > 0),
  accepted_at         timestamptz NOT NULL DEFAULT now(),
  ip_address          text,
  user_agent          text,
  -- snapshot of the auth user at signing time
  auth_user_id        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (document_id, member_profile_id)
);

CREATE INDEX IF NOT EXISTS consent_acceptances_by_member
  ON public.consent_acceptances (member_profile_id);
CREATE INDEX IF NOT EXISTS consent_acceptances_by_document
  ON public.consent_acceptances (document_id);

-- RLS: RPC-only, no direct access
ALTER TABLE public.policy_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.policy_documents, public.consent_acceptances FROM anon, authenticated;

-- ── 2. venue_create_policy_document ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_policy_document(
  p_venue_token text,
  p_club_id     text,
  p_title       text,
  p_body        text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_title    text := NULLIF(btrim(p_title), '');
  v_body     text := NULLIF(btrim(p_body),  '');
  v_doc_id   uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required'  USING ERRCODE='P0001'; END IF;
  IF v_body  IS NULL THEN RAISE EXCEPTION 'body_required'   USING ERRCODE='P0001'; END IF;

  -- Verify club belongs to this venue
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id=p_club_id AND venue_id=v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.policy_documents (club_id, title, body, version, is_current, created_by)
  VALUES (p_club_id, v_title, v_body, 1, true, auth.uid())
  RETURNING id INTO v_doc_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'policy_document_created', 'policy_document', v_doc_id::text,
          jsonb_build_object('club_id', p_club_id, 'title', v_title, 'version', 1));
  RETURN jsonb_build_object('ok', true, 'document_id', v_doc_id, 'version', 1);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_create_policy_document(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_policy_document(text,text,text,text) TO anon, authenticated;

-- ── 3. venue_publish_policy_version ──────────────────────────────────────────
-- Creates a new version of an existing document, retiring the previous current version.
-- All members who had accepted the old version will need to re-accept the new one.
CREATE OR REPLACE FUNCTION public.venue_publish_policy_version(
  p_venue_token text,
  p_document_id uuid,
  p_body        text,
  p_title       text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_body      text := NULLIF(btrim(p_body), '');
  v_old       record;
  v_new_id    uuid;
  v_new_ver   int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF v_body IS NULL THEN RAISE EXCEPTION 'body_required' USING ERRCODE='P0001'; END IF;

  -- Fetch current version; verify its club belongs to this venue
  SELECT pd.id, pd.club_id, pd.title, pd.version INTO v_old
    FROM public.policy_documents pd
    JOIN public.club_venues cv ON cv.club_id = pd.club_id
   WHERE pd.id = p_document_id
     AND cv.venue_id = v_venue_id
     AND pd.is_current;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE='P0001'; END IF;

  v_new_ver := v_old.version + 1;

  -- Retire old version
  UPDATE public.policy_documents SET is_current = false WHERE id = v_old.id;

  -- Insert new version (inherits club_id and title unless overridden)
  INSERT INTO public.policy_documents
    (club_id, title, body, version, is_current, created_by)
  VALUES (
    v_old.club_id,
    COALESCE(NULLIF(btrim(p_title), ''), v_old.title),
    v_body,
    v_new_ver,
    true,
    auth.uid()
  )
  RETURNING id INTO v_new_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'policy_version_published', 'policy_document', v_new_id::text,
          jsonb_build_object('club_id', v_old.club_id, 'title', v_old.title,
                             'old_version', v_old.version, 'new_version', v_new_ver));
  RETURN jsonb_build_object('ok', true, 'document_id', v_new_id, 'version', v_new_ver);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_publish_policy_version(text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_publish_policy_version(text,uuid,text,text) TO anon, authenticated;

-- ── 4. venue_list_policy_documents ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_policy_documents(
  p_venue_token   text,
  p_club_id       text,
  p_all_versions  boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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

  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id=p_club_id AND venue_id=v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'document_id',       pd.id,
    'title',             pd.title,
    'version',           pd.version,
    'is_current',        pd.is_current,
    'created_at',        pd.created_at,
    'acceptance_count',  (SELECT count(*) FROM public.consent_acceptances ca WHERE ca.document_id = pd.id)
  ) ORDER BY pd.title, pd.version DESC), '[]'::jsonb)
  INTO v_rows
  FROM public.policy_documents pd
  WHERE pd.club_id = p_club_id
    AND (p_all_versions OR pd.is_current);

  RETURN jsonb_build_object('ok', true, 'documents', v_rows);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_policy_documents(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_policy_documents(text,text,boolean) TO anon, authenticated;

-- ── 5. member_accept_consent ──────────────────────────────────────────────────
-- Authenticated. Signs a policy document for self, or as guardian for a child.
-- p_on_behalf_of_profile_id: if set, caller must be a guardian of that profile.
CREATE OR REPLACE FUNCTION public.member_accept_consent(
  p_document_id             uuid,
  p_typed_signature         text,
  p_on_behalf_of_profile_id uuid    DEFAULT NULL,
  p_ip_address              text    DEFAULT NULL,
  p_user_agent              text    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_caller_prof  uuid;
  v_member_prof  uuid;
  v_guardian_of  uuid;
  v_sig          text := NULLIF(btrim(p_typed_signature), '');
  v_acc_id       uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF v_sig IS NULL THEN RAISE EXCEPTION 'signature_required' USING ERRCODE='P0001'; END IF;

  -- Resolve caller's own member_profile
  SELECT id INTO v_caller_prof FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_prof IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001'; END IF;

  IF p_on_behalf_of_profile_id IS NULL THEN
    -- Signing for self
    v_member_prof := v_caller_prof;
    v_guardian_of := NULL;
  ELSE
    -- Signing for a child — verify guardian relationship
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
       WHERE child_profile_id = p_on_behalf_of_profile_id
         AND guardian_profile_id = v_caller_prof
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_member_prof := p_on_behalf_of_profile_id;
    v_guardian_of := v_caller_prof;
  END IF;

  -- Document must be current
  IF NOT EXISTS (SELECT 1 FROM public.policy_documents WHERE id = p_document_id AND is_current) THEN
    RAISE EXCEPTION 'document_not_current' USING ERRCODE='P0001';
  END IF;

  BEGIN
    INSERT INTO public.consent_acceptances
      (document_id, member_profile_id, signed_on_behalf_of, typed_signature,
       ip_address, user_agent, auth_user_id)
    VALUES
      (p_document_id, v_member_prof, v_guardian_of, v_sig,
       p_ip_address, p_user_agent, v_uid)
    RETURNING id INTO v_acc_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_accepted' USING ERRCODE='P0001';
  END;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (NULL, v_uid, 'member', v_caller_prof::text,
          'consent_accepted', 'consent_acceptance', v_acc_id::text,
          jsonb_build_object('document_id', p_document_id,
                             'member_profile_id', v_member_prof,
                             'signed_on_behalf_of', v_guardian_of));
  RETURN jsonb_build_object('ok', true, 'acceptance_id', v_acc_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_accept_consent(uuid,text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_accept_consent(uuid,text,uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.member_accept_consent(uuid,text,uuid,text,text) TO authenticated;

-- ── 6. member_get_pending_consents ────────────────────────────────────────────
-- Returns current policy documents the member (or their children) haven't signed.
-- Includes body text so the modal can render without a second round-trip.
CREATE OR REPLACE FUNCTION public.member_get_pending_consents()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_prof uuid;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_prof FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_prof IS NULL THEN RETURN jsonb_build_object('ok', true, 'pending', '[]'::jsonb); END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'club_name', row_data->>'title'), '[]'::jsonb)
  INTO v_rows
  FROM (
    -- self: docs for clubs the member is directly enrolled in
    SELECT jsonb_build_object(
      'document_id',    pd.id,
      'for_profile_id', v_prof,
      'for_name',       mp.first_name || ' ' || mp.last_name,
      'club_id',        c.id,
      'club_name',      c.name,
      'title',          pd.title,
      'version',        pd.version,
      'body',           pd.body
    ) AS row_data
    FROM public.policy_documents pd
    JOIN public.clubs c ON c.id = pd.club_id
    JOIN public.venue_memberships vm ON vm.club_id = c.id
    JOIN public.member_profiles mp ON mp.id = v_prof
    WHERE pd.is_current
      AND vm.member_profile_id = v_prof
      AND vm.status IN ('active','paused','ending')
      AND NOT EXISTS (
        SELECT 1 FROM public.consent_acceptances ca
         WHERE ca.document_id = pd.id AND ca.member_profile_id = v_prof
      )

    UNION ALL

    -- children: docs for clubs any of the member's children are enrolled in
    SELECT jsonb_build_object(
      'document_id',    pd.id,
      'for_profile_id', child.id,
      'for_name',       child.first_name || ' ' || child.last_name,
      'club_id',        c.id,
      'club_name',      c.name,
      'title',          pd.title,
      'version',        pd.version,
      'body',           pd.body
    ) AS row_data
    FROM public.member_guardians mg
    JOIN public.member_profiles child ON child.id = mg.child_profile_id
    JOIN public.venue_memberships vm ON vm.member_profile_id = child.id
    JOIN public.clubs c ON c.id = vm.club_id
    JOIN public.policy_documents pd ON pd.club_id = c.id AND pd.is_current
    WHERE mg.guardian_profile_id = v_prof
      AND vm.status IN ('active','paused','ending')
      AND NOT EXISTS (
        SELECT 1 FROM public.consent_acceptances ca
         WHERE ca.document_id = pd.id AND ca.member_profile_id = child.id
      )
  ) sub;

  RETURN jsonb_build_object('ok', true, 'pending', v_rows);
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_get_pending_consents() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_get_pending_consents() FROM anon;
GRANT EXECUTE ON FUNCTION public.member_get_pending_consents() TO authenticated;

-- ── 7. member_list_consents ───────────────────────────────────────────────────
-- Returns signed consents for the member's own profile and their children,
-- for display in the member profile "Consents" section.
CREATE OR REPLACE FUNCTION public.member_list_consents()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_prof uuid;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_prof FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_prof IS NULL THEN RETURN jsonb_build_object('ok', true, 'consents', '[]'::jsonb); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'acceptance_id',      ca.id,
    'document_id',        pd.id,
    'title',              pd.title,
    'version',            pd.version,
    'is_current',         pd.is_current,
    'club_name',          c.name,
    'for_profile_id',     ca.member_profile_id,
    'for_name',           mp.first_name || ' ' || mp.last_name,
    'typed_signature',    ca.typed_signature,
    'accepted_at',        ca.accepted_at,
    'signed_on_behalf_of', ca.signed_on_behalf_of
  ) ORDER BY ca.accepted_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM public.consent_acceptances ca
  JOIN public.policy_documents pd ON pd.id = ca.document_id
  JOIN public.clubs c ON c.id = pd.club_id
  JOIN public.member_profiles mp ON mp.id = ca.member_profile_id
  WHERE ca.member_profile_id = v_prof
     OR ca.member_profile_id IN (
       SELECT mg.child_profile_id FROM public.member_guardians mg
        WHERE mg.guardian_profile_id = v_prof
     );

  RETURN jsonb_build_object('ok', true, 'consents', v_rows);
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_list_consents() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_list_consents() FROM anon;
GRANT EXECUTE ON FUNCTION public.member_list_consents() TO authenticated;
