-- 527: Manager /hub build-out P6 — coach-auth team join link.
--
-- A coach can now generate/share a join link for a team they manage, straight from the
-- phone. The venue-token twin club_ensure_team_invite_link (mig 390) requires a venue
-- token — a coach holds none (their credential is auth.uid → club_team_managers), so they
-- couldn't reach it. This adds the coach-auth twin: SAME invite_links row / code space /
-- action ('join_club_team'), so a link a coach creates is byte-identical to one an admin
-- creates and resolves through the SAME public /q/<code> → club_team_join_context flow.
--
-- Auth: auth.uid → member_profiles → active club_team_managers for p_team_id (a coach can
-- only mint a link for a team they actively manage). SECURITY DEFINER, search_path pinned,
-- single overload, REVOKE anon (authenticated-only — no anon path, unlike the venue twin
-- which anon-checks via a token). Get-or-create is idempotent (returns the existing active
-- code if present). Audit on create (Hard Rule 9), coach actor pattern (mig 412: actor_type
-- 'player', team_id '_system', actor_identifier = the coach's name).
--
-- Consumers (Hard Rule #14): apps/inorout TeamManagerPeople.jsx (/hub people tab — "Share
-- join link"). Public resolver of the code is unchanged (club_team_join_context, mig 391).

CREATE OR REPLACE FUNCTION public.club_manager_ensure_team_invite_link(p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile record;
  v_club_id text;
  v_code    text;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id, first_name, last_name INTO v_profile
  FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- caller must ACTIVELY manage this team
  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM public.club_teams WHERE id = p_team_id;

  -- get-or-create the canonical ACTIVE join code for this club team (SAME row space as the
  -- venue-token twin, so admin- and coach-minted links are interchangeable).
  SELECT code INTO v_code FROM public.invite_links
   WHERE entity_type = 'club_team' AND entity_id = p_team_id::text
     AND action = 'join_club_team' AND active = true
   ORDER BY created_at ASC LIMIT 1;

  IF v_code IS NULL THEN
    v_code := generate_url_safe_token('q_', 8);
    INSERT INTO public.invite_links (code, entity_type, entity_id, action, created_by)
    VALUES (v_code, 'club_team', p_team_id::text, 'join_club_team', v_uid::text);
    v_created := true;

    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES ('_system', v_uid, 'player',
            v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
            'manager_invite_link_created', 'club_team', p_team_id::text,
            jsonb_build_object('code', v_code, 'link_action', 'join_club_team', 'club_id', v_club_id));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'code', v_code, 'entity_type', 'club_team',
    'entity_id', p_team_id, 'action', 'join_club_team', 'created', v_created);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_ensure_team_invite_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_ensure_team_invite_link(uuid) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
