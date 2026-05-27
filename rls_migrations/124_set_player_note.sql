-- ════════════════════════════════════════════════════════════════════════════
-- 124 — Player-self note write RPC: set_player_note
-- ════════════════════════════════════════════════════════════════════════════
-- The "Save Note" button on PlayerView has been broken since the feature
-- shipped: saveNote() was a pure React state setter with zero persistence,
-- and setStatus() drops the note when calling set_player_status (which only
-- writes the status column). The note appeared to save in local state, then
-- vanished the moment a realtime broadcast or page reload reconciled with
-- the database.
--
-- Mirrors admin_set_player_note (mig 012) but token-authenticated for the
-- player themselves. Player can set or clear their own note only. Max 200
-- chars (same as admin variant). Audits per player-self pattern (mig 063)
-- with action='player_note_updated_self'. Broadcasts via notify_team_change
-- with reason='player_note_updated' (already whitelisted in mig 049).
--
-- Returns the updated player row as jsonb (same shape as set_player_status).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_player_note(
  p_token text,
  p_note  text   -- NULL or '' to clear; max 200 chars when non-empty
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_note      text;
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

  -- Treat empty string as NULL (clear). Whitespace-only also clears.
  v_note := NULLIF(btrim(coalesce(p_note, '')), '');

  IF v_note IS NOT NULL AND length(v_note) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  UPDATE players SET note = v_note WHERE id = v_player_id;

  -- Audit (mig 063 pattern)
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_note_updated_self', 'player', v_player_id,
    jsonb_build_object('note', v_note)
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

  PERFORM notify_team_change(v_team_id, 'player_note_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_player_note(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_player_note(text, text) TO anon, authenticated;
