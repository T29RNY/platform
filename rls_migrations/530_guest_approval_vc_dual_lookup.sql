-- 530: admin_approve_guest / admin_decline_guest — VC dual-lookup caller resolution.
--
-- Bug: both RPCs (plus-one approvals, mig 346) resolved the caller with a plain
--   SELECT id FROM teams WHERE admin_token = p_admin_token
-- so they only ever accepted a team's admin_token. Vice Captains open AdminView
-- via /p/<vc_player_token>, which passes their PLAYER token as p_admin_token to
-- every admin_* RPC. For these two RPCs that token never matched a team, so every
-- VC saw "Couldn't update — your admin link may be out of date" on Approve/Decline
-- of a pending +1, every time. The team-owner path worked, masking it from the
-- owner's own test account.
--
-- Fix: adopt the documented dual-lookup pattern (DECISIONS.md session 49; reference
-- implementation mig 116 admin_delete_player) — accept the team admin_token OR a
-- Vice Captain's player token, scoped to the target guest's team, and record the
-- resolved actor_type ('team_admin' | 'vice_captain') in the audit row.
--
-- SQL-only change: the supabase.js wrappers (adminApproveGuest / adminDeclineGuest)
-- already forward the caller token unchanged, so no JS change is required.

CREATE OR REPLACE FUNCTION public.admin_approve_guest(p_admin_token text, p_guest_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id     text;
  v_actor_type  text;
  v_actor_ident text;
  v_host_id     text;
  v_cap         integer;
  v_in_count    bigint;
  v_new_status  text;
  v_result      jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  -- Dual-lookup caller resolution: team admin_token OR a Vice Captain's player
  -- token, scoped to the target guest's team (ref mig 116 admin_delete_player).
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NOT NULL THEN
    v_actor_type  := 'team_admin';
    v_actor_ident := 'admin_token:' || md5(p_admin_token);
  ELSE
    SELECT tp_caller.team_id INTO v_team_id
    FROM   players      p_caller
    JOIN   team_players tp_caller ON tp_caller.player_id = p_caller.id
    JOIN   team_players tp_target ON tp_target.team_id   = tp_caller.team_id
    WHERE  p_caller.token            = p_admin_token
      AND  tp_caller.is_vice_captain = true
      AND  tp_target.player_id       = p_guest_id
    LIMIT 1;

    IF v_team_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
    END IF;

    v_actor_type  := 'vice_captain';
    v_actor_ident := 'vc_token:' || md5(p_admin_token);
  END IF;

  SELECT p.guest_of INTO v_host_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.id = p_guest_id
     AND tp.team_id = v_team_id
     AND p.is_guest = true
     AND p.pending_approval = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  SELECT s.squad_size INTO v_cap
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  SELECT COUNT(*) INTO v_in_count
    FROM players p2
    JOIN team_players tp2 ON tp2.player_id = p2.id
    WHERE tp2.team_id = v_team_id
      AND p2.status = 'in'
      AND NOT p2.disabled;

  IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
    v_new_status := 'reserve';
  ELSE
    v_new_status := 'in';
  END IF;

  UPDATE players
     SET status = v_new_status,
         pending_approval = false
   WHERE id = p_guest_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
    'guest_approved', 'player', p_guest_id,
    jsonb_build_object('host_player_id', v_host_id, 'resulting_status', v_new_status)
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
    'pending_approval', p.pending_approval,
    'note',             p.note,
    'disabled',         p.disabled,
    'team',             p.team,
    'token',            p.token
  ) INTO v_result
  FROM players p WHERE p.id = p_guest_id;

  PERFORM notify_team_change(v_team_id, 'guest_approved');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_decline_guest(p_admin_token text, p_guest_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id     text;
  v_actor_type  text;
  v_actor_ident text;
  v_host_id     text;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  -- Dual-lookup caller resolution: team admin_token OR a Vice Captain's player
  -- token, scoped to the target guest's team (ref mig 116 admin_delete_player).
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NOT NULL THEN
    v_actor_type  := 'team_admin';
    v_actor_ident := 'admin_token:' || md5(p_admin_token);
  ELSE
    SELECT tp_caller.team_id INTO v_team_id
    FROM   players      p_caller
    JOIN   team_players tp_caller ON tp_caller.player_id = p_caller.id
    JOIN   team_players tp_target ON tp_target.team_id   = tp_caller.team_id
    WHERE  p_caller.token            = p_admin_token
      AND  tp_caller.is_vice_captain = true
      AND  tp_target.player_id       = p_guest_id
    LIMIT 1;

    IF v_team_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
    END IF;

    v_actor_type  := 'vice_captain';
    v_actor_ident := 'vc_token:' || md5(p_admin_token);
  END IF;

  SELECT p.guest_of INTO v_host_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.id = p_guest_id
     AND tp.team_id = v_team_id
     AND p.is_guest = true
     AND p.pending_approval = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  UPDATE players
     SET pending_approval = false,
         status           = 'none',
         team             = NULL,
         admin_locked_in  = false
   WHERE id = p_guest_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
    'guest_declined', 'player', p_guest_id,
    jsonb_build_object('host_player_id', v_host_id, 'mode', 'dormant')
  );

  PERFORM notify_team_change(v_team_id, 'guest_declined');

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;
