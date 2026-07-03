-- 474_reconcile_migration_source_drift.sql
--
-- Reconciles CLAUDE.md Hard Rule 11 drift surfaced by the new nightly
-- check-drift.sh routine (2026-07-03), investigated 2026-07-03.
--
-- ═══ A) 7 migrations applied live 2026-05-21/23 with NO matching source ═══
--
-- fix_b1_player_write_rpcs_stale_is_vice_captain
-- fix_b1_admin_write_rpcs_stale_is_vice_captain
-- fix_player_join_team_token_and_security
-- fix_player_get_teams_stale_is_vice_captain
--   CONFIRMED DEAD — no reconstruction needed. All 4 patched reads of
--   players.is_vice_captain, a column that no longer exists: it was moved to
--   team_players.is_vice_captain by 026_vc_to_team_players.sql. Verified
--   live 2026-07-03: `information_schema.columns` has no
--   players.is_vice_captain row, and grepping every pg_proc function body for
--   the old column reference (excluding the new team_players-qualified one)
--   returns nothing relevant. Noted here for the historical record only.
--
-- 038b_admin_set_player_status_lock_cap
-- 038c_set_player_status_lock_cap
-- 038d_admin_state_include_locked
--   STILL LOAD-BEARING — reconstructed below via CREATE OR REPLACE using
--   their exact current live bodies (pulled via pg_get_functiondef,
--   2026-07-03). This is a no-op against the live DB; it only restores the
--   missing source file. The squad-size cap guard in
--   admin_set_player_status/set_player_status and the admin_locked_in field
--   in get_team_state_by_admin_token trace back to these three.
--
-- ═══ B) 5 source files on main seemingly never applied live ═══
--
-- 410_venue_people_ia_phase3_members_guardians.sql
--   SUPERSEDED, not missing. Checked venue_list_members (410's subject) —
--   the live function already has the dob/guardians fields 410 would have
--   added, applied instead via the unnumbered
--   venue_people_ia_phase4_main_contact / _team_contacts_v2 migrations that
--   immediately follow 409 in the live migration history. No action needed.
--
-- 310_casual_demo_reseed.sql / 311_venue_demo_reseed.sql /
-- 312_club_os_demo_reseed.sql / 313_league_ref_display_reseed.sql
--   Treated as superseded demo-data drafts, not missing work — several much
--   larger, more recent demo-seed migrations overwrite the same demo rows
--   (363+ demo_signin_users, 378_demo_seed_3v3_league_and_tournament,
--   396_demo_matchday_seed, and others). No action needed; lower confidence
--   than the 410 finding above since not every later demo migration's exact
--   row overlap was individually traced — worth a second look only if demo
--   data ever looks wrong for team_demo/venue_demo/company_demo/league_demo.

CREATE OR REPLACE FUNCTION public.admin_set_player_status(p_admin_token text, p_player_id text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id    text;
  v_old_status text;
  v_cap        int;
  v_in_count   int;
  v_result     jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('in','out','maybe','reserve','none') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status';
  END IF;

  -- Cap guard: refuse 'in' if team already at squad_size
  IF p_status = 'in' THEN
    SELECT s.squad_size INTO v_cap
      FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

    SELECT COUNT(*) INTO v_in_count
      FROM players p
      JOIN team_players tp ON tp.player_id = p.id
      WHERE tp.team_id = v_team_id
        AND p.status = 'in' AND NOT p.disabled
        AND p.id <> p_player_id;

    IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'squad_full';
    END IF;
  END IF;

  SELECT status INTO v_old_status FROM players WHERE id = p_player_id;

  UPDATE players
     SET status = p_status,
         admin_locked_in = false
   WHERE id = p_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
    'player_status_updated', 'player', p_player_id,
    jsonb_build_object('before', v_old_status, 'after', p_status, 'locked_after', false)
  );

  SELECT jsonb_build_object(
    'id',               p.id,
    'name',             p.name,
    'nickname',         p.nickname,
    'status',           p.status,
    'type',             p.type,
    'priority',         p.priority,
    'paid',             p.paid,
    'owes',             p.owes,
    'self_paid',        p.self_paid,
    'paid_by',          p.paid_by,
    'pay_count',        p.pay_count,
    'goals',            p.goals,
    'motm',             p.motm,
    'attended',         p.attended,
    'total',            p.total,
    'w',                p.w,
    'l',                p.l,
    'd',                p.d,
    'bib_count',        p.bib_count,
    'late_dropouts',    p.late_dropouts,
    'injured',          p.injured,
    'injured_since',    p.injured_since,
    'is_guest',         p.is_guest,
    'guest_of',         p.guest_of,
    'note',             p.note,
    'disabled',         p.disabled,
    'disable_reason',   p.disable_reason,
    'admin_locked_in',  p.admin_locked_in,
    'team',             p.team
  )
  INTO v_result
  FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_status_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_player_status(p_token text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id    text;
  v_team_id      text;
  v_prev_status  text;
  v_cap          int;
  v_in_count     int;
  v_locked       boolean;
  v_game_live    boolean;
  v_cancelled    boolean;
  v_result       jsonb;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('in','out','maybe','reserve','none') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status';
  END IF;

  SELECT s.game_is_live, COALESCE(s.is_cancelled, false)
    INTO v_game_live, v_cancelled
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  IF v_game_live IS DISTINCT FROM true OR v_cancelled = true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'game_not_live';
  END IF;

  IF is_lineup_locked(v_team_id)
     AND EXISTS (SELECT 1 FROM players WHERE id = v_player_id AND team IN ('A','B')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'lineup_locked';
  END IF;

  IF p_status = 'in' THEN
    SELECT admin_locked_in INTO v_locked FROM players WHERE id = v_player_id;
    IF v_locked = true THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'admin_locked_in';
    END IF;

    SELECT s.squad_size INTO v_cap
      FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

    SELECT COUNT(*) INTO v_in_count
      FROM players p
      JOIN team_players tp ON tp.player_id = p.id
      WHERE tp.team_id = v_team_id
        AND p.status = 'in' AND NOT p.disabled
        AND p.id <> v_player_id;

    IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'squad_full';
    END IF;
  END IF;

  SELECT status INTO v_prev_status FROM players WHERE id = v_player_id;

  UPDATE players
  SET    status = p_status
  WHERE  id     = v_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_status_set', 'player', v_player_id,
    jsonb_build_object(
      'status',          p_status,
      'previous_status', v_prev_status
    )
  );

  SELECT jsonb_build_object(
    'id',             p.id,
    'name',           p.name,
    'nickname',       p.nickname,
    'status',         p.status,
    'type',           p.type,
    'priority',       p.priority,
    'paid',           p.paid,
    'owes',           p.owes,
    'self_paid',      p.self_paid,
    'paid_by',        p.paid_by,
    'pay_count',      p.pay_count,
    'goals',          p.goals,
    'motm',           p.motm,
    'attended',       p.attended,
    'total',          p.total,
    'w',              p.w,
    'l',              p.l,
    'd',              p.d,
    'bib_count',      p.bib_count,
    'late_dropouts',  p.late_dropouts,
    'injured',        p.injured,
    'injured_since',  p.injured_since,
    'is_guest',       p.is_guest,
    'guest_of',       p.guest_of,
    'note',           p.note,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p
  WHERE p.id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_status_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_team_state_by_admin_token(p_admin_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id    text;
  v_team       jsonb;
  v_squad      jsonb;
  v_schedule   jsonb;
  v_matches    jsonb;
  v_bib_hist   jsonb;
  v_settings   jsonb;
  v_cover_pool jsonb;
  v_lckey      text;
  v_team_type      text;
  v_club_id        text;
  v_club_name      text;
  v_is_competitive boolean;
BEGIN
  IF p_admin_token IS NULL THEN RETURN NULL; END IF;

  SELECT
    t.id,
    jsonb_build_object(
      'id',                  t.id,
      'name',                t.name,
      'join_code',           t.join_code,
      'onboarding_complete', t.onboarding_complete,
      'admin_email',         t.admin_email,
      'live_channel_key',    t.live_channel_key,
      'created_at',          t.created_at
    )
  INTO v_team_id, v_team
  FROM teams t
  WHERE t.admin_token = p_admin_token;

  IF v_team_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                     p.id,
        'name',                   p.name,
        'nickname',               p.nickname,
        'status',                 p.status,
        'type',                   p.type,
        'priority',               p.priority,
        'paid',                   p.paid,
        'owes',                   p.owes,
        'self_paid',              p.self_paid,
        'paid_by',                p.paid_by,
        'pay_count',              p.pay_count,
        'goals',                  p.goals,
        'motm',                   p.motm,
        'attended',               p.attended,
        'total',                  p.total,
        'w',                      p.w,
        'l',                      p.l,
        'd',                      p.d,
        'bib_count',              p.bib_count,
        'late_dropouts',          p.late_dropouts,
        'injured',                p.injured,
        'injured_since',          p.injured_since,
        'is_guest',               p.is_guest,
        'guest_of',               p.guest_of,
        'host_dropout_ack',       p.host_dropout_ack,
        'pending_approval',               p.pending_approval,
        'note',                   p.note,
        'is_vice_captain',        tp.is_vice_captain,
        'group_number',           tp.group_number,
        'reserve_priority_order', tp.reserve_priority_order,
        'disabled',               p.disabled,
        'disable_reason',         p.disable_reason,
        'admin_locked_in',        p.admin_locked_in,
        'team',                   p.team,
        'token',                  p.token,
        'is_self',                (p.user_id IS NOT NULL AND p.user_id = auth.uid())
      )
      ORDER BY tp.created_at, p.id
    ),
    '[]'::jsonb
  )
  INTO v_squad
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id;

  SELECT to_jsonb(s.*)
  INTO   v_schedule
  FROM   schedule s
  WHERE  s.team_id = v_team_id
  AND    s.active  = true
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                    m.id,
        'team_id',               m.team_id,
        'match_date',            m.match_date,
        'score_a',               m.score_a,
        'score_b',               m.score_b,
        'score_type',            m.score_type,
        'last_goal_scorer',      m.last_goal_scorer,
        'scorers',               m.scorers,
        'motm',                  m.motm,
        'bib_holder',            m.bib_holder,
        'team_a',                m.team_a,
        'team_b',                m.team_b,
        'teams_draft',           m.teams_draft,
        'winner',                m.winner,
        'cancelled',             m.cancelled,
        'cancel_reason',         m.cancel_reason,
        'result_note',         m.result_note,
        'voting_open',           m.voting_open,
        'voting_closes_at',      m.voting_closes_at,
        'vote_count',            m.vote_count,
        'total_voters',          m.total_voters,
        'was_admin_decided',     m.was_admin_decided,
        'admin_decision_pending',m.admin_decision_pending,
        'tied_candidates',       m.tied_candidates,
        'payments',              m.payments,
        'created_at',            m.created_at,
        'team_switches',         m.team_switches
      )
      ORDER BY m.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_matches
  FROM matches m
  WHERE m.team_id = v_team_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'team_id',    bh.team_id,
        'player_id',  bh.player_id,
        'name',       bh.name,
        'match_date', bh.match_date,
        'returned',   bh.returned
      )
      ORDER BY bh.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_bib_hist
  FROM bib_history bh
  WHERE bh.team_id = v_team_id;

  SELECT jsonb_build_object(
    'group_name',   s.group_name,
    'group_labels', s.group_labels
  )
  INTO   v_settings
  FROM   settings s
  WHERE  s.team_id = v_team_id
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',      cp.id,
        'team_id', cp.team_id,
        'name',    cp.name,
        'played',  cp.played,
        'owes',    cp.owes
      )
    ),
    '[]'::jsonb
  )
  INTO v_cover_pool
  FROM cover_pool cp
  WHERE cp.team_id = v_team_id;

  SELECT t.live_channel_key
  INTO   v_lckey
  FROM   teams t
  WHERE  t.id = v_team_id;

  SELECT
    t.team_type,
    t.club_id,
    c.name,
    EXISTS (
      SELECT 1 FROM competition_teams ct
      JOIN competitions co ON co.id = ct.competition_id
      WHERE ct.team_id = t.id AND ct.status = 'active' AND co.type = 'league'
    )
  INTO v_team_type, v_club_id, v_club_name, v_is_competitive
  FROM teams t
  LEFT JOIN clubs c ON c.id = t.club_id
  WHERE t.id = v_team_id;

  RETURN jsonb_build_object(
    'team',             v_team,
    'squad',            v_squad,
    'schedule',         v_schedule,
    'matches',          v_matches,
    'bib_history',      v_bib_hist,
    'settings',         v_settings,
    'cover_pool',       v_cover_pool,
    'live_channel_key', v_lckey,
    'team_type',        v_team_type,
    'is_competitive',   COALESCE(v_is_competitive, false),
    'club_id',          v_club_id,
    'club_name',        v_club_name
  );
END;
$function$;
