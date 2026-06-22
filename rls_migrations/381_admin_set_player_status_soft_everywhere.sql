-- 381: admin_set_player_status — soft override everywhere.
--
-- Previously set admin_locked_in = (p_status = 'in'), which blocked the player
-- from self-restoring 'in' (set_player_status raises 'admin_locked_in' when the
-- flag is true). Decision (session 173, Option A): an admin setting a player's
-- status NEVER locks the player — the player can always override their own
-- status from any screen.
--
-- After this change nothing sets admin_locked_in = true anywhere (it was the
-- sole producer; every other path resets it to false), so the column and the
-- set_player_status guard go dormant but stay in place (return shape unchanged
-- per Hard Rule #12). Drives the new My View admin avatar-tap quick-action
-- sheet (admin marks any squad player in/out/maybe/reserve from the player
-- board), and softens the existing Admin View squad/profile status controls
-- that share this RPC.
--
-- Only changed lines vs the prior body:
--   admin_locked_in = (p_status = 'in')  ->  admin_locked_in = false
--   metadata 'locked_after'              ->  always false
--
-- NOTE: applied live via MCP under the slug 378_admin_set_player_status_soft_
-- everywhere (378/379/380 file numbers were already taken by parallel demo-seed
-- + tournament work); this source file uses the next-free number 381.
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
