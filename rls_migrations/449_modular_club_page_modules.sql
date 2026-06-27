-- 449: Modular Platform Epic B — Phase 5b (new-table club page modules).
-- The data-bearing modules that needed their own tables, after P5a (mig 448)
-- shipped the page-level config. Four new tables + their club-manager write RPCs
-- + a per-team manager-pick POTM store, and the matching slices on get_club_public.
--
--   club_committee   -- committee + a prominent WELFARE/SAFEGUARDING OFFICER (FA-required)
--   club_documents   -- policies / forms / PDFs (uploaded to club-media or linked)
--   club_events      -- lightweight social "what's on" (NOT a calendar)
--   club_team_potm   -- manager-PICKED player of the month, one row per club_team
--
-- Every write RPC keeps the mig-446/448 club-manager preamble VERBATIM:
--   auth.uid() -> member_profiles -> club_team_managers JOIN club_teams (is_active)
--   + _club_feature_enabled(club_id,'public_web') + audit_events (Hard Rule #9).
--   authenticated-only, single overload, search_path pinned.
--
-- get_club_public (P2 anon read) gains FOUR top-level slices — the EXACT shapes
-- P4's ClubPublicScreen already reads (clubPublicSections.jsx):
--   contacts  {contact_name, contact_email, welfareOfficer:{name,email}|null, committee:[{role,name,email}]}
--   documents [{title, url, type, size}]              (type<-doc_type, size<-size_label)
--   events    [{title, date, blurb}]                  (date<-event_date)
--   stats     { <team_id>: {potm:{name,month}|null, topScorer:null, reliability:[]} }
-- => zero P4 rework. Top-scorer DEFERRED (needs a ref-player->member link thin clubs
-- lack); reliability SKIPPED (season-vs-all-time conflict); FA table is Epic C.
--
-- POTM safeguarding gate: stats suppress youth teams entirely (cohort category=youth
-- or max_age < min_public_age) AND all stats when hide_public_rosters — under-18s are
-- never named on public boards (mirrors the roster transform already in get_club_public).
--
-- Consumers (Hard Rule #14): P5b ClubSettingsScreen (writes + admin list reads);
-- P4 ClubPublicScreen ContactsSection / DocumentsSection / EventsSection / StatsSection.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. NEW TABLES — all RLS-on, REVOKE ALL, NO policy => RPC-only access.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1a. club_committee ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_committee (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  role           text        NOT NULL,
  name           text        NOT NULL,
  email          text        DEFAULT NULL,
  is_welfare     boolean     NOT NULL DEFAULT false,
  display_order  int         NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_committee_club_idx
  ON public.club_committee (club_id, display_order);
ALTER TABLE public.club_committee ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_committee FROM anon, authenticated;

-- ─── 1b. club_documents ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_documents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  title          text        NOT NULL,
  url            text        NOT NULL,
  doc_type       text        DEFAULT NULL,   -- Policy | Form | PDF | …
  size_label     text        DEFAULT NULL,   -- "1.2 MB" — display only
  display_order  int         NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_documents_club_idx
  ON public.club_documents (club_id, display_order);
ALTER TABLE public.club_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_documents FROM anon, authenticated;

-- ─── 1c. club_events (lightweight social "what's on", NOT a calendar) ──────────
CREATE TABLE IF NOT EXISTS public.club_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  title          text        NOT NULL,
  event_date     date        DEFAULT NULL,
  blurb          text        DEFAULT NULL,
  display_order  int         NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_events_club_idx
  ON public.club_events (club_id, event_date);
ALTER TABLE public.club_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_events FROM anon, authenticated;

-- ─── 1d. club_team_potm (manager-pick POTM, one row per club_team) ─────────────
-- club_id denormalised (server-derived from the team, never client-trusted) so the
-- public read + admin list can filter/gate by club without a join back every time.
CREATE TABLE IF NOT EXISTS public.club_team_potm (
  team_id     uuid        PRIMARY KEY REFERENCES public.club_teams(id) ON DELETE CASCADE,
  club_id     text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  month       text        DEFAULT NULL,   -- free-text label e.g. "June 2026"
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_team_potm_club_idx
  ON public.club_team_potm (club_id);
ALTER TABLE public.club_team_potm ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_team_potm FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. COMMITTEE RPCs — add / update / remove / list
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 2a. club_add_committee_member ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_add_committee_member(
  p_club_id text, p_role text, p_name text, p_email text DEFAULT NULL,
  p_is_welfare boolean DEFAULT false, p_display_order int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid;
  v_role text := NULLIF(btrim(COALESCE(p_role,'')),'');
  v_name text := NULLIF(btrim(COALESCE(p_name,'')),''); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(p_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;
  IF v_role IS NULL THEN RAISE EXCEPTION 'role_required' USING ERRCODE='P0001'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;

  INSERT INTO club_committee (club_id, role, name, email, is_welfare, display_order)
  VALUES (p_club_id, v_role, v_name,
          NULLIF(btrim(COALESCE(p_email,'')),''),
          COALESCE(p_is_welfare, false), COALESCE(p_display_order,0))
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_committee_added', 'club_committee', v_id::text,
          jsonb_build_object('club_id', p_club_id, 'committee_id', v_id, 'role', v_role, 'is_welfare', COALESCE(p_is_welfare,false)));
  RETURN jsonb_build_object('ok', true, 'committee_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_add_committee_member(text,text,text,text,boolean,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_add_committee_member(text,text,text,text,boolean,int) TO authenticated;

-- ─── 2b. club_update_committee_member ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_update_committee_member(
  p_committee_id uuid, p_role text DEFAULT NULL, p_name text DEFAULT NULL,
  p_email text DEFAULT NULL, p_is_welfare boolean DEFAULT NULL, p_display_order int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_committee WHERE id = p_committee_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'committee_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  UPDATE club_committee SET
    role          = COALESCE(NULLIF(btrim(COALESCE(p_role,'')),''), role),
    name          = COALESCE(NULLIF(btrim(COALESCE(p_name,'')),''), name),
    email         = CASE WHEN p_email IS NULL THEN email ELSE NULLIF(btrim(p_email),'') END,
    is_welfare    = COALESCE(p_is_welfare, is_welfare),
    display_order = COALESCE(p_display_order, display_order)
  WHERE id = p_committee_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_committee_updated', 'club_committee', p_committee_id::text,
          jsonb_build_object('club_id', v_club_id, 'committee_id', p_committee_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_update_committee_member(uuid,text,text,text,boolean,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_update_committee_member(uuid,text,text,text,boolean,int) TO authenticated;

-- ─── 2c. club_remove_committee_member ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_remove_committee_member(p_committee_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_committee WHERE id = p_committee_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'committee_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  DELETE FROM club_committee WHERE id = p_committee_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_committee_removed', 'club_committee', p_committee_id::text,
          jsonb_build_object('club_id', v_club_id, 'committee_id', p_committee_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_remove_committee_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_remove_committee_member(uuid) TO authenticated;

-- ─── 2d. club_list_committee (admin) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_list_committee(p_club_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'committee_id', c.id, 'role', c.role, 'name', c.name, 'email', c.email,
      'is_welfare', c.is_welfare, 'display_order', c.display_order
    ) ORDER BY c.display_order, c.name)
    FROM club_committee c WHERE c.club_id = p_club_id
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_list_committee(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_list_committee(text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. DOCUMENTS RPCs — add / update / remove / list
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 3a. club_add_document ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_add_document(
  p_club_id text, p_title text, p_url text, p_doc_type text DEFAULT NULL,
  p_size_label text DEFAULT NULL, p_display_order int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid;
  v_title text := NULLIF(btrim(COALESCE(p_title,'')),'');
  v_url text := NULLIF(btrim(COALESCE(p_url,'')),''); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(p_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE='P0001'; END IF;
  IF v_url IS NULL THEN RAISE EXCEPTION 'url_required' USING ERRCODE='P0001'; END IF;

  INSERT INTO club_documents (club_id, title, url, doc_type, size_label, display_order)
  VALUES (p_club_id, v_title, v_url,
          NULLIF(btrim(COALESCE(p_doc_type,'')),''),
          NULLIF(btrim(COALESCE(p_size_label,'')),''),
          COALESCE(p_display_order,0))
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_document_added', 'club_document', v_id::text,
          jsonb_build_object('club_id', p_club_id, 'document_id', v_id, 'title', v_title));
  RETURN jsonb_build_object('ok', true, 'document_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_add_document(text,text,text,text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_add_document(text,text,text,text,text,int) TO authenticated;

-- ─── 3b. club_update_document ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_update_document(
  p_document_id uuid, p_title text DEFAULT NULL, p_url text DEFAULT NULL,
  p_doc_type text DEFAULT NULL, p_size_label text DEFAULT NULL, p_display_order int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_documents WHERE id = p_document_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  UPDATE club_documents SET
    title         = COALESCE(NULLIF(btrim(COALESCE(p_title,'')),''), title),
    url           = COALESCE(NULLIF(btrim(COALESCE(p_url,'')),''), url),
    doc_type      = CASE WHEN p_doc_type   IS NULL THEN doc_type   ELSE NULLIF(btrim(p_doc_type),'')   END,
    size_label    = CASE WHEN p_size_label IS NULL THEN size_label ELSE NULLIF(btrim(p_size_label),'') END,
    display_order = COALESCE(p_display_order, display_order)
  WHERE id = p_document_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_document_updated', 'club_document', p_document_id::text,
          jsonb_build_object('club_id', v_club_id, 'document_id', p_document_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_update_document(uuid,text,text,text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_update_document(uuid,text,text,text,text,int) TO authenticated;

-- ─── 3c. club_remove_document ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_remove_document(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_documents WHERE id = p_document_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  DELETE FROM club_documents WHERE id = p_document_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_document_removed', 'club_document', p_document_id::text,
          jsonb_build_object('club_id', v_club_id, 'document_id', p_document_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_remove_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_remove_document(uuid) TO authenticated;

-- ─── 3d. club_list_documents (admin) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_list_documents(p_club_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'document_id', d.id, 'title', d.title, 'url', d.url,
      'doc_type', d.doc_type, 'size_label', d.size_label, 'display_order', d.display_order
    ) ORDER BY d.display_order, d.created_at)
    FROM club_documents d WHERE d.club_id = p_club_id
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_list_documents(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_list_documents(text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. EVENTS RPCs — add / update / remove / list
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 4a. club_add_event ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_add_event(
  p_club_id text, p_title text, p_event_date date DEFAULT NULL,
  p_blurb text DEFAULT NULL, p_display_order int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid;
  v_title text := NULLIF(btrim(COALESCE(p_title,'')),''); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(p_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE='P0001'; END IF;

  INSERT INTO club_events (club_id, title, event_date, blurb, display_order)
  VALUES (p_club_id, v_title, p_event_date,
          NULLIF(btrim(COALESCE(p_blurb,'')),''),
          COALESCE(p_display_order,0))
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_event_added', 'club_event', v_id::text,
          jsonb_build_object('club_id', p_club_id, 'event_id', v_id, 'title', v_title));
  RETURN jsonb_build_object('ok', true, 'event_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_add_event(text,text,date,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_add_event(text,text,date,text,int) TO authenticated;

-- ─── 4b. club_update_event ────────────────────────────────────────────────────
-- p_event_date: NULL = leave as-is. (There is no separate "clear the date" path; a
-- dateless social item is created dateless and edited via the other fields.)
CREATE OR REPLACE FUNCTION public.club_update_event(
  p_event_id uuid, p_title text DEFAULT NULL, p_event_date date DEFAULT NULL,
  p_blurb text DEFAULT NULL, p_display_order int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_events WHERE id = p_event_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  UPDATE club_events SET
    title         = COALESCE(NULLIF(btrim(COALESCE(p_title,'')),''), title),
    event_date    = COALESCE(p_event_date, event_date),
    blurb         = CASE WHEN p_blurb IS NULL THEN blurb ELSE NULLIF(btrim(p_blurb),'') END,
    display_order = COALESCE(p_display_order, display_order)
  WHERE id = p_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_event_updated', 'club_event', p_event_id::text,
          jsonb_build_object('club_id', v_club_id, 'event_id', p_event_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_update_event(uuid,text,date,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_update_event(uuid,text,date,text,int) TO authenticated;

-- ─── 4c. club_remove_event ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_remove_event(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_events WHERE id = p_event_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  DELETE FROM club_events WHERE id = p_event_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_event_removed', 'club_event', p_event_id::text,
          jsonb_build_object('club_id', v_club_id, 'event_id', p_event_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_remove_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_remove_event(uuid) TO authenticated;

-- ─── 4d. club_list_events (admin) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_list_events(p_club_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'event_id', e.id, 'title', e.title, 'event_date', e.event_date,
      'blurb', e.blurb, 'display_order', e.display_order
    ) ORDER BY e.event_date NULLS LAST, e.display_order)
    FROM club_events e WHERE e.club_id = p_club_id
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_list_events(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_list_events(text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. POTM RPCs — set / remove / list (clone of club_admin_set_player_of_tournament,
--    auth derived from the club_team's club_id, never client-trusted).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 5a. club_set_potm (UPSERT one row per team) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.club_set_potm(
  p_team_id uuid, p_name text, p_month text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
  v_name text := NULLIF(btrim(COALESCE(p_name,'')),'');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_teams WHERE id = p_team_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;

  INSERT INTO club_team_potm (team_id, club_id, name, month, updated_at)
  VALUES (p_team_id, v_club_id, v_name, NULLIF(btrim(COALESCE(p_month,'')),''), now())
  ON CONFLICT (team_id) DO UPDATE SET
    name       = EXCLUDED.name,
    month      = EXCLUDED.month,
    club_id    = EXCLUDED.club_id,
    updated_at = now();

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_potm_set', 'club_team', p_team_id::text,
          jsonb_build_object('club_id', v_club_id, 'team_id', p_team_id, 'name', v_name));
  RETURN jsonb_build_object('ok', true, 'team_id', p_team_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_set_potm(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_potm(uuid,text,text) TO authenticated;

-- ─── 5b. club_remove_potm ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_remove_potm(p_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_club_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_id INTO v_club_id FROM club_teams WHERE id = p_team_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = v_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT public._club_feature_enabled(v_club_id, 'public_web') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;

  DELETE FROM club_team_potm WHERE team_id = p_team_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'club_potm_removed', 'club_team', p_team_id::text,
          jsonb_build_object('club_id', v_club_id, 'team_id', p_team_id));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_remove_potm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_remove_potm(uuid) TO authenticated;

-- ─── 5c. club_list_potm (admin — current picks across the club's teams) ────────
CREATE OR REPLACE FUNCTION public.club_list_potm(p_club_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id AND ct.club_id = p_club_id AND ctm.is_active = true
  ) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'team_id', pm.team_id, 'name', pm.name, 'month', pm.month
    ) ORDER BY pm.updated_at DESC)
    FROM club_team_potm pm WHERE pm.club_id = p_club_id
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_list_potm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_list_potm(text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. get_club_public — add contacts / documents / events / stats slices.
--    Reproduces the mig-448 body verbatim + the four new slices + pulls
--    clubs.contact_name/email into v_row. Same signature -> CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_club_public(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row          record;
  v_sg           jsonb;
  v_min_age      int;
  v_hide_rosters boolean;
BEGIN
  SELECT cp.*,
         c.name           AS club_name,
         c.short_name     AS club_short_name,
         c.discipline     AS club_discipline,
         c.founded_year   AS club_founded_year,
         c.contact_name   AS club_contact_name,
         c.contact_email  AS club_contact_email,
         c.safeguarding_config AS safeguarding_config
    INTO v_row
    FROM public.club_pages cp
    JOIN public.clubs c ON c.id = cp.club_id
   WHERE cp.slug = p_slug
   LIMIT 1;

  IF v_row.club_id IS NULL OR NOT COALESCE(v_row.published, false) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_sg           := COALESCE(v_row.safeguarding_config, '{}'::jsonb);
  v_min_age      := COALESCE(NULLIF(v_sg->>'min_public_age','')::int, 18);
  v_hide_rosters := COALESCE((v_sg->>'hide_public_rosters')::boolean, false);

  RETURN jsonb_build_object(
    'found', true,
    'club', jsonb_build_object(
      'id',           v_row.club_id,
      'name',         v_row.club_name,
      'short_name',   v_row.club_short_name,
      'discipline',   v_row.club_discipline,
      'founded_year', v_row.club_founded_year
    ),
    'branding', jsonb_build_object(
      'primary_colour',   v_row.primary_colour,
      'secondary_colour', v_row.secondary_colour,
      'accent_colour',    v_row.accent_colour,
      'crest_url',        v_row.crest_url,
      'hero_url',         v_row.hero_url,
      'tagline',          v_row.tagline,
      'about',            v_row.about,
      'socials',          v_row.socials,
      'sections',         v_row.sections
    ),
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'cohort_id', cc.id, 'name', cc.name, 'category', cc.category,
        'min_age', cc.min_age, 'max_age', cc.max_age,
        'teams', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'team_id', t.id, 'name', t.name, 'gender', t.gender,
            'priority_rank', t.priority_rank,
            'members', CASE WHEN v_hide_rosters THEN '[]'::jsonb ELSE COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'member_id', mp.id,
                'name', CASE
                  WHEN (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age)
                  THEN mp.first_name || COALESCE(' ' || left(mp.last_name, 1) || '.', '')
                  ELSE mp.first_name || COALESCE(' ' || mp.last_name, '')
                END,
                'is_minor', (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age),
                'photo_url', NULL
              ) ORDER BY mp.first_name)
              FROM public.club_team_members cm
              JOIN public.member_profiles mp ON mp.id = cm.member_profile_id
              WHERE cm.team_id = t.id AND cm.is_active = true
            ), '[]'::jsonb) END
          ) ORDER BY t.priority_rank NULLS LAST, t.name)
          FROM public.club_teams t
          WHERE t.cohort_id = cc.id AND t.archived_at IS NULL
        ), '[]'::jsonb)
      ) ORDER BY cc.name)
      FROM public.club_cohorts cc
      WHERE cc.club_id = v_row.club_id AND cc.active = true
    ), '[]'::jsonb),
    'leagues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'league_id', cl.id, 'name', cl.name, 'season_label', cl.season_label,
        'fixtures', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'our_team',       COALESCE(f.club_team_name, ct.name),
            'opponent',       f.opponent_name,
            'is_home',        f.is_home,
            'scheduled_date', f.scheduled_date,
            'kickoff_time',   to_char(f.kickoff_time, 'HH24:MI'),
            'home_score',     f.home_score,
            'away_score',     f.away_score,
            'status',         f.status
          ) ORDER BY f.scheduled_date NULLS LAST, f.kickoff_time NULLS LAST)
          FROM public.club_fixtures f
          LEFT JOIN public.club_teams ct ON ct.id = f.club_team_id
          WHERE f.league_id = cl.id AND f.status <> 'void'
        ), '[]'::jsonb)
      ) ORDER BY cl.created_at)
      FROM public.club_leagues cl
      WHERE cl.club_id = v_row.club_id AND cl.archived_at IS NULL
    ), '[]'::jsonb),
    -- sponsors carry tier (headline|match|supporter|null) for the tiered wall
    'sponsors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sponsor_id', s.id, 'name', s.name,
        'logo_url', s.logo_url, 'website_url', s.website_url, 'tier', s.tier
      ) ORDER BY s.display_order, s.name)
      FROM public.club_sponsors s
      WHERE s.club_id = v_row.club_id AND s.active = true
    ), '[]'::jsonb),
    'news', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'post_id', p.id, 'slug', p.slug, 'title', p.title, 'body', p.body,
        'hero_url', p.hero_url, 'author_name', p.author_name,
        'published_at', p.published_at
      ) ORDER BY p.published_at DESC NULLS LAST)
      FROM public.club_posts p
      WHERE p.club_id = v_row.club_id AND p.status = 'published'
    ), '[]'::jsonb),
    'tournaments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', te.slug, 'name', te.name, 'status', te.status, 'event_date', te.event_date
      ) ORDER BY te.event_date DESC NULLS LAST)
      FROM public.tournament_events te
      WHERE te.club_id = v_row.club_id AND te.status <> 'draft'
    ), '[]'::jsonb),
    -- get-involved CTAs off club_pages.links ([{label,url}])
    'getInvolved', COALESCE(v_row.links, '[]'::jsonb),
    -- P5b: contacts — clubs.contact_* + committee (welfare officer foregrounded)
    'contacts', jsonb_build_object(
      'contact_name',  v_row.club_contact_name,
      'contact_email', v_row.club_contact_email,
      'welfareOfficer', (
        SELECT jsonb_build_object('name', cm.name, 'email', cm.email)
        FROM public.club_committee cm
        WHERE cm.club_id = v_row.club_id AND cm.is_welfare = true
        ORDER BY cm.display_order, cm.name
        LIMIT 1
      ),
      'committee', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('role', cm.role, 'name', cm.name, 'email', cm.email)
                 ORDER BY cm.display_order, cm.name)
        FROM public.club_committee cm
        WHERE cm.club_id = v_row.club_id AND cm.is_welfare = false
      ), '[]'::jsonb)
    ),
    -- P5b: documents — type<-doc_type, size<-size_label (P4 DocumentsSection shape)
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', d.title, 'url', d.url, 'type', d.doc_type, 'size', d.size_label
      ) ORDER BY d.display_order, d.created_at)
      FROM public.club_documents d WHERE d.club_id = v_row.club_id
    ), '[]'::jsonb),
    -- P5b: events — date<-event_date (P4 EventsSection shape)
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', e.title, 'date', e.event_date, 'blurb', e.blurb
      ) ORDER BY e.event_date NULLS LAST, e.display_order)
      FROM public.club_events e WHERE e.club_id = v_row.club_id
    ), '[]'::jsonb),
    -- P5b: stats — manager-pick POTM only, keyed by team_id. Top-scorer DEFERRED
    -- (null), reliability SKIPPED ([]). Youth teams suppressed entirely + all stats
    -- suppressed when hide_public_rosters: under-18s are never named publicly.
    'stats', CASE WHEN v_hide_rosters THEN '{}'::jsonb ELSE COALESCE((
      SELECT jsonb_object_agg(t.id::text, jsonb_build_object(
        'potm', jsonb_build_object('name', pm.name, 'month', pm.month),
        'topScorer', NULL,
        'reliability', '[]'::jsonb
      ))
      FROM public.club_teams t
      JOIN public.club_team_potm pm ON pm.team_id = t.id
      LEFT JOIN public.club_cohorts cc ON cc.id = t.cohort_id
      WHERE t.club_id = v_row.club_id
        AND t.archived_at IS NULL
        AND NOT (COALESCE(cc.category,'') = 'youth'
                 OR (cc.max_age IS NOT NULL AND cc.max_age < v_min_age))
    ), '{}'::jsonb) END
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_club_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_club_public(text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. DEMO SEED — club_demo (Finbar's FC). Idempotent, fixed ids. Lights up the
--    public page (/c/finbars-fc) so the new modules render for review + Playwright.
--    First Team (Adults) gets a POTM; U12 Falcons is youth -> suppressed by the gate.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.club_committee (id, club_id, role, name, email, is_welfare, display_order) VALUES
  ('d9000000-0000-4000-8000-000000000001','club_demo','Welfare & Safeguarding Officer','Maria Walsh','welfare@demo.inorout.com', true, 0),
  ('d9000000-0000-4000-8000-000000000002','club_demo','Fixtures Secretary','Sean Murphy','fixtures@demo.inorout.com', false, 1),
  ('d9000000-0000-4000-8000-000000000003','club_demo','Chairperson','Derek Coyle','chair@demo.inorout.com', false, 2),
  ('d9000000-0000-4000-8000-000000000004','club_demo','Treasurer','Aoife Brennan',NULL, false, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.club_documents (id, club_id, title, url, doc_type, size_label, display_order) VALUES
  ('da000000-0000-4000-8000-000000000001','club_demo','Club Constitution','https://app.in-or-out.com/docs/constitution.pdf','Policy','180 KB', 0),
  ('da000000-0000-4000-8000-000000000002','club_demo','Code of Conduct','https://app.in-or-out.com/docs/code-of-conduct.pdf','Policy','96 KB', 1),
  ('da000000-0000-4000-8000-000000000003','club_demo','Safeguarding Policy','https://app.in-or-out.com/docs/safeguarding.pdf','Policy','240 KB', 2),
  ('da000000-0000-4000-8000-000000000004','club_demo','Membership Form 2026','https://app.in-or-out.com/docs/membership-form.pdf','Form','120 KB', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.club_events (id, club_id, title, event_date, blurb, display_order) VALUES
  ('db000000-0000-4000-8000-000000000001','club_demo','End of Season Awards Night', DATE '2026-07-18','Presentation evening at the clubhouse — all welcome.', 0),
  ('db000000-0000-4000-8000-000000000002','club_demo','Summer Fundraiser BBQ', DATE '2026-08-02','Family day with raffle and five-a-side.', 1),
  ('db000000-0000-4000-8000-000000000003','club_demo','Pre-season Open Training', DATE '2026-08-15','New players welcome — come down and try out.', 2)
ON CONFLICT (id) DO NOTHING;

-- First Team only (Adults cohort). U12 Falcons deliberately left unset.
INSERT INTO public.club_team_potm (team_id, club_id, name, month, updated_at) VALUES
  ('c0000000-0000-4000-8000-000000000001','club_demo','Jordan Hayes','June 2026', now())
ON CONFLICT (team_id) DO NOTHING;
