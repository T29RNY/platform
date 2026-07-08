-- 499_self_serve_retire_group_team.sql
--
-- Standalone Tournament Self-Serve epic — "Groups, then knockout" format, PR #1.
--
-- THE PROBLEM (MISSED in the groups→KO scope): venue_seed_knockout (mig 452:1057-1064)
-- refuses to seed the knockout unless EVERY group fixture is 'completed'. A team that
-- registers but doesn't turn up leaves all its group fixtures unplayable, so "Generate
-- knockout" throws incomplete_group_fixtures forever — a pitch-side dead end.
-- self_serve_enter_result (mig 493) only accepts two REAL scores, so the organiser can't
-- cleanly mark a no-show without inventing results that distort standings.
--
-- THE FIX: a one-tap "retire team" that walks over the team's outstanding GROUP fixtures
-- as conventional walkovers — status='completed' with real walkover scores — so the KO
-- gate clears AND the opponents are correctly credited in the standings CTE (which only
-- counts status='completed' fixtures with non-null scores).
--
-- WALKOVER CONVENTION (operator-confirmed): opponent 3-0. The 0-0 double-forfeit arm (both
-- sides 'withdrawn') is a DEFENSIVE fallback that is rarely reached in practice — because the
-- FIRST team to retire already completes the shared fixture (3-0 to the then-present
-- opponent), so by the time a second team in the same pairing retires that fixture is already
-- 'completed' and filtered out. Harmless either way: both withdrawn teams are excluded from
-- the qualifier ranking. The retiring team's competition_teams.status is flipped to
-- 'withdrawn' so it is excluded from that ranking (venue_seed_knockout picks qualifiers WHERE
-- status='active') — it can never wrongly advance.
--
-- STRAND GUARD (closes QA finding #1): a retire must leave the team's group with at least
-- qualifiers_per_group active teams, otherwise the group can no longer produce its
-- qualifiers and venue_seed_knockout would throw bracket_size_not_supported forever. mig
-- 498 enforces min (qpg+1) teams/group at seed, so the FIRST no-show per group always
-- passes; this guard trips only on a SECOND no-show concentrated in the same group — a
-- named v1 limitation (fully closing it needs a bye-padding KO seeder, deferred), surfaced
-- as a clear error rather than a silent dead-end.
--
-- POST-SEED GUARD (QA finding #2): retire is a group-stage action — refuse once the KO is
-- seeded (config.knockout_seeded), since the withdrawn team may already sit in the bracket.
--
-- WHY NOT venue_withdraw_team (mig 102): that is LEAGUE-mode — seasons→leagues auth,
-- fixtures.home_team_id (text), and it sets fixtures to 'walkover'/'void' (NOT 'completed'),
-- which would STILL fail venue_seed_knockout's `status <> 'completed'` gate. This RPC is
-- tournament-mode: _authorise_venue_tournament auth, home_competition_team_id matchups,
-- status='completed' + scores.
--
-- AUTH: derive the tournament_event_id from the competition_team's competition, then
-- _authorise_venue_tournament(p_venue_token, event) — same Stage-1b surface as mig 498.
-- authenticated-only.

CREATE OR REPLACE FUNCTION public.self_serve_retire_group_team(
  p_venue_token         text,
  p_competition_team_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth           record;
  v_comp_id        uuid;
  v_event_id       uuid;
  v_status         text;
  v_team_name      text;
  v_group_label    text;
  v_config         jsonb;
  v_qpg            int;
  v_group_active   int;
  v_walkover_count int := 0;
BEGIN
  IF p_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'competition_team_id_required' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve the team's competition, group, status + the owning tournament event and config.
  SELECT ct.competition_id, ct.status, ct.team_name, ct.group_label,
         c.tournament_event_id, c.config
  INTO v_comp_id, v_status, v_team_name, v_group_label, v_event_id, v_config
  FROM public.competition_teams ct
  JOIN public.competitions c ON c.id = ct.competition_id
  WHERE ct.id = p_competition_team_id
  FOR UPDATE OF ct;

  IF v_comp_id IS NULL THEN
    RAISE EXCEPTION 'registration_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_competition' USING ERRCODE = 'P0001';
  END IF;

  -- Authorise: caller owns this tournament's venue (re-checks auth.uid()).
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_event_id);

  -- Idempotency: already retired → noop success.
  IF v_status = 'withdrawn' THEN
    RETURN jsonb_build_object(
      'ok', true, 'competition_team_id', p_competition_team_id,
      'status', 'withdrawn', 'noop', true, 'walkover_count', 0
    );
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'invalid_registration_status' USING ERRCODE = 'P0001', DETAIL = v_status;
  END IF;

  -- Retire is a group-stage action: the team must have been drawn into a group…
  IF v_group_label IS NULL THEN
    RAISE EXCEPTION 'groups_not_seeded' USING ERRCODE = 'P0001';
  END IF;
  -- …and the knockout must not yet be seeded (the team could already be in the bracket).
  IF COALESCE((v_config->>'knockout_seeded')::boolean, false) THEN
    RAISE EXCEPTION 'knockout_already_seeded' USING ERRCODE = 'P0001';
  END IF;

  -- Strand guard: retiring must leave the group with ≥ qualifiers_per_group active teams,
  -- else that group can't produce its qualifiers and the KO is unseedable forever.
  v_qpg := COALESCE((v_config->>'qualifiers_per_group')::int, 2);
  SELECT COUNT(*)::int INTO v_group_active
  FROM public.competition_teams
  WHERE competition_id = v_comp_id AND status = 'active' AND group_label = v_group_label;

  IF (v_group_active - 1) < v_qpg THEN
    RAISE EXCEPTION 'group_would_strand' USING ERRCODE = 'P0001',
      DETAIL = 'retiring would leave Group ' || v_group_label || ' with fewer than '
        || v_qpg::text || ' team(s), so the knockout could not be generated';
  END IF;

  -- Flip status first so the qualifier ranking excludes this team.
  UPDATE public.competition_teams
  SET status = 'withdrawn',
      withdrawal_reason = 'retired_no_show'
  WHERE id = p_competition_team_id;

  -- Walk over the team's outstanding GROUP fixtures as completed results:
  --   retiring team scores 0; opponent scores 3, unless the opponent is ALSO retired
  --   ('withdrawn') → 0-0 double-forfeit. Only group fixtures, only not-yet-completed.
  WITH updated AS (
    UPDATE public.fixtures f
       SET status     = 'completed',
           home_score = CASE
             WHEN f.home_competition_team_id = p_competition_team_id THEN 0
             WHEN (SELECT ct2.status FROM public.competition_teams ct2 WHERE ct2.id = f.home_competition_team_id) = 'withdrawn' THEN 0
             ELSE 3
           END,
           away_score = CASE
             WHEN f.away_competition_team_id = p_competition_team_id THEN 0
             WHEN (SELECT ct2.status FROM public.competition_teams ct2 WHERE ct2.id = f.away_competition_team_id) = 'withdrawn' THEN 0
             ELSE 3
           END
     WHERE f.competition_id = v_comp_id
       AND f.group_label IS NOT NULL
       AND f.status <> 'completed'
       AND (f.home_competition_team_id = p_competition_team_id
            OR f.away_competition_team_id = p_competition_team_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_walkover_count FROM updated;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_group_team_retired', 'competition_team', p_competition_team_id::text,
    jsonb_build_object(
      'tournament_event_id', v_event_id,
      'competition_id',      v_comp_id,
      'team_name',           v_team_name,
      'group_label',         v_group_label,
      'walkover_count',      v_walkover_count
    )
  );

  RETURN jsonb_build_object(
    'ok',                  true,
    'competition_team_id', p_competition_team_id,
    'competition_id',      v_comp_id,
    'status',              'withdrawn',
    'walkover_count',      v_walkover_count
  );
END;
$function$;

-- Grants: authenticated-only. Strip PUBLIC and the auto-granted anon explicitly.
REVOKE ALL ON FUNCTION public.self_serve_retire_group_team(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_retire_group_team(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_retire_group_team(text, uuid) TO authenticated;
