-- ════════════════════════════════════════════════════════════════════════════
-- 233 — set_my_nickname: player-self nickname edit (token-authenticated)
-- ════════════════════════════════════════════════════════════════════════════
-- The "My View" pencil edit in PlayerView lets a player set their own nickname.
-- It was wired to the admin RPC admin_update_player_name (signature
-- adminToken, playerId, nickname) but called as setPlayerNickname(myId, teamId,
-- nickname) — a plain player has no admin token, so resolve_admin_caller
-- rejected every save with invalid_admin_token and the UI showed "Failed to
-- save". Two of three call sites were migrated to the admin RPC in the RLS
-- rewrite (commit 7bd7ef2); the player-self call site was missed and no
-- player-token path ever existed.
--
-- This adds the missing path, mirroring set_player_note (mig 060/063 audited
-- self-write pattern — Hard Rule #9), and restores the same-team nickname
-- clash check the original direct-write wrapper performed before 7bd7ef2
-- dropped it.

CREATE OR REPLACE FUNCTION public.set_my_nickname(p_token text, p_nickname text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_nick      text;
  v_result    jsonb;
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

  -- empty/blank -> clear nickname; else trimmed value
  v_nick := NULLIF(btrim(coalesce(p_nickname, '')), '');

  IF v_nick IS NOT NULL AND length(v_nick) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  -- same-team clash check (case-insensitive), excluding self
  IF v_nick IS NOT NULL AND EXISTS (
    SELECT 1
      FROM players p
      JOIN team_players tp ON tp.player_id = p.id
     WHERE tp.team_id = v_team_id
       AND p.id <> v_player_id
       AND lower(p.nickname) = lower(v_nick)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'nickname_taken';
  END IF;

  UPDATE players SET nickname = v_nick WHERE id = v_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_nickname_updated_self', 'player', v_player_id,
    jsonb_build_object('nickname', v_nick)
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
  FROM players p WHERE p.id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.set_my_nickname(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_my_nickname(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.set_my_nickname(text, text) TO authenticated;
