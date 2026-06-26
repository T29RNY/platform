-- 439_tournament_mobile_index_and_follow.sql
-- Mobile tournament/Cups (project_event_os mobile track):
--  1. list_venue_tournaments  — venue-scoped tournament index for operators
--     (existing club_admin_list_tournaments is CLUB-scoped + club_team_manager-gated;
--      operators carry a venue_id, so a venue-scoped sibling is needed). Auth mirrors
--      every other venue reader: resolve_venue_caller(p_venue_token) -> venue_id
--      (stage-1b: auth.uid() vs venue_admins; the operator passes role.entityId=venue_id).
--  2. tournament_follows table + tournament_set_team_follow (write) +
--     tournament_list_my_follows (read) — persisted "follow a team" for the
--     spectator screen. Keyed on auth.uid() (works for every role; no member_profile
--     dependency). Push alerts on a followed team's goal ride the later notifications
--     backend; the follow itself is fully live now.
-- The spectator view reuses the existing get_tournament_public(slug) — NO change there.
-- Consumers: list_venue_tournaments -> apps/inorout mobile OperatorTournaments (index);
--   tournament_set_team_follow / tournament_list_my_follows -> mobile TournamentView (RPCS.md #14).

-- ── 1. Venue-scoped tournament list (operator index) ─────────────────────────
CREATE OR REPLACE FUNCTION public.list_venue_tournaments(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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

  SELECT jsonb_build_object(
    'ok', true,
    'venue_id', v_venue_id,
    'tournaments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'tournament_id', te.id,
        'name', te.name,
        'slug', te.slug,
        'status', te.status,
        'event_date', te.event_date,
        'event_end_date', te.event_end_date,
        'entry_fee_pence', te.entry_fee_pence,
        'registration_open', (te.status = 'open'),
        'registration_deadline', te.registration_deadline,
        'club_id', te.club_id,
        'competitions', (SELECT count(*) FROM competitions c WHERE c.tournament_event_id = te.id),
        'teams', (SELECT count(*) FROM competition_teams ct JOIN competitions c ON c.id = ct.competition_id WHERE c.tournament_event_id = te.id),
        'live_count', (SELECT count(*) FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.tournament_event_id = te.id AND f.status = 'in_progress'),
        'completed_count', (SELECT count(*) FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.tournament_event_id = te.id AND f.status = 'completed')
      ) ORDER BY te.event_date DESC NULLS LAST, te.created_at DESC)
      FROM tournament_events te
      WHERE te.venue_id = v_venue_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_venue_tournaments(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_venue_tournaments(text) TO anon, authenticated;

-- ── 2. Follow-a-team: table (RPC-only, RLS on, no policies) ───────────────────
CREATE TABLE IF NOT EXISTS public.tournament_follows (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  competition_team_id uuid NOT NULL REFERENCES public.competition_teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, competition_team_id)
);
ALTER TABLE public.tournament_follows ENABLE ROW LEVEL SECURITY;

-- ── 2a. Follow / unfollow (write) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_set_team_follow(p_competition_team_id uuid, p_follow boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_club_id text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id INTO v_club_id
  FROM competition_teams ct
  JOIN competitions c ON c.id = ct.competition_id
  JOIN tournament_events te ON te.id = c.tournament_event_id
  WHERE ct.id = p_competition_team_id;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_follow THEN
    INSERT INTO tournament_follows (user_id, competition_team_id)
    VALUES (v_uid, p_competition_team_id)
    ON CONFLICT (user_id, competition_team_id) DO NOTHING;
  ELSE
    DELETE FROM tournament_follows
    WHERE user_id = v_uid AND competition_team_id = p_competition_team_id;
  END IF;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'system', NULL,
    'tournament_team_follow_set', 'competition_team', p_competition_team_id::text,
    jsonb_build_object('follow', p_follow)
  );

  RETURN jsonb_build_object('ok', true, 'following', p_follow);
END;
$function$;

REVOKE ALL ON FUNCTION public.tournament_set_team_follow(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tournament_set_team_follow(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.tournament_set_team_follow(uuid, boolean) TO authenticated;

-- ── 2b. List my follows for a tournament (read) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_list_my_follows(p_tournament_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'competition_team_ids', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok', true, 'competition_team_ids', COALESCE((
    SELECT jsonb_agg(tf.competition_team_id)
    FROM tournament_follows tf
    JOIN competition_teams ct ON ct.id = tf.competition_team_id
    JOIN competitions c ON c.id = ct.competition_id
    WHERE tf.user_id = v_uid AND c.tournament_event_id = p_tournament_event_id
  ), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.tournament_list_my_follows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tournament_list_my_follows(uuid) TO anon, authenticated;
