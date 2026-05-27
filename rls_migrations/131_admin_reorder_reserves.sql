-- ════════════════════════════════════════════════════════════════════════════
-- 131 — admin_reorder_reserves RPC
-- ════════════════════════════════════════════════════════════════════════════
-- Admin drag-to-reorder reserves on /admin/. Atomic bulk-rewrite of
-- team_players.reserve_priority_order based on the array order the client
-- sends. Validates strictly:
--   - admin token resolves to a team
--   - every id in p_reserve_ids belongs to that team AND is currently a
--     reserve (status='reserve')
--   - no duplicates
--   - client-sent array matches the current reserve count on the team
--     (concurrency guard — if another writer changed the set between the
--      admin's drag and the save, error and force a re-fetch)
--
-- Audits via 'admin_reorder_reserves' action (mig 012 pattern). Broadcasts
-- 'player_updated' (already whitelisted). REVOKE FROM PUBLIC; GRANT to
-- anon + authenticated per the parity-sweep pattern (mig 075).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_reorder_reserves(
  p_admin_token text,
  p_reserve_ids text[]
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id      text;
  v_actual_count int;
  v_sent_count   int;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF p_reserve_ids IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_input';
  END IF;

  v_sent_count := COALESCE(array_length(p_reserve_ids, 1), 0);

  -- Duplicate check
  IF v_sent_count <> (SELECT COUNT(DISTINCT x) FROM unnest(p_reserve_ids) AS x) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='duplicate_ids';
  END IF;

  -- Concurrency guard: client must send the full current reserve set
  SELECT COUNT(*) INTO v_actual_count
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id AND p.status = 'reserve';

  IF v_actual_count <> v_sent_count THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='reserve_set_changed';
  END IF;

  -- Validate every id belongs to this team AND is currently a reserve
  IF EXISTS (
    SELECT 1 FROM unnest(p_reserve_ids) AS u(player_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM team_players tp
      JOIN players p ON p.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND tp.player_id = u.player_id
        AND p.status = 'reserve'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_reserve_or_not_on_team';
  END IF;

  -- Atomic rewrite: position = array index - 1 (0-based)
  UPDATE team_players tp
     SET reserve_priority_order = u.ord - 1
    FROM unnest(p_reserve_ids) WITH ORDINALITY AS u(player_id, ord)
   WHERE tp.team_id = v_team_id AND tp.player_id = u.player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'admin_reorder_reserves', 'team', v_team_id,
    jsonb_build_object('reserve_ids', to_jsonb(p_reserve_ids))
  );

  PERFORM notify_team_change(v_team_id, 'player_updated');

  RETURN jsonb_build_object('ok', true, 'count', v_actual_count);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reorder_reserves(text, text[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reorder_reserves(text, text[]) TO anon, authenticated;
