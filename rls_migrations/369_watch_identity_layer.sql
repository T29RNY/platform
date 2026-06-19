-- Migration 369 — watchOS companion: ref/official IDENTITY LAYER (Phase 1)
--
-- Net-new, purely additive backend. No client wiring; invisible to every
-- existing surface until the watch ships. The unlock for "what's my next
-- relevant game?" resolved from the signed-in Supabase identity.
--
-- TWO IDENTITY ARMS, ONE RESOLVER (see DECISIONS.md s161 + the plan):
--   • LEAGUE / club-fixture arm — the OFFICIAL model. A venue creates a
--     `match_officials` card; a real person links to it (self-claim by verified
--     email, option A primary) or the operator binds it. Resolve:
--       auth.uid() → match_officials.user_id → fixtures.official_id → ref_token
--   • CASUAL arm — the PLAYER model. NO match_officials, NO new claim RPC:
--     the squad member IS the identity (`players.user_id`, already linked via
--     the existing `link_player_to_user`). A squad admin assigns one squad
--     member as that game's ref (per-game, changeable). Resolve:
--       auth.uid() → players.user_id → players.id → matches.ref_player_id → ref_token
--
-- Club-cohort officiating folds into the fixture arm: `club_cohorts.
-- primary_official_id` is a DEFAULT-OFFICIAL convenience (no separate resolver
-- arm — a cohort fixture is just a fixture). Refereeing of `club_sessions`
-- themselves is net-new and deferred to Phase 6.
--
-- The casual `matches.ref_token` is RESERVED now (drives nothing until Phase 5
-- builds casual ref-writes) so the resolver return shape is locked early —
-- Swift CodingKeys stay stable (Hard Rule #12).
--
-- All write RPCs: SECURITY DEFINER, search_path pinned, audit_events insert
-- (Hard Rule #9). Consumers: the watchOS companion app (Hard Rule #14) — see
-- RPCS.md. Verified via rpc-security-sweep + ephemeral-verify (_e2e_ only).

-- ─── SCHEMA: identity columns (additive, nullable) ───────────────────────────

-- League/club-fixture arm: a real person behind an official card.
ALTER TABLE public.match_officials
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS match_officials_user_id_idx
  ON public.match_officials (user_id) WHERE user_id IS NOT NULL;

-- Club-cohort default-official binding (convenience for fixture auto-assign).
ALTER TABLE public.club_cohorts
  ADD COLUMN IF NOT EXISTS primary_official_id uuid
    REFERENCES public.match_officials(id) ON DELETE SET NULL;

-- Casual arm: per-game assigned ref + a reserved ref_token (Phase-5 driver).
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS ref_player_id text REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ref_token     text;
CREATE UNIQUE INDEX IF NOT EXISTS matches_ref_token_uniq
  ON public.matches (ref_token) WHERE ref_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS matches_ref_player_id_idx
  ON public.matches (ref_player_id) WHERE ref_player_id IS NOT NULL;

-- ─── RPC: ref self-claim by verified email (option A — primary) ───────────────
-- Authenticated only. Links EVERY match_officials card whose email matches the
-- caller's verified auth email and is not yet linked. One human can be an
-- official at many venues under the same email → all link to their auth.uid().

CREATE OR REPLACE FUNCTION public.ref_link_self_to_official()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_email     text;
  v_ids_json  jsonb;
  v_count     int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_email', 'linked_count', 0);
  END IF;

  WITH upd AS (
    UPDATE public.match_officials mo
       SET user_id = v_uid
     WHERE lower(mo.email) = v_email
       AND mo.user_id IS NULL
    RETURNING mo.id, mo.venue_id
  ), ins AS (
    INSERT INTO public.audit_events (
      team_id, actor_user_id, actor_type, actor_identifier,
      action, entity_type, entity_id, metadata
    )
    SELECT venue_id, v_uid, 'referee', v_email,
           'official_self_linked', 'match_official', id::text,
           jsonb_build_object('via', 'email_match')
    FROM upd
  )
  SELECT coalesce(jsonb_agg(u.id::text), '[]'::jsonb), count(*)
    INTO v_ids_json, v_count
    FROM upd u;

  RETURN jsonb_build_object(
    'ok', true,
    'linked_count', v_count,
    'official_ids', v_ids_json
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_link_self_to_official() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ref_link_self_to_official() TO authenticated;

-- ─── RPC: operator binds an official card to a user (option A — operator) ─────
-- Venue-token gated. Binds match_officials.user_id to whichever auth user owns
-- p_email. If no account exists for that email yet, no-op ok:false (the card
-- keeps its email; the ref self-claims later).

CREATE OR REPLACE FUNCTION public.venue_link_official_to_user(
  p_venue_token text,
  p_official_id uuid,
  p_email       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_official record;
  v_target uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT id, venue_id INTO v_official
  FROM public.match_officials WHERE id = p_official_id;
  IF v_official.id IS NULL OR v_official.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'official_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_target FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_account_for_email');
  END IF;

  UPDATE public.match_officials SET user_id = v_target WHERE id = p_official_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'official_linked_by_operator', 'match_official', p_official_id::text,
    jsonb_build_object('linked_user_id', v_target, 'email', lower(p_email))
  );

  RETURN jsonb_build_object('ok', true, 'official_id', p_official_id, 'user_id', v_target);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_link_official_to_user(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_link_official_to_user(text, uuid, text) TO anon, authenticated;

-- ─── RPC: assign a casual squad member as this game's ref (operator) ──────────
-- Admin-token gated. Per-game, changeable. Pass NULL player to clear. Mints the
-- match's ref_token on first assignment (kept stable thereafter; drives nothing
-- until Phase 5). If the assigned player hasn't linked their account yet, the
-- assignment still records and surfaces on their watch once they claim.

CREATE OR REPLACE FUNCTION public.assign_casual_match_ref(
  p_admin_token text,
  p_match_id    text,
  p_player_id   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_team_id text;
  v_match record;
  v_prev text;
  v_token text;
  v_action text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_admin_caller(p_admin_token);
  IF v_caller IS NULL OR v_caller.team_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_token' USING ERRCODE = 'P0001';
  END IF;
  v_team_id := v_caller.team_id;

  SELECT id, team_id, ref_player_id, ref_token INTO v_match
  FROM public.matches WHERE id = p_match_id;
  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_match.team_id <> v_team_id THEN
    RAISE EXCEPTION 'match_not_in_team' USING ERRCODE = 'P0001';
  END IF;
  v_prev := v_match.ref_player_id;

  IF p_player_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.team_players tp
       JOIN public.players p ON p.id = tp.player_id
      WHERE tp.team_id = v_team_id AND tp.player_id = p_player_id
        AND COALESCE(p.disabled, false) = false
    ) THEN
      RAISE EXCEPTION 'player_not_in_team' USING ERRCODE = 'P0001', DETAIL = p_player_id;
    END IF;
    v_token := COALESCE(v_match.ref_token, gen_random_uuid()::text);
    v_action := CASE WHEN v_prev IS NULL THEN 'casual_ref_assigned' ELSE 'casual_ref_changed' END;
  ELSE
    v_token := v_match.ref_token;  -- keep token; clearing only removes the assignment
    v_action := 'casual_ref_cleared';
  END IF;

  UPDATE public.matches
     SET ref_player_id = p_player_id,
         ref_token     = v_token
   WHERE id = p_match_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    v_action, 'match', p_match_id,
    jsonb_build_object('ref_player_id', p_player_id, 'previous_ref_player_id', v_prev)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'match_id', p_match_id,
    'ref_player_id', p_player_id,
    'ref_token', v_token
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_casual_match_ref(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_casual_match_ref(text, text, text) TO anon, authenticated;

-- ─── RPC: bind a cohort's default official (venue) ───────────────────────────
-- Venue-token gated; the caller's venue must be in the cohort's club (club_venues).
-- Pass NULL official to clear. Default-assignment convenience; no resolver arm.

CREATE OR REPLACE FUNCTION public.club_admin_assign_cohort_official(
  p_venue_token text,
  p_cohort_id   uuid,
  p_official_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_club_id text;
  v_prev uuid;
  v_action text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT club_id, primary_official_id INTO v_club_id, v_prev
  FROM public.club_cohorts WHERE id = p_cohort_id;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = v_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'cohort_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  IF p_official_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.match_officials
      WHERE id = p_official_id AND venue_id = v_venue_id AND active = true
    ) THEN
      RAISE EXCEPTION 'official_unavailable' USING ERRCODE = 'P0001', DETAIL = p_official_id::text;
    END IF;
  END IF;

  UPDATE public.club_cohorts SET primary_official_id = p_official_id WHERE id = p_cohort_id;

  v_action := CASE
    WHEN v_prev IS NULL AND p_official_id IS NOT NULL THEN 'cohort_official_assigned'
    WHEN v_prev IS NOT NULL AND p_official_id IS NULL THEN 'cohort_official_cleared'
    ELSE 'cohort_official_changed' END;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    v_action, 'club_cohort', p_cohort_id::text,
    jsonb_build_object('club_id', v_club_id, 'official_id', p_official_id, 'previous_official_id', v_prev)
  );

  RETURN jsonb_build_object('ok', true, 'cohort_id', p_cohort_id, 'official_id', p_official_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_admin_assign_cohort_official(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_admin_assign_cohort_official(text, uuid, uuid) TO anon, authenticated;

-- ─── RPC: get_my_next_assignment — THE resolver (the watch home screen) ───────
-- Authenticated only. auth.uid() → next relevant game across all contexts WITH
-- the ref_token to drive it. Tie-break: in-progress > soonest kickoff > role
-- priority (league=1, casual=2). Returns the chosen `next` + the full ordered
-- `games` list + `game_count` so the watch shows a "you have N games" chooser
-- and never silently picks.
--
-- RETURN SHAPE (locked — Swift CodingKeys depend on it; Hard Rule #12):
--   { ok, game_count, next: <game|null>, games: [<game>...] }
--   game = { context, role, ref_token, game_id, kickoff_at, status,
--            is_in_progress, venue_name, home_team, away_team, squad_name }

CREATE OR REPLACE FUNCTION public.get_my_next_assignment(p_role_filter text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_games  jsonb;
  v_next   jsonb;
  v_count  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  WITH fixture_arm AS (
    SELECT
      'league'::text AS context,
      'referee'::text AS role,
      1 AS role_priority,
      f.ref_token,
      f.id::text AS game_id,
      ((f.scheduled_date + COALESCE(f.kickoff_time, time '00:00'))
         AT TIME ZONE 'Europe/London') AS kickoff_at,
      f.status,
      (f.status = 'in_progress') AS is_in_progress,
      COALESCE(va.name, mv.name) AS venue_name,
      ht.name AS home_team,
      at.name AS away_team,
      NULL::text AS squad_name
    FROM public.fixtures f
    JOIN public.match_officials mo ON mo.id = f.official_id AND mo.user_id = v_uid
    JOIN public.teams ht ON ht.id = f.home_team_id
    LEFT JOIN public.teams at ON at.id = f.away_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    LEFT JOIN public.venues va ON va.id = pa.venue_id
    LEFT JOIN public.venues mv ON mv.id = mo.venue_id
    WHERE f.status IN ('scheduled', 'allocated', 'in_progress')
      AND (f.status = 'in_progress'
           OR f.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date)
      AND (p_role_filter IS NULL OR p_role_filter = 'league')
  ),
  casual_arm AS (
    SELECT
      'casual'::text AS context,
      'referee'::text AS role,
      2 AS role_priority,
      m.ref_token,
      m.id::text AS game_id,
      s.game_date_time AS kickoff_at,
      (CASE WHEN COALESCE(s.game_is_live, false) AND m.winner IS NULL
            THEN 'in_progress' ELSE 'scheduled' END)::text AS status,
      (COALESCE(s.game_is_live, false) AND m.winner IS NULL) AS is_in_progress,
      s.venue AS venue_name,
      'Team A'::text AS home_team,
      'Team B'::text AS away_team,
      t.name AS squad_name
    FROM public.matches m
    JOIN public.players p ON p.id = m.ref_player_id AND p.user_id = v_uid
    JOIN public.teams t ON t.id = m.team_id
    LEFT JOIN public.schedule s ON s.active_match_id = m.id
    WHERE m.winner IS NULL
      AND COALESCE(m.cancelled, false) = false
      AND (
        COALESCE(s.game_is_live, false) = true
        OR (s.game_date_time IS NOT NULL
            AND s.game_date_time >= (now() AT TIME ZONE 'Europe/London')::date::timestamptz - interval '6 hours')
        OR (s.game_date_time IS NULL AND m.match_date >= (now() AT TIME ZONE 'Europe/London')::date)
      )
      AND (p_role_filter IS NULL OR p_role_filter = 'casual')
  ),
  unioned AS (
    SELECT * FROM fixture_arm
    UNION ALL
    SELECT * FROM casual_arm
  ),
  ordered AS (
    SELECT u.*,
           row_number() OVER (
             ORDER BY is_in_progress DESC, kickoff_at ASC NULLS LAST, role_priority ASC
           ) AS rn
    FROM unioned u
  )
  SELECT
    coalesce(jsonb_agg((to_jsonb(o) - 'rn' - 'role_priority') ORDER BY o.rn), '[]'::jsonb),
    (SELECT to_jsonb(o2) - 'rn' - 'role_priority' FROM ordered o2 WHERE o2.rn = 1),
    count(*)
  INTO v_games, v_next, v_count
  FROM ordered o;

  RETURN jsonb_build_object(
    'ok', true,
    'game_count', v_count,
    'next', v_next,
    'games', v_games
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_next_assignment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_next_assignment(text) TO authenticated;

-- ─── PostgREST cache reload (404 trap) ───────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');
