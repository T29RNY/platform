-- Migration 334: add squad-full guard to reactivate_guest_player
--
-- reactivate_guest_player (mig 217) re-activates a dormant past guest by
-- setting status='in' unconditionally. Same gap as add_guest_player (fixed
-- mig 333): a player could pick a returning guest when the squad was already
-- full and push the confirmed count over squad_size. Same guard pattern added.

CREATE OR REPLACE FUNCTION public.reactivate_guest_player(p_token text, p_guest_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_result    jsonb;
  v_cap       integer;
  v_in_count  bigint;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  -- The guest must be a guest row on the caller's team.
  IF NOT EXISTS (
    SELECT 1
      FROM players g
      JOIN team_players tp ON tp.player_id = g.id
     WHERE g.id       = p_guest_id
       AND g.is_guest = true
       AND tp.team_id = v_team_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_found';
  END IF;

  -- Squad-full guard: reject if the cap is already met.
  SELECT s.squad_size INTO v_cap
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  SELECT COUNT(*) INTO v_in_count
    FROM players p2
    JOIN team_players tp2 ON tp2.player_id = p2.id
    WHERE tp2.team_id = v_team_id
      AND p2.status = 'in'
      AND NOT p2.disabled;

  IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='squad_full';
  END IF;

  -- Re-activate: attach to this host, fresh week, fresh payment baseline.
  -- Accumulated stats columns are intentionally left untouched.
  UPDATE players SET
    status          = 'in',
    guest_of        = v_player_id,
    team            = NULL,
    admin_locked_in = false,
    paid            = false,
    self_paid       = false,
    paid_by         = NULL,
    paid_at         = NULL,
    owes            = 0
  WHERE id = p_guest_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'guest_player_reactivated_self', 'player', p_guest_id,
    jsonb_build_object('host_player_id', v_player_id)
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
  WHERE p.id = p_guest_id;

  PERFORM notify_team_change(v_team_id, 'guest_player_added');

  RETURN v_result;

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.reactivate_guest_player(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reactivate_guest_player(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.reactivate_guest_player(text, text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
