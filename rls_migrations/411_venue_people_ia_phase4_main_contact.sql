-- 411_venue_people_ia_phase4_main_contact.sql
--
-- Venue People & Spaces IA — Phase 4 (settable team contacts).
--
-- A team gets TWO settable contact slots — a primary ("main") and a secondary —
-- each pointing at an existing person (never free text). The contact source differs
-- by team kind (operator decision s188):
--   * LEAGUE teams  → a `venue_customers` person (the booker/organiser; the league
--     roster lives on the casual side of the consent wall, not in venue_customers).
--   * CLUB teams    → one of THAT team's active staff (manager / assistant_manager /
--     coach from `club_team_managers` → `member_profiles`).
-- So the link is polymorphic on the contact side (contact_kind customer|member).
--
--   * venue_team_contacts               — link table (primary + secondary per team)
--   * venue_set_team_main_contact(...)  — WRITE: set/clear a rank, gated, audited
--   * venue_list_active_teams(...)      — EXTENDED additively: main_contact + secondary_contact
--   * venue_list_club_teams(...)        — EXTENDED additively: main_contact + secondary_contact
--   * venue_assign_team_manager(...)    — RELAXED: assignable if active member OR a
--     guardian of a member in the club (so a parent can be made a coach → then a contact)
--
-- Write gated: manage_memberships OR manage_facility. SECDEF; search_path pinned;
-- single overloads; venue_* granted anon + authenticated (venue admin = anon + token).
--
-- Forward consumers (Hard Rule #14): apps/venue Teams page (League + Club tabs —
-- Main + Secondary contact columns, filter, ContactPicker). The main_contact /
-- secondary_contact keys on both readers are available to any later venue/HQ consumer.

-- Drop the first-pass objects (this migration supersedes the initial single-slot
-- customer-only design before it ever reached main).
DROP FUNCTION IF EXISTS public.venue_set_team_main_contact(text, text, text, uuid);
DROP TABLE IF EXISTS public.venue_team_main_contacts;

-- ── 1. link table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_team_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  team_kind    text NOT NULL CHECK (team_kind IN ('league','club')),
  team_id      text NOT NULL,
  contact_rank text NOT NULL CHECK (contact_rank IN ('primary','secondary')),
  contact_kind text NOT NULL CHECK (contact_kind IN ('customer','member')),
  contact_id   uuid NOT NULL,   -- customer → venue_customers.id; member → member_profiles.id (polymorphic, no FK)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, team_kind, team_id, contact_rank)
);

CREATE INDEX IF NOT EXISTS idx_venue_team_contacts_contact
  ON public.venue_team_contacts (contact_kind, contact_id);

-- All access via SECURITY DEFINER RPCs; RLS on with no policies = direct client
-- access blocked (matches the platform-wide locked-table convention).
ALTER TABLE public.venue_team_contacts ENABLE ROW LEVEL SECURITY;

-- ── 2. write: set/clear a team's contact (primary or secondary) ───────────────
CREATE OR REPLACE FUNCTION public.venue_set_team_main_contact(
  p_venue_token text,
  p_team_kind   text,
  p_team_id     text,
  p_contact_rank text,
  p_contact_id  uuid DEFAULT NULL)   -- NULL = clear that rank
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller       record;
  v_venue_id     text;
  v_name         text;
  v_owns         boolean;
  v_contact_kind text;
  v_other_rank   text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT (public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships')
       OR public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility')) THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_kind NOT IN ('league','club') THEN
    RAISE EXCEPTION 'invalid_team_kind' USING ERRCODE = 'P0001';
  END IF;
  IF p_contact_rank NOT IN ('primary','secondary') THEN
    RAISE EXCEPTION 'invalid_contact_rank' USING ERRCODE = 'P0001';
  END IF;
  IF NULLIF(btrim(COALESCE(p_team_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'team_id_required' USING ERRCODE = 'P0001';
  END IF;

  v_contact_kind := CASE p_team_kind WHEN 'league' THEN 'customer' ELSE 'member' END;
  v_other_rank   := CASE p_contact_rank WHEN 'primary' THEN 'secondary' ELSE 'primary' END;

  -- the team must belong to the caller's venue
  IF p_team_kind = 'league' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.teams te
      JOIN public.competition_teams ct ON ct.team_id = te.id
      JOIN public.competitions c       ON c.id = ct.competition_id
      JOIN public.seasons s            ON s.id = c.season_id
      JOIN public.leagues l            ON l.id = s.league_id
      WHERE te.id = p_team_id AND l.venue_id = v_venue_id
    ) INTO v_owns;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.club_teams cte
      JOIN public.club_venues cv ON cv.club_id = cte.club_id
      WHERE cte.id::text = p_team_id AND cv.venue_id = v_venue_id
    ) INTO v_owns;
  END IF;
  IF NOT COALESCE(v_owns, false) THEN
    RAISE EXCEPTION 'team_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  -- clear
  IF p_contact_id IS NULL THEN
    DELETE FROM public.venue_team_contacts
     WHERE venue_id = v_venue_id AND team_kind = p_team_kind
       AND team_id = p_team_id AND contact_rank = p_contact_rank;

    INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'venue_team_contact_cleared', 'venue_team_contact', p_team_id,
            jsonb_build_object('venue_id', v_venue_id, 'team_kind', p_team_kind, 'contact_rank', p_contact_rank));

    RETURN jsonb_build_object('ok', true, 'contact_rank', p_contact_rank, 'contact_id', NULL, 'name', NULL);
  END IF;

  -- the same person can't hold both slots on one team
  IF EXISTS (
    SELECT 1 FROM public.venue_team_contacts
    WHERE venue_id = v_venue_id AND team_kind = p_team_kind
      AND team_id = p_team_id AND contact_rank = v_other_rank AND contact_id = p_contact_id
  ) THEN
    RAISE EXCEPTION 'contact_already_other_rank' USING ERRCODE = 'P0001';
  END IF;

  -- validate the contact + resolve its display name
  IF v_contact_kind = 'customer' THEN
    SELECT TRIM(BOTH ' ' FROM COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
      INTO v_name
      FROM public.venue_customers
     WHERE id = p_contact_id AND venue_id = v_venue_id AND status <> 'erased';
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'customer_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- club: the contact MUST be an active manager / assistant_manager / coach of THAT team
    SELECT TRIM(BOTH ' ' FROM COALESCE(mp.first_name, '') || ' ' || COALESCE(mp.last_name, ''))
      INTO v_name
      FROM public.club_team_managers ctm
      JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
     WHERE ctm.team_id = p_team_id::uuid
       AND ctm.member_profile_id = p_contact_id
       AND COALESCE(ctm.is_active, true)
       AND ctm.role IN ('manager','assistant_manager','coach');
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'contact_not_team_staff' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.venue_team_contacts (venue_id, team_kind, team_id, contact_rank, contact_kind, contact_id)
  VALUES (v_venue_id, p_team_kind, p_team_id, p_contact_rank, v_contact_kind, p_contact_id)
  ON CONFLICT (venue_id, team_kind, team_id, contact_rank)
  DO UPDATE SET contact_kind = EXCLUDED.contact_kind, contact_id = EXCLUDED.contact_id, updated_at = now();

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_team_contact_set', 'venue_team_contact', p_team_id,
          jsonb_build_object('venue_id', v_venue_id, 'team_kind', p_team_kind, 'contact_rank', p_contact_rank,
                             'contact_kind', v_contact_kind, 'contact_id', p_contact_id));

  RETURN jsonb_build_object('ok', true, 'contact_rank', p_contact_rank,
                            'contact_kind', v_contact_kind, 'contact_id', p_contact_id, 'name', v_name);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_set_team_main_contact(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_set_team_main_contact(text, text, text, text, uuid) TO anon, authenticated;

-- ── 3. venue_list_active_teams: + main_contact + secondary_contact (additive) ──
CREATE OR REPLACE FUNCTION public.venue_list_active_teams(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', t.id,
    'name', t.name,
    'primary_colour', t.primary_colour,
    'secondary_colour', t.secondary_colour,
    'competition_count', t.comp_count,
    'last_active_at', t.last_seen,
    'main_contact',      public._venue_team_contact_json(v_venue_id, 'league', t.id, 'primary'),
    'secondary_contact', public._venue_team_contact_json(v_venue_id, 'league', t.id, 'secondary')
  ) ORDER BY t.name), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT te.id, te.name, te.primary_colour, te.secondary_colour,
           count(DISTINCT ct.competition_id) AS comp_count,
           max(ct.registered_at) AS last_seen
    FROM teams te
    JOIN competition_teams ct ON ct.team_id = te.id
    JOIN competitions c ON c.id = ct.competition_id
    JOIN seasons s ON s.id = c.season_id
    JOIN leagues l ON l.id = s.league_id
    WHERE l.venue_id = v_venue_id
      AND ct.status IN ('active','pending')
      AND te.team_type = 'competitive'
    GROUP BY te.id, te.name, te.primary_colour, te.secondary_colour
  ) t;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_list_active_teams(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_active_teams(text) TO anon, authenticated;

-- ── 3b. shared resolver: a team-contact slot as { contact_id, name } | null ───
-- One reader resolves either contact kind (customer → venue_customers, member →
-- member_profiles) so both team readers stay in lockstep. STABLE; internal.
CREATE OR REPLACE FUNCTION public._venue_team_contact_json(
  p_venue_id text, p_team_kind text, p_team_id text, p_contact_rank text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN tc.contact_kind = 'customer' THEN (
      SELECT jsonb_build_object('contact_id', vc.id, 'kind', 'customer',
               'name', TRIM(BOTH ' ' FROM COALESCE(vc.first_name,'') || ' ' || COALESCE(vc.last_name,'')))
      FROM public.venue_customers vc WHERE vc.id = tc.contact_id)
    WHEN tc.contact_kind = 'member' THEN (
      SELECT jsonb_build_object('contact_id', mp.id, 'kind', 'member',
               'name', TRIM(BOTH ' ' FROM COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')),
               'role', (SELECT ctm.role FROM public.club_team_managers ctm
                          WHERE ctm.team_id = tc.team_id::uuid
                            AND ctm.member_profile_id = mp.id
                          ORDER BY COALESCE(ctm.is_active, true) DESC LIMIT 1))
      FROM public.member_profiles mp WHERE mp.id = tc.contact_id)
    ELSE NULL END
  FROM public.venue_team_contacts tc
  WHERE tc.venue_id = p_venue_id AND tc.team_kind = p_team_kind
    AND tc.team_id = p_team_id AND tc.contact_rank = p_contact_rank;
$function$;
-- Internal helper — called only by the SECDEF readers (as owner). Lock out anon +
-- authenticated (Supabase default privileges auto-grant EXECUTE on new functions).
REVOKE ALL ON FUNCTION public._venue_team_contact_json(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._venue_team_contact_json(text, text, text, text) FROM anon, authenticated;

-- ── 4. venue_list_club_teams: + main_contact + secondary_contact (additive) ───
CREATE OR REPLACE FUNCTION public.venue_list_club_teams(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_teams jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id',         ct.id,
    'club_id',         ct.club_id,
    'club_name',       cl.name,
    'cohort_id',       ct.cohort_id,
    'cohort_name',     cc.name,
    'cohort_category', cc.category,
    'name',            ct.name,
    'gender',          ct.gender,
    'priority_rank',   ct.priority_rank,
    'member_count',    (SELECT count(*) FROM public.club_team_members m
                          WHERE m.team_id = ct.id AND COALESCE(m.is_active, true)),
    'main_contact',      public._venue_team_contact_json(v_venue_id, 'club', ct.id::text, 'primary'),
    'secondary_contact', public._venue_team_contact_json(v_venue_id, 'club', ct.id::text, 'secondary'),
    'created_at',      ct.created_at
  ) ORDER BY cl.name, cc.name, ct.priority_rank NULLS LAST, ct.name), '[]'::jsonb)
  INTO v_teams
  FROM public.club_venues cv
  JOIN public.clubs cl       ON cl.id = cv.club_id
  JOIN public.club_teams ct  ON ct.club_id = cv.club_id
  JOIN public.club_cohorts cc ON cc.id = ct.cohort_id
  WHERE cv.venue_id = v_venue_id
    AND ct.archived_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'teams', v_teams);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_list_club_teams(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_club_teams(text) TO anon, authenticated;

-- ── 5. venue_assign_team_manager: allow a member OR a guardian of a member ─────
-- (relaxes the mig-305 'member_not_enrolled' guard so a parent/guardian can be
-- made a coach — and then chosen as a club team's contact). Signature unchanged.
CREATE OR REPLACE FUNCTION public.venue_assign_team_manager(
  p_token             text,
  p_team_id           uuid,
  p_member_profile_id uuid,
  p_role              text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_club_id   text;
  v_manager_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF p_role NOT IN ('manager','assistant_manager','coach') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE='P0001';
  END IF;

  -- Confirm team belongs to a club at this venue
  SELECT ct.club_id INTO v_club_id
  FROM public.club_teams ct
  JOIN public.club_venues cv ON cv.club_id = ct.club_id
  WHERE ct.id = p_team_id AND cv.venue_id = v_venue_id;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001';
  END IF;

  -- Member must be an active member of this club, OR a guardian of one
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.venue_memberships
      WHERE member_profile_id = p_member_profile_id
        AND club_id = v_club_id
        AND status IN ('active','ending')
    )
    OR EXISTS (
      SELECT 1
      FROM public.member_guardians mg
      JOIN public.venue_memberships vm ON vm.member_profile_id = mg.child_profile_id
      WHERE mg.guardian_profile_id = p_member_profile_id
        AND vm.club_id = v_club_id
        AND vm.status IN ('active','ending')
    )
  ) THEN
    RAISE EXCEPTION 'member_not_enrolled' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.club_team_managers (team_id, member_profile_id, role, is_active)
  VALUES (p_team_id, p_member_profile_id, p_role, true)
  ON CONFLICT (team_id, member_profile_id)
    DO UPDATE SET role = p_role, is_active = true, assigned_at = now()
  RETURNING id INTO v_manager_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'staff_assigned', 'club_team_manager', v_manager_id::text,
          jsonb_build_object('team_id', p_team_id, 'member_profile_id', p_member_profile_id, 'role', p_role));

  RETURN jsonb_build_object('ok', true, 'manager_id', v_manager_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_assign_team_manager(text, uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_assign_team_manager(text, uuid, uuid, text) TO anon, authenticated;
