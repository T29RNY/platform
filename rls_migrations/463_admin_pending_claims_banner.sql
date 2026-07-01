-- 463: surface per-week CLAIMS in the admin "Payment Confirmations" banner.
--
-- The banner (AdminView) listed only players with the whole-player self_paid flag (My
-- View "I've paid"). A per-week claim from Payment History sets the ledger row's
-- claimed_at but NOT self_paid, so it never reached the banner. Two additive RPCs:
--
--   admin_list_pending_claims(token) → every player awaiting confirmation: a per-week
--       claim (claimed_at on any unpaid game_fee row) OR the whole-player self_paid flag.
--   admin_confirm_claims(token, player) → settle exactly what they claimed: whole balance
--       if self_paid (they said "paid in full"); else only the claimed weeks. Recomputes
--       owes, clears the claim, sets paid=(owes=0).

-- ── read: list players with a pending claim ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_pending_claims(p_admin_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id text;
  v_rows    jsonb;
BEGIN
  SELECT r.team_id INTO v_team_id FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.claimed_total DESC, x.name)
    INTO v_rows
  FROM (
    SELECT p.id AS player_id, p.name, p.nickname, p.self_paid, p.paid_by, p.owes,
           COALESCE(c.cnt, 0)   AS claimed_weeks,
           COALESCE(c.total, 0) AS claimed_total
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = v_team_id
    LEFT JOIN (
      SELECT player_id, count(*) AS cnt, SUM(amount) AS total
      FROM payment_ledger
      WHERE team_id = v_team_id AND type = 'game_fee'
        AND status = 'unpaid' AND claimed_at IS NOT NULL
      GROUP BY player_id
    ) c ON c.player_id = p.id
    WHERE p.paid = false
      AND (p.self_paid = true OR COALESCE(c.cnt, 0) > 0)
  ) x;

  RETURN COALESCE(v_rows, '[]'::jsonb);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_pending_claims(text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_claims(text) TO anon, authenticated;

-- ── write: confirm exactly what the player claimed ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_confirm_claims(p_admin_token text, p_player_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id text;
  v_self_paid boolean;
  v_count int;
  v_player jsonb;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='player_not_in_team';
  END IF;

  SELECT self_paid INTO v_self_paid FROM players WHERE id = p_player_id;

  IF v_self_paid THEN
    -- whole-player claim ("I've paid" on My View) → settle the whole balance.
    UPDATE payment_ledger SET
      status='paid', method='cash', paid_by=COALESCE(paid_by,'admin'), paid_at=now()
    WHERE player_id = p_player_id AND team_id = v_team_id
      AND type = 'game_fee' AND status = 'unpaid';
  ELSE
    -- per-week claims → settle only the weeks they actually claimed.
    UPDATE payment_ledger SET
      status='paid', method='cash', paid_by=COALESCE(paid_by,'admin'), paid_at=now()
    WHERE player_id = p_player_id AND team_id = v_team_id
      AND type = 'game_fee' AND status = 'unpaid' AND claimed_at IS NOT NULL;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- the claim is resolved either way; clear the whole-player flag.
  UPDATE players SET self_paid = false WHERE id = p_player_id;

  PERFORM _recompute_player_owes(p_player_id, v_team_id);
  UPDATE players SET
    paid    = (owes = 0),
    paid_by = COALESCE(paid_by, 'admin'),
    paid_at = CASE WHEN owes = 0 THEN now() ELSE paid_at END
  WHERE id = p_player_id;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
          'player_paid_confirmed', 'player', p_player_id,
          jsonb_build_object('mode', CASE WHEN v_self_paid THEN 'confirm_all' ELSE 'confirm_claimed' END,
                             'weeks_settled', v_count));

  PERFORM notify_team_change(v_team_id, 'payment_confirmed');

  SELECT jsonb_build_object(
    'id', id, 'name', name, 'nickname', nickname, 'status', status,
    'type', type, 'priority', priority, 'paid', paid, 'owes', owes,
    'self_paid', self_paid, 'paid_by', paid_by, 'pay_count', pay_count,
    'goals', goals, 'motm', motm, 'attended', attended, 'total', total,
    'w', w, 'l', l, 'd', d, 'bib_count', bib_count,
    'late_dropouts', late_dropouts, 'injured', injured, 'injured_since', injured_since,
    'is_guest', is_guest, 'guest_of', guest_of, 'note', note,
    'disabled', disabled, 'disable_reason', disable_reason, 'team', team
  ) INTO v_player FROM players WHERE id = p_player_id;

  RETURN jsonb_build_object('ok', true, 'player', v_player, 'weeks_settled', v_count);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_confirm_claims(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_confirm_claims(text, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
